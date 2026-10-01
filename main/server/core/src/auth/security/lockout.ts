// main/server/core/src/auth/security/lockout.ts
/**
 * Account Lockout Functions
 *
 * Handles login attempt tracking, progressive delays, and account lockout.
 *
 * @module security/lockout
 */

import { and, eq, gte, inArray, insert, select, selectCount } from '@bslt/db/builder';
import { LOGIN_ATTEMPTS_TABLE, USERS_TABLE } from '@bslt/db/schema';

import {
  LOGIN_FAILURE_REASON,
  MAX_PROGRESSIVE_DELAY_MS,
  PROGRESSIVE_DELAY_WINDOW_MS,
} from '../types';

import { logAccountUnlockedEvent } from './events';

import type { LockoutConfig, LockoutStatus } from './types';
import type { DbClient } from '@bslt/db/client';

const CREDENTIAL_FAILURE_REASONS = [
  LOGIN_FAILURE_REASON.USER_NOT_FOUND,
  LOGIN_FAILURE_REASON.PASSWORD_MISMATCH,
] as const;

/**
 * Count credential failures for an email within a time window.
 *
 * @param db - Database client
 * @param email - User email
 * @param windowStart - Start of the time window
 * @returns Number of failed attempts
 * @complexity O(1) - database index lookup
 */
