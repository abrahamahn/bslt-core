// main/server/core/src/auth/utils/refresh-token.ts
/**
 * Refresh Token Management
 *
 * Implements refresh token rotation with family tracking
 * to detect and prevent token reuse attacks.
 *
 * @module utils/refresh-token
 */

import { randomUUID } from 'node:crypto';

import { and, deleteFrom, eq, gt, insert, isNull, lt, select, update } from '@bslt/db/builder';
import {
  REFRESH_TOKEN_COLUMNS,
  REFRESH_TOKENS_TABLE,
  USER_COLUMNS,
  USER_SESSION_COLUMNS,
  USER_SESSIONS_TABLE,
  USERS_TABLE,
  type RefreshToken,
  type User,
  type UserSession,
} from '@bslt/db/schema';
import { toCamelCase, withTransaction } from '@bslt/db/utils';
import { type UserRole } from '@bslt/shared/core/users';

import { TokenReuseError } from '../errors';
import { logTokenFamilyRevokedEvent, logTokenReuseEvent } from '../security/events';

import { createRefreshToken, getRefreshTokenExpiry } from './jwt';
import { parseUserAgentDeviceInfo } from './user-agent';

import type { DbClient } from '@bslt/db/client';

// ============================================================================
// Token Family Management
// ============================================================================

/**
 * Create a new refresh token family.
 * Families are used to detect token reuse attacks.
 *
 * This operation is wrapped in a transaction for atomicity.
 * If token insertion fails, the session creation is rolled back.
 *
 * @param db - Database client
 * @param userId - User ID to create family for
 * @param expiryDays - Number of days until token expires (default: 7)
 * @param sessionMeta - Optional session metadata for user_sessions
 * @returns Object containing the family ID and token
 * @throws When database operations fail
 * @complexity O(1) - two database inserts
 */
export async function createRefreshTokenFamily(
  db: DbClient,
  userId: string,
  expiryDays: number = 7,
  sessionMeta?: { ipAddress?: string; userAgent?: string; deviceId?: string },
): Promise<{ familyId: string; token: string }> {
  return await withTransaction(db, async (tx) => {
    const familyId = randomUUID();
    const token = createRefreshToken();
    const now = new Date();

    await tx.execute(
      insert(REFRESH_TOKENS_TABLE)
        .values({
          user_id: userId,
          family_id: familyId,
          token,
          expires_at: getRefreshTokenExpiry(expiryDays),
          family_ip_address: sessionMeta?.ipAddress ?? null,
          family_user_agent: sessionMeta?.userAgent ?? null,
          family_created_at: now,
        })
        .toSql(),
    );

    const deviceInfo = parseUserAgentDeviceInfo(sessionMeta?.userAgent);

    await tx.execute(
      insert(USER_SESSIONS_TABLE)
        .values({
          id: familyId,
          user_id: userId,
          ip_address: sessionMeta?.ipAddress ?? null,
          user_agent: sessionMeta?.userAgent ?? null,
          device_name: deviceInfo.deviceName,
          device_type: deviceInfo.deviceType,
          device_id: sessionMeta?.deviceId ?? null,
          last_active_at: now,
          created_at: now,
        })
        .toSql(),
    );

    return { familyId, token };
  });
}

/**
 * Rotate a refresh token (create new one, invalidate old one).
 * Returns new token or null if rotation fails.
 *
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Combined token + user lookup using parallel queries where safe
 * 2. Uses composite index (token, expires_at) for efficient token validation
 * 3. Family revocation status read from denormalized column on the token row
 * 4. Minimized round trips by batching independent queries
 *
 * @param db - Database client
 * @param oldToken - The current refresh token to rotate
 * @param ipAddress - Client IP address (for security logging)
 * @param userAgent - Client user agent (for security logging)
 * @param expiryDays - Days until new token expires (default: 7)
 * @param gracePeriodSeconds - Grace period for network retries (default: 30)
 * @returns New token with user info, or null if token is invalid
 * @throws {TokenReuseError} If token reuse attack is detected
 * @complexity O(1) - fixed number of database queries
 */
