// main/server/core/src/users/handlers/sessions.ts
/**
 * Sessions Service
 *
 * Business logic for user session management.
 * Handles listing, revoking, and managing refresh token families.
 *
 * @module handlers/sessions
 */

import { NotFoundError } from '@bslt/shared/system';

import { revokeTokenFamily } from '../../auth';

import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { RefreshTokenFamilyView } from '@bslt/db/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a user's active session.
 * Maps to a refresh token family in the database.
 */
export interface UserSession {
  /** Session (token family) unique identifier */
  id: string;
  /** When the session was created */
  createdAt: Date;
  /** When the latest refresh token in the session expires */
  expiresAt: Date;
  /** Last known activity for this session */
  lastUsedAt: Date;
  /** Human-readable device label, when available */
  device: string | null;
  /** IP address used when session was created */
  ipAddress: string | null;
  /** User agent string when session was created */
  userAgent: string | null;
  /** Whether this is the current session */
  isCurrent: boolean;
}

function normalizeDeviceValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function getSessionDeviceKey(family: RefreshTokenFamilyView): string {
  const deviceId = normalizeDeviceValue(family.deviceId);
  if (deviceId !== null) {
    return `device:${deviceId}`;
  }

  const ipAddress = normalizeDeviceValue(family.ipAddress) ?? 'unknown-ip';
  const userAgent = normalizeDeviceValue(family.userAgent)?.toLowerCase() ?? 'unknown-agent';
  if (ipAddress === 'unknown-ip' && userAgent === 'unknown-agent') {
    return `family:${family.familyId}`;
  }
  return `legacy:${ipAddress}:${userAgent}`;
}

function getDateTime(value: Date): number {
  const time = value.getTime();
  return Number.isFinite(time) ? time : 0;
}

function chooseDeviceSession(
  current: RefreshTokenFamilyView,
  next: RefreshTokenFamilyView,
  currentFamilyId?: string,
): RefreshTokenFamilyView {
  if (next.familyId === currentFamilyId) return next;
  if (current.familyId === currentFamilyId) return current;
  return getDateTime(next.familyCreatedAt) > getDateTime(current.familyCreatedAt) ? next : current;
}

function groupFamiliesByDevice(
  families: RefreshTokenFamilyView[],
  currentFamilyId?: string,
): RefreshTokenFamilyView[] {
  const familiesByDevice = new Map<string, RefreshTokenFamilyView>();

  for (const family of families) {
    const key = getSessionDeviceKey(family);
    const existing = familiesByDevice.get(key);
    familiesByDevice.set(
      key,
      existing === undefined ? family : chooseDeviceSession(existing, family, currentFamilyId),
    );
  }

  return Array.from(familiesByDevice.values()).sort((a, b) => {
    if (a.familyId === currentFamilyId) return -1;
    if (b.familyId === currentFamilyId) return 1;
    return getDateTime(b.familyCreatedAt) - getDateTime(a.familyCreatedAt);
  });
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * List all active sessions for a user.
 * Marks the current session based on the provided familyId.
 *
 * @param repos - Repository container
 * @param userId - ID of the user whose sessions to list
 * @param currentFamilyId - ID of the current session's token family
 * @returns Array of active user sessions
 * @complexity O(n) where n is the number of active sessions
 */
export async function listUserSessions(
  repos: Repositories,
  userId: string,
  currentFamilyId?: string,
): Promise<UserSession[]> {
  // Get all active (non-revoked) token families for this user
  const families = await repos.refreshTokens.findActiveFamilies(userId);
  const visibleFamilies = groupFamiliesByDevice(families, currentFamilyId);

  return visibleFamilies.map((family) => ({
    id: family.familyId,
    createdAt: family.familyCreatedAt,
    expiresAt: family.latestExpiresAt,
    lastUsedAt: family.familyCreatedAt,
    device: family.userAgent,
    ipAddress: family.ipAddress,
    userAgent: family.userAgent,
    isCurrent: family.familyId === currentFamilyId,
  }));
}

/**
 * Revoke a specific session.
 * Users cannot revoke their current session (use logout instead).
 *
 * @param repos - Repository container
 * @param userId - ID of the user who owns the session
 * @param sessionId - ID of the session to revoke
 * @param currentFamilyId - ID of the current session's token family
 * @throws NotFoundError if session is current, not found, or belongs to another user
 * @complexity O(1) - single database lookup and update
 */
export async function revokeSession(
  db: DbClient,
  repos: Repositories,
  userId: string,
  sessionId: string,
  currentFamilyId?: string,
): Promise<void> {
  // Don't allow revoking current session
  if (sessionId === currentFamilyId) {
    throw new NotFoundError('Cannot revoke current session. Use logout instead.');
  }

  // Verify the session belongs to this user
  const family = await repos.refreshTokens.findFamilyById(sessionId);

  if (family?.userId !== userId) {
    throw new NotFoundError('Session not found');
  }

  if (family.familyRevokedAt !== null) {
    // Already revoked, nothing to do
    return;
  }

  // Revoke the session and delete its refresh tokens so refresh fails immediately.
  await revokeTokenFamily(db, sessionId, 'User revoked session');
}

/**
 * Revoke all sessions except the current one.
 * Returns the count of revoked sessions.
 *
 * @param repos - Repository container
 * @param userId - ID of the user whose sessions to revoke
 * @param currentFamilyId - ID of the current session to exclude
 * @returns Number of sessions revoked
 * @complexity O(n) where n is the number of active sessions
 */
export async function revokeAllSessions(
  db: DbClient,
  repos: Repositories,
  userId: string,
  currentFamilyId?: string,
): Promise<number> {
  // Get all active sessions
  const families = await repos.refreshTokens.findActiveFamilies(userId);

  // Filter out the current session
  const sessionsToRevoke = families.filter((f) => f.familyId !== currentFamilyId);

  // Revoke each session
  let revokedCount = 0;
  for (const family of sessionsToRevoke) {
    await revokeTokenFamily(db, family.familyId, 'User logged out from all devices');
    revokedCount++;
  }

  return revokedCount;
}