async function countFailedAttempts(
  db: DbClient,
  email: string,
  windowStart: Date,
): Promise<number> {
  const filter = and(
    eq('email', email),
    eq('success', false),
    inArray('failure_reason', CREDENTIAL_FAILURE_REASONS),
    gte('created_at', windowStart),
  );
  const result = await db.queryOne<{ count: number }>(
    selectCount(LOGIN_ATTEMPTS_TABLE).where(filter).toSql(),
  );

  return result?.count ?? 0;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getMostRecentFailedAttemptAt(
  db: DbClient,
  email: string,
  windowStart: Date,
): Promise<Date | null> {
  type AttemptRow = Record<string, unknown> & { created_at?: unknown };
  const row = await db.queryOne<AttemptRow>(
    select(LOGIN_ATTEMPTS_TABLE)
      .columns('created_at')
      .where(
        and(
          eq('email', email),
          eq('success', false),
          inArray('failure_reason', CREDENTIAL_FAILURE_REASONS),
          gte('created_at', windowStart),
        ),
      )
      .orderBy('created_at', 'desc')
      .limit(1)
      .toSql(),
  );

  return coerceDate(row?.created_at);
}

/**
 * Log a login attempt to the database.
 *
 * @param db - Database client
 * @param email - User email
 * @param success - Whether the login attempt succeeded
 * @param ipAddress - Client IP address
 * @param userAgent - Client user agent
 * @param failureReason - Reason for failure (if applicable)
 * @returns Promise that resolves when the attempt is logged
 * @complexity O(1)
 */
export async function logLoginAttempt(
  db: DbClient,
  email: string,
  success: boolean,
  ipAddress?: string,
  userAgent?: string,
  failureReason?: string,
): Promise<void> {
  await db.execute(
    insert(LOGIN_ATTEMPTS_TABLE)
      .values({
        email,
        success,
        ip_address: ipAddress != null && ipAddress !== '' ? ipAddress : null,
        user_agent: userAgent != null && userAgent !== '' ? userAgent : null,
        failure_reason: failureReason != null && failureReason !== '' ? failureReason : null,
      })
      .toSql(),
  );
}

/**
 * Check if an account is currently locked out.
 *
 * @param db - Database client
 * @param email - User email to check
 * @param lockoutConfig - Lockout configuration
 * @returns True if the account is locked, false otherwise
 * @complexity O(1) - database count query
 */
export async function isAccountLocked(
  db: DbClient,
  email: string,
  lockoutConfig: LockoutConfig,
): Promise<boolean> {
  const lockoutWindow = new Date(Date.now() - lockoutConfig.lockoutDurationMs);
  const failedAttempts = await countFailedAttempts(db, email, lockoutWindow);
  return failedAttempts >= lockoutConfig.maxAttempts;
}

/**
 * Get progressive delay in milliseconds based on failed attempt count.
 * Implements exponential backoff: 1s, 2s, 4s, 8s, 16s...
 *
 * @param db - Database client
 * @param email - User email
 * @param lockoutConfig - Lockout configuration
 * @returns Delay in milliseconds (0 if no delay needed)
 * @complexity O(1) - database count query
 */
export async function getProgressiveDelay(
  db: DbClient,
  email: string,
  lockoutConfig: LockoutConfig,
): Promise<number> {
  if (!lockoutConfig.progressiveDelay) {
    return 0;
  }

  const now = Date.now();
  const progressiveDelayWindow = new Date(now - PROGRESSIVE_DELAY_WINDOW_MS);
  const failedAttempts = await countFailedAttempts(db, email, progressiveDelayWindow);

  if (failedAttempts === 0) {
    return 0;
  }

  // Exponential backoff: baseDelay * 2^(attempts - 1)
  // Cap at MAX_PROGRESSIVE_DELAY_MS to prevent excessive delays
  const delay = Math.min(
    lockoutConfig.baseDelayMs * Math.pow(2, failedAttempts - 1),
    MAX_PROGRESSIVE_DELAY_MS,
  );

  const mostRecentFailedAttemptAt = await getMostRecentFailedAttemptAt(
    db,
    email,
    progressiveDelayWindow,
  );
  if (mostRecentFailedAttemptAt === null) return 0;

  const elapsedMs = now - mostRecentFailedAttemptAt.getTime();
  return Math.max(0, delay - elapsedMs);
}

/**
 * Apply progressive delay before allowing next login attempt.
 *
 * @param db - Database client
 * @param email - User email
 * @param lockoutConfig - Lockout configuration
 * @returns Promise that resolves after the delay
 * @complexity O(1) + delay time
 */
export async function applyProgressiveDelay(
  db: DbClient,
  email: string,
  lockoutConfig: LockoutConfig,
): Promise<void> {
  const delay = await getProgressiveDelay(db, email, lockoutConfig);
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Keep login attempts for audit trail.
 *
 * Lockout and progressive delay only count recent credential failures. Successful
 * login attempts are recorded separately by the caller and do not need cleanup.
 *
 * @param _db - Database client (unused - kept for API compatibility)
 * @param _email - User email (unused - kept for API compatibility)
 * @returns Promise that resolves immediately
 * @complexity O(1)
 */
export async function clearLoginAttempts(_db: DbClient, _email: string): Promise<void> {
  // No-op: login attempts are retained for audit history.
}

/**
 * Get detailed account lockout status.
 * Returns information about current lockout state and remaining time.
 *
 * @param db - Database client
 * @param email - User email
 * @param lockoutConfig - Lockout configuration
 * @returns Lockout status information
 * @complexity O(1) - database queries
 */
export async function getAccountLockoutStatus(
  db: DbClient,
  email: string,
  lockoutConfig: LockoutConfig,
): Promise<LockoutStatus> {
  const lockoutWindow = new Date(Date.now() - lockoutConfig.lockoutDurationMs);
  const failedAttempts = await countFailedAttempts(db, email, lockoutWindow);
  const isLocked = failedAttempts >= lockoutConfig.maxAttempts;

  if (!isLocked) {
    return {
      isLocked: false,
      failedAttempts,
    };
  }

  const mostRecentAttemptAt = await getMostRecentFailedAttemptAt(db, email, lockoutWindow);

  if (mostRecentAttemptAt !== null) {
    const lockedUntil = new Date(mostRecentAttemptAt.getTime() + lockoutConfig.lockoutDurationMs);
    const remainingTime = Math.max(0, lockedUntil.getTime() - Date.now());

    return {
      isLocked: true,
      failedAttempts,
      remainingTime,
      lockedUntil,
    };
  }

  return {
    isLocked: true,
    failedAttempts,
  };
}

/**
 * Manually unlock an account (admin function).
 * Clears failed login attempts by logging a successful "unlock" event.
 *
 * IMPORTANT: This should only be called by authorized admin users.
 * Caller is responsible for authorization checks.
 *
 * @param db - Database client
 * @param email - User email to unlock
 * @param adminUserId - ID of admin performing the unlock (for audit trail)
 * @param reason - Reason for unlocking the account (for audit trail)
 * @param ipAddress - Optional IP address of admin performing unlock
 * @param userAgent - Optional user agent of admin performing unlock
 * @returns Promise that resolves when account is unlocked
 * @complexity O(1) - database queries
 */
export async function unlockAccount(
  db: DbClient,
  email: string,
  adminUserId: string,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  // Get user info for logging
  type UserRow = Record<string, unknown> & { id: string };
  const user = await db.queryOne<UserRow>(
    select(USERS_TABLE).columns('id').where(eq('email', email)).limit(1).toSql(),
  );

  // Log a manual unlock event
  // The success: true entry will reset the failed attempt counter
  await db.execute(
    insert(LOGIN_ATTEMPTS_TABLE)
      .values({
        email,
        success: true,
        failure_reason: `Unlocked by admin ${adminUserId}: ${reason}`,
        ip_address: ipAddress != null && ipAddress !== '' ? ipAddress : null,
        user_agent: userAgent != null && userAgent !== '' ? userAgent : 'Admin Console',
      })
      .toSql(),
  );

  // Log security event
  if (user != null) {
    await logAccountUnlockedEvent(db, user.id, email, adminUserId, ipAddress, userAgent);
  }
}