export async function rotateRefreshToken(
  db: DbClient,
  oldToken: string,
  ipAddress?: string,
  userAgent?: string,
  expiryDays: number = 7,
  gracePeriodSeconds: number = 30,
): Promise<{ token: string; userId: string; email: string; role: UserRole } | null> {
  const gracePeriod = gracePeriodSeconds * 1000;
  const now = new Date();

  // OPTIMIZATION 1: Single query to find valid token
  // Uses composite index (token, expires_at) for efficient lookup
  const storedTokenRow = await db.queryOne(
    select(REFRESH_TOKENS_TABLE)
      .where(and(eq('token', oldToken), gt('expires_at', now)))
      .limit(1)
      .toSql(),
  );

  if (storedTokenRow === null) {
    return null;
  }

  const storedToken = toCamelCase<RefreshToken>(storedTokenRow, REFRESH_TOKEN_COLUMNS);

  // OPTIMIZATION 2: Parallel fetch of user and session data
  // These are independent queries that can run concurrently
  const [userRow, sessionRow] = await Promise.all([
    // User lookup - always needed for the response
    db.queryOne(select(USERS_TABLE).where(eq('id', storedToken.userId)).limit(1).toSql()),
    // Session lookup - for checking User-Agent binding
    db.queryOne(select(USER_SESSIONS_TABLE).where(eq('id', storedToken.familyId)).limit(1).toSql()),
  ]);

  // Early exit if user doesn't exist
  if (userRow === null) {
    return null;
  }

  const user = toCamelCase<User>(userRow, USER_COLUMNS);
  const session =
    sessionRow !== null ? toCamelCase<UserSession>(sessionRow, USER_SESSION_COLUMNS) : null;

  // SESSION BINDING CHECK: User-Agent Validation
  // If the session was started with a specific User-Agent, verify it hasn't changed.
  // This prevents session hijacking if a token is stolen and used from a different device.
  // Note: userAgent header matches are exact strings. Browser updates may invalidate sessions, which is acceptable for security.
  if (
    session?.userAgent !== undefined &&
    session.userAgent !== null &&
    session.userAgent !== '' &&
    userAgent !== undefined
  ) {
    if (session.userAgent !== userAgent) {
      await logTokenReuseEvent(db, user.id, user.email, storedToken.familyId, ipAddress, userAgent);
      await logTokenFamilyRevokedEvent(
        db,
        user.id,
        user.email,
        storedToken.familyId,
        'Session hijacking detected: User-Agent mismatch',
        ipAddress,
        userAgent, // The attacker's UA
      );
      await revokeTokenFamily(
        db,
        storedToken.familyId,
        'Session hijacking detected: User-Agent mismatch',
      );
      // We reuse TokenReuseError or throw a specific security error
      throw new TokenReuseError(user.id, user.email, storedToken.familyId, ipAddress, userAgent);
    }
  }

  // Check if family is revoked (token reuse attack)
  // Family revocation is denormalized into the token row (familyRevokedAt column)
  if (storedToken.familyRevokedAt !== null) {
    await logTokenReuseEvent(db, user.id, user.email, storedToken.familyId, ipAddress, userAgent);
    await revokeTokenFamily(db, storedToken.familyId, 'Token reuse detected');
    throw new TokenReuseError(user.id, user.email, storedToken.familyId, ipAddress, userAgent);
  }

  // The presented token was already rotated away. Within the grace window
  // this is a network retry — return the family's current token. Outside it,
  // it is reuse of a stolen token: revoke the entire family (auth.md).
  if (storedToken.rotatedAt != null) {
    const sinceRotation = Date.now() - storedToken.rotatedAt.getTime();
    if (sinceRotation < gracePeriod) {
      const activeRow = await db.queryOne(
        select(REFRESH_TOKENS_TABLE)
          .where(
            and(eq('family_id', storedToken.familyId), isNull('rotated_at'), gt('expires_at', now)),
          )
          .limit(1)
          .toSql(),
      );
      if (activeRow === null) {
        return null;
      }
      const active = toCamelCase<RefreshToken>(activeRow, REFRESH_TOKEN_COLUMNS);
      return {
        token: active.token,
        userId: user.id,
        email: user.email,
        role: user.role,
      };
    }

    await logTokenReuseEvent(db, user.id, user.email, storedToken.familyId, ipAddress, userAgent);
    await logTokenFamilyRevokedEvent(
      db,
      user.id,
      user.email,
      storedToken.familyId,
      'Token reuse detected outside grace period',
      ipAddress,
      userAgent,
    );
    await revokeTokenFamily(db, storedToken.familyId, 'Token reuse detected outside grace period');
    throw new TokenReuseError(user.id, user.email, storedToken.familyId, ipAddress, userAgent);
  }

  // Atomic token rotation: mark the presented token rotated (kept until
  // expiry for reuse detection) and insert its successor. The rotated_at IS
  // NULL guard makes concurrent rotations of the same token lose cleanly —
  // the loser returns null and the client retries into the grace path.
  const newToken = await withTransaction(db, async (tx) => {
    const rotated = await tx.execute(
      update(REFRESH_TOKENS_TABLE)
        .set({ rotated_at: new Date() })
        .where(and(eq('id', storedToken.id), isNull('rotated_at')))
        .toSql(),
    );
    if (rotated === 0) {
      return null;
    }

    const token = createRefreshToken();
    await tx.execute(
      insert(REFRESH_TOKENS_TABLE)
        .values({
          user_id: storedToken.userId,
          family_id: storedToken.familyId,
          token,
          expires_at: getRefreshTokenExpiry(expiryDays),
          family_ip_address: storedToken.familyIpAddress,
          family_user_agent: storedToken.familyUserAgent,
          family_created_at: storedToken.familyCreatedAt,
        })
        .toSql(),
    );

    return token;
  });

  if (newToken === null) {
    return null;
  }

  await db.execute(
    update(USER_SESSIONS_TABLE)
      .set({ last_active_at: new Date() })
      .where(eq('id', storedToken.familyId))
      .toSql(),
  );

  return {
    token: newToken,
    userId: user.id,
    email: user.email,
    role: user.role,
  };
}

// ============================================================================
// Token Revocation
// ============================================================================

/**
 * Revoke an entire token family (all tokens created from the same initial login).
 *
 * This operation is wrapped in a transaction for atomicity.
 * If any operation fails, all changes are rolled back.
 *
 * @param db - Database client
 * @param familyId - Token family ID to revoke
 * @param reason - Reason for revocation (for audit trail)
 * @returns Promise that resolves when revocation is complete
 * @complexity O(1) - three database operations
 */
export async function revokeTokenFamily(
  db: DbClient,
  familyId: string,
  reason: string,
): Promise<void> {
  await withTransaction(db, async (tx) => {
    const now = new Date();
    // Stamp revocation on all tokens in family before deleting
    await tx.execute(
      update(REFRESH_TOKENS_TABLE)
        .set({ family_revoked_at: now, family_revoke_reason: reason })
        .where(eq('family_id', familyId))
        .toSql(),
    );

    await tx.execute(deleteFrom(REFRESH_TOKENS_TABLE).where(eq('family_id', familyId)).toSql());

    await tx.execute(
      update(USER_SESSIONS_TABLE).set({ revoked_at: now }).where(eq('id', familyId)).toSql(),
    );
  });
}

/**
 * Revoke all refresh tokens for a user (used on logout all devices).
 *
 * This operation is wrapped in a transaction for atomicity.
 * If any operation fails, all changes are rolled back.
 *
 * @param db - Database client
 * @param userId - User ID to revoke all tokens for
 * @returns Promise that resolves when all tokens are revoked
 * @complexity O(1) - three database operations
 */
export async function revokeAllUserTokens(db: DbClient, userId: string): Promise<void> {
  await withTransaction(db, async (tx) => {
    const now = new Date();
    await tx.execute(
      update(REFRESH_TOKENS_TABLE)
        .set({
          family_revoked_at: now,
          family_revoke_reason: 'User logged out from all devices',
        })
        .where(eq('user_id', userId))
        .toSql(),
    );

    await tx.execute(deleteFrom(REFRESH_TOKENS_TABLE).where(eq('user_id', userId)).toSql());

    await tx.execute(
      update(USER_SESSIONS_TABLE).set({ revoked_at: now }).where(eq('user_id', userId)).toSql(),
    );
  });
}

/**
 * Clean up expired tokens (run periodically).
 *
 * @param db - Database client
 * @returns Number of tokens deleted
 * @complexity O(n) where n is the number of expired tokens
 */
export async function cleanupExpiredTokens(db: DbClient): Promise<number> {
  const result = await db.execute(
    deleteFrom(REFRESH_TOKENS_TABLE).where(lt('expires_at', new Date())).toSql(),
  );
  return result;
}
