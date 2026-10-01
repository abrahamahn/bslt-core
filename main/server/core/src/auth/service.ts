// main/server/core/src/auth/service.ts
/**
 * Auth Service
 *
 * Pure business logic for authentication operations.
 * No HTTP awareness - returns domain objects or throws errors.
 *
 * @module service
 */

import { randomUUID } from 'node:crypto';

import { eq, update } from '@bslt/db/builder';
import { USERS_TABLE } from '@bslt/db/schema';
import { withTransaction } from '@bslt/db/utils';
import { getMetricsCollector } from '@bslt/server-system/observability';
import { sign as jwtSign } from '@bslt/server-system/security';
import { type BreadcrumbData } from '@bslt/shared/contracts';
import { validatePassword } from '@bslt/shared/core/auth';
import { canReactivate, isAccountActive } from '@bslt/shared/core/users';
import { canonicalizeEmail, normalizeEmail } from '@bslt/shared/helpers';
import { TooManyRequestsError } from '@bslt/shared/system';

import { record } from '../audit/service';
import { notifyAdmins } from '../notifications/admin-alerts';

import { insertConsentedUser } from './consented-user';
import {
  AccountLockedError,
  EmailNotVerifiedError,
  EmailSendError,
  InvalidCredentialsError,
  InvalidTokenError,
  WeakPasswordError,
} from './errors';
import { invalidateLiveness } from './liveness-cache';
import {
  getAccountLockoutStatus,
  getProgressiveDelay,
  isAccountLocked,
  logAccountLockedEvent,
  logLoginAttempt,
} from './security';
import { buildEmailOptions } from './support/email';
import { LOGIN_FAILURE_REASON } from './types';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshTokenFamily,
  hashPassword,
  needsRehash,
  rotateRefreshToken as rotateRefreshTokenUtil,
  verifyPasswordSafe,
} from './utils';
import { createEmailVerificationToken, resendVerificationEmail } from './verification/service';

import type {
  AuthResult,
  RefreshResult,
  RegisterResult,
  SmsChallengeResult,
  TotpChallengeResult,
} from './results';
import type { AuthEmailService, AuthEmailTemplates, AuthLogger } from './types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { AuthConfig } from '@bslt/shared/system/config';

export type {
  AuthResult,
  RefreshResult,
  RegisterResult,
  SmsChallengeResult,
  TotpChallengeResult,
} from './results';

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Register a new user.
 * Creates user with unverified email and sends verification email.
 * Returns pending status, user must verify email to complete registration.
 *
 * @param db - Database client
 * @param repos - Repositories
 * @param emailService - Email service
 * @param emailTemplates - Email templates
 * @param config - Auth configuration
 * @param email - User email
 * @param password - User password
 * @param username - Unique username (1-15 chars, alphanumeric + underscores)
 * @param firstName - User first name
 * @param lastName - User last name
 * @param baseUrl - Base URL for verification link
 * @returns Registration result
 * @throws {WeakPasswordError} If password is too weak
 * @throws {EmailSendError} If verification email fails
 * @complexity O(1) - constant database operations
 */
export async function registerUser(
  db: DbClient,
  repos: Repositories,
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  config: AuthConfig,
  email: string,
  password: string,
  username: string,
  firstName: string,
  lastName: string,
  baseUrl?: string,
  options: {
    /**
     * Consent to the published signup agreements (ToS, Privacy Policy).
     * Enforced by {@link insertConsentedUser} below — while agreements are
     * published, an unconfirmed value creates no account.
     */
    tosAccepted?: boolean;
    /**
     * Confirmation of the signup eligibility statement. Enforced by
     * {@link insertConsentedUser} below — an unconfirmed value creates no account.
     */
    eligibilityAttested?: boolean;
    ipAddress?: string;
    userAgent?: string;
    /** Structured logger for non-fatal email failures (never logs PII) */
    logger?: AuthLogger;
  } = {},
): Promise<RegisterResult> {
  const { tosAccepted, eligibilityAttested, ipAddress, logger } = options;
  const normalizedEmail = normalizeEmail(email);
  const canonicalEmail = canonicalizeEmail(email);

  // Check if email is already taken (using repository)
  const existingUser = await repos.users.findByEmail(canonicalEmail);

  if (existingUser !== null) {
    if (!existingUser.emailVerified && baseUrl !== undefined && baseUrl !== '') {
      // Unverified account exists — resend verification email so user can complete registration
      try {
        await resendVerificationEmail(
          db,
          repos,
          emailService,
          emailTemplates,
          existingUser.email,
          baseUrl,
        );
      } catch (error) {
        // Log the error but don't expose it to the client (enumeration-safe response)
        logger?.warn(
          { reason: error instanceof Error ? error.message : String(error) },
          'Registration: failed to resend verification email for existing unverified account',
        );
      }
    } else {
      // Verified account — notify about registration attempt (prevents enumeration)
      try {
        const emailTemplate = emailTemplates.existingAccountRegistrationAttempt(existingUser.email);
        const sendResult = await emailService.send(
          buildEmailOptions(existingUser.email, emailTemplate),
        );
        if (!sendResult.success) {
          logger?.warn(
            { reason: sendResult.error ?? 'unknown send failure' },
            'Registration: failed to send existing-account notification email',
          );
        }
      } catch (error) {
        // Log the error but don't expose it to the client (enumeration-safe response)
        logger?.warn(
          { reason: error instanceof Error ? error.message : String(error) },
          'Registration: failed to send existing-account notification email',
        );
      }
    }
    return {
      status: 'pending_verification',
      message:
        'Registration successful! Please check your email inbox and click the confirmation link to complete your registration.',
      email: normalizedEmail,
    };
  }

  // Check if username is already taken
  const existingUsername = await repos.users.findByUsername(username);
  if (existingUsername !== null) {
    const error = new Error('Username is already taken');
    error.name = 'ConflictError';
    throw error;
  }

  // Validate password strength (include personal info for dictionary check)
  const passwordValidation = validatePassword(password, [
    normalizedEmail,
    username,
    firstName,
    lastName,
  ]);
  if (!passwordValidation.isValid) {
    throw new WeakPasswordError({ errors: passwordValidation.errors });
  }

  const passwordHash = await hashPassword(password, config.argon2);

  // Demo/testing convenience: create the account already verified and skip the
  // verification email so the client can auto-log-in. Guarded by env flag —
  // real deployments leave this false and follow the pending-verification flow.
  const autoVerify = config.autoVerifyEmail === true;

  // Create user and (unless auto-verifying) a verification token atomically
  const { user, verificationToken } = await withTransaction(db, async (tx) => {
    // Refuses (and rolls back) unless the signup agreements were accepted and
    // the eligibility statement confirmed; records one consent row per agreement.
    const newUser = await insertConsentedUser(
      tx,
      repos,
      {
        email: normalizedEmail,
        canonical_email: canonicalEmail,
        username,
        first_name: firstName,
        last_name: lastName,
        password_hash: passwordHash,
        role: 'user',
        email_verified: autoVerify,
        ...(autoVerify ? { email_verified_at: new Date() } : {}),
      },
      { agreed: tosAccepted, attested: eligibilityAttested, ipAddress },
    );

    // Create email verification token (skipped when the account is auto-verified)
    const token: string | null = autoVerify
      ? null
      : await createEmailVerificationToken(tx, newUser.id);

    return { user: newUser, verificationToken: token };
  });

  // Fire-and-forget: alert admins/moderators of the new signup
  void notifyAdmins(
    { repos },
    {
      type: 'user_signup',
      subject: { userId: user.id, email: user.email, username: user.username },
    },
  );

  // Fire-and-forget security audit entry so the admin audit log reflects signups.
  record(
    { auditEvents: repos.auditEvents },
    {
      actorId: user.id,
      action: 'user.registered',
      resource: 'user',
      resourceId: user.id,
      category: 'security',
      metadata: { username: user.username },
      ipAddress: ipAddress ?? null,
      userAgent: options.userAgent ?? null,
    },
  ).catch(() => {});

  // Auto-verified accounts skip the verification email entirely; the client
  // logs in immediately with the same credentials it already holds.
  if (autoVerify) {
    return {
      status: 'verified',
      message: 'Account created. Signing you in…',
      email: user.email,
    };
  }

  // Send verification email (baseUrl is required, provided by handlers)
  if (baseUrl === undefined || baseUrl === '' || verificationToken === null) {
    throw new Error('baseUrl is required to send verification emails');
  }
  const verifyUrl = `${baseUrl}/auth/confirm-email?token=${verificationToken}`;
  const emailTemplate = emailTemplates.emailVerification(verifyUrl);

  try {
    const result = await emailService.send(buildEmailOptions(normalizedEmail, emailTemplate));
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown email error');
    }
  } catch (error) {
    // User was created but email failed - throw specific error so handler can handle gracefully
    throw new EmailSendError(
      'Failed to send verification email',
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  return {
    status: 'pending_verification',
    message:
      'Registration successful! Please check your email inbox and click the confirmation link to complete your registration.',
    email: user.email,
  };
}

/**
 * Authenticate a user with email and password.
 * Returns auth result with tokens, throws on failure.
 *
 * @param db - Database client
 * @param repos - Repositories
 * @param config - Auth configuration
 * @param identifier - Email or username (auto-detected via '@')
 * @param password - User password
 * @param logger - Logger instance
 * @param ipAddress - Client IP address
 * @param userAgent - Client user agent
 * @param onPasswordRehash - Callback for password rehash events
 * @param deviceId - Stable browser device ID, when available
 * @returns Authentication result, or TOTP challenge if 2FA is enabled
 * @throws {AccountLockedError} If account is locked
 * @throws {InvalidCredentialsError} If credentials are invalid
 * @throws {EmailNotVerifiedError} If email is not verified
 * @complexity O(1) - constant database operations
 */
export async function authenticateUser(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  identifier: string,
  password: string,
  logger: AuthLogger,
  ipAddress?: string,
  userAgent?: string,
  onPasswordRehash?: (userId: string, error?: Error) => void,
  errorTracker?: { addBreadcrumb: (m: string, d: BreadcrumbData) => void },
  deviceId?: string,
  /**
   * The session's span in days, from the caller's remember-me choice. It sets
   * the token family's expiry, and the refresh path later recovers it from the
   * row's own dates so a rotation preserves what the user chose.
   */
  spanDays?: number,
): Promise<AuthResult | TotpChallengeResult | SmsChallengeResult> {
  errorTracker?.addBreadcrumb('Authenticating user', {
    category: 'auth',
    data: { identifier: identifier.includes('@') ? 'email' : 'username' },
  });

  // Resolve identifier: email (contains '@') or username
  const isEmail = identifier.includes('@');
  const normalizedIdentifier = isEmail ? normalizeEmail(identifier) : identifier;
  const canonicalIdentifier = isEmail ? canonicalizeEmail(identifier) : identifier;
  const user = isEmail
    ? await repos.users.findByEmail(canonicalIdentifier)
    : await repos.users.findByUsername(normalizedIdentifier);

  // Use email for lockout tracking (fall back to normalized identifier if user not found)
  const lockoutKey = user?.email ?? (isEmail ? canonicalIdentifier : normalizedIdentifier);

  // Check if account is locked
  const locked = await isAccountLocked(db, lockoutKey, config.lockout);
  if (locked) {
    errorTracker?.addBreadcrumb('Account locked', { category: 'auth', level: 'warn' });
    await logLoginAttempt(
      db,
      lockoutKey,
      false,
      ipAddress,
      userAgent,
      LOGIN_FAILURE_REASON.ACCOUNT_LOCKED,
    );
    throw new AccountLockedError();
  }

  // Progressive delay should not block the HTTP request thread.
  // Return a fast 429 with retry guidance instead of sleeping.
  const progressiveDelayMs = await getProgressiveDelay(db, lockoutKey, config.lockout);
  if (progressiveDelayMs > 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil(progressiveDelayMs / 1000));
    throw new TooManyRequestsError(
      `Too many login attempts. Please try again in ${String(retryAfterSeconds)} seconds.`,
    );
  }

  // Timing-safe password verification
  const isValid = await verifyPasswordSafe(password, user?.passwordHash);

  if (user === null) {
    errorTracker?.addBreadcrumb('User not found', { category: 'auth', level: 'warn' });
    await handleFailedLogin(
      db,
      config,
      lockoutKey,
      LOGIN_FAILURE_REASON.USER_NOT_FOUND,
      ipAddress,
      userAgent,
    );
    throw new InvalidCredentialsError();
  }

  if (!isValid) {
    errorTracker?.addBreadcrumb('Password mismatch', { category: 'auth', level: 'warn' });
    await handleFailedLogin(
      db,
      config,
      lockoutKey,
      LOGIN_FAILURE_REASON.PASSWORD_MISMATCH,
      ipAddress,
      userAgent,
    );
    throw new InvalidCredentialsError();
  }

  // Check admin-imposed account lock (lockedUntil field on user record)
  if (user.lockedUntil !== null) {
    if (user.lockedUntil > new Date()) {
      errorTracker?.addBreadcrumb('Account suspended by admin', {
        category: 'auth',
        level: 'warn',
      });
      await logLoginAttempt(
        db,
        lockoutKey,
        false,
        ipAddress,
        userAgent,
        LOGIN_FAILURE_REASON.ACCOUNT_LOCKED,
      );
      const lockOpts: { retryAfterMs?: number; lockReason?: string; lockedUntil?: string } = {
        lockedUntil: user.lockedUntil.toISOString(),
      };
      if (user.lockReason !== null) {
        lockOpts.lockReason = user.lockReason;
      }
      throw new AccountLockedError(lockOpts);
    }
    // Lock expired — auto-unlock (fire-and-forget)
    invalidateLiveness(user.id);
    repos.users.unlockAccount(user.id).catch(() => {});
  }

  // Account-status gate. Deactivated or within-grace pending-deletion accounts
  // are allowed to complete login so the owner can self-service reactivate
  // (the login response carries deactivatedAt/deletedAt for the client to prompt
  // on). Only accounts past the point of no return — pending deletion with an
  // expired grace period — remain blocked with a generic error.
  if (!isAccountActive(user) && !canReactivate(user)) {
    errorTracker?.addBreadcrumb(`Login blocked: ${LOGIN_FAILURE_REASON.ACCOUNT_DELETED}`, {
      category: 'auth',
      level: 'warn',
    });
    await logLoginAttempt(
      db,
      lockoutKey,
      false,
      ipAddress,
      userAgent,
      LOGIN_FAILURE_REASON.ACCOUNT_DELETED,
    );
    // Return generic error to prevent account status enumeration
    throw new InvalidCredentialsError();
  }

  // Check if email is verified
  if (!user.emailVerified) {
    errorTracker?.addBreadcrumb('Email not verified', { category: 'auth', level: 'warn' });
    await logLoginAttempt(
      db,
      lockoutKey,
      false,
      ipAddress,
      userAgent,
      LOGIN_FAILURE_REASON.UNVERIFIED_EMAIL,
    );
    throw new EmailNotVerifiedError(user.email);
  }

  // Check if TOTP (2FA) is enabled — return challenge instead of tokens
  if (user.totpEnabled) {
    errorTracker?.addBreadcrumb('TOTP challenge required', { category: 'auth' });
    await logLoginAttempt(
      db,
      lockoutKey,
      true,
      ipAddress,
      userAgent,
      LOGIN_FAILURE_REASON.TOTP_REQUIRED,
    );

    // Check if password hash needs upgrading (background task)
    if (needsRehash(user.passwordHash)) {
      rehashPassword(db, config, user.id, password, logger, onPasswordRehash);
    }

    const challengeToken = jwtSign(
      // The jti gives the otherwise-stateless challenge an identity the verify
      // step can burn once its 5/min guess budget is spent (totp-challenge-guard).
      { userId: user.id, purpose: 'totp_challenge', jti: randomUUID() },
      config.jwt.secret,
      { expiresIn: '5m' },
    );

    return {
      requiresTotp: true,
      challengeToken,
      message: 'Two-factor authentication required. Please enter your TOTP code.',
    };
  }

  // Check if SMS 2FA is active (phone verified, TOTP not enabled)
  if (user.phoneVerified === true) {
    errorTracker?.addBreadcrumb('SMS challenge required', { category: 'auth' });
    await logLoginAttempt(
      db,
      lockoutKey,
      true,
      ipAddress,
      userAgent,
      LOGIN_FAILURE_REASON.SMS_REQUIRED,
    );

    // Check if password hash needs upgrading (background task)
    if (needsRehash(user.passwordHash)) {
      rehashPassword(db, config, user.id, password, logger, onPasswordRehash);
    }

    const challengeToken = jwtSign(
      { userId: user.id, purpose: 'sms_challenge' },
      config.jwt.secret,
      { expiresIn: '5m' },
    );

    return {
      requiresSms: true,
      challengeToken,
      message: 'SMS verification required. Please request a code.',
    };
  }

  errorTracker?.addBreadcrumb('Login successful', { category: 'auth' });
  // Create tokens and log success atomically
  const { refreshToken, sessionFamilyId } = await withTransaction(db, async (tx) => {
    await logLoginAttempt(tx, lockoutKey, true, ipAddress, userAgent);
    const sessionMeta: { deviceId?: string; ipAddress?: string; userAgent?: string } = {};
    if (ipAddress !== undefined) {
      sessionMeta.ipAddress = ipAddress;
    }
    if (userAgent !== undefined) {
      sessionMeta.userAgent = userAgent;
    }
    if (deviceId !== undefined) {
      sessionMeta.deviceId = deviceId;
    }
    const { familyId, token } = await createRefreshTokenFamily(
      tx,
      user.id,
      spanDays ?? config.refreshToken.expiryDays,
      sessionMeta,
    );
    return { refreshToken: token, sessionFamilyId: familyId };
  });

  // Check if password hash needs upgrading (background task)
  if (needsRehash(user.passwordHash)) {
    rehashPassword(db, config, user.id, password, logger, onPasswordRehash);
  }

  // Create access token
  const accessToken = createAccessToken(
    user.id,
    user.email,
    user.role,
    config.jwt.secret,
    config.jwt.accessTokenExpiry,
    user.tokenVersion,
  );

  return {
    ...createAuthResponse(accessToken, refreshToken, user),
    sessionFamilyId,
  };
}

/**
 * Refresh tokens using a valid refresh token.
 * Returns new tokens, throws if invalid.
 *
 * @param db - Database client
 * @param _repos - Repositories (unused, kept for interface consistency)
 * @param config - Auth configuration
 * @param oldRefreshToken - Current refresh token
 * @param ipAddress - Client IP address
 * @param userAgent - Client user agent
 * @returns New token pair
 * @throws {InvalidTokenError} If refresh token is invalid
 * @complexity O(1) - constant database operations
 */
export async function refreshUserTokens(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  oldRefreshToken: string,
  ipAddress?: string,
  userAgent?: string,
  spanDays?: number,
): Promise<RefreshResult> {
  const result = await rotateRefreshTokenUtil(
    db,
    oldRefreshToken,
    ipAddress,
    userAgent,
    // The session's own span, recovered by the caller from the row being rotated.
    // Falling back to the config default here is what let a rotation rewrite the
    // span: a 12-hour login became a 7-day token while its cookie still said 12
    // hours, and a remembered 30-day session shrank to 7 — the cookie/server
    // disagreement `auth.session.logic.ts` exists to prevent, reintroduced one
    // layer down because only the cookie was given the recovered value.
    spanDays ?? config.refreshToken.expiryDays,
    config.refreshToken.gracePeriodSeconds,
  );

  if (result === null) {
    throw new InvalidTokenError();
  }

  // Check token version: reject if all sessions were invalidated
  const user = await repos.users.findById(result.userId);
  if (user === null) {
    throw new InvalidTokenError();
  }

  // Create new access token with current tokenVersion
  const accessToken = createAccessToken(
    result.userId,
    result.email,
    result.role,
    config.jwt.secret,
    config.jwt.accessTokenExpiry,
    user.tokenVersion,
  );

  return {
    accessToken,
    refreshToken: result.token,
  };
}

/**
 * Logout user by invalidating their refresh token.
 *
 * @param _db - Database client (unused, kept for interface consistency)
 * @param repos - Repositories
 * @param refreshToken - Refresh token to invalidate
 * @complexity O(1)
 */
export async function logoutUser(
  _db: DbClient,
  repos: Repositories,
  refreshToken?: string,
): Promise<void> {
  if (refreshToken !== undefined && refreshToken !== '') {
    await repos.refreshTokens.deleteByToken(refreshToken);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle a failed login attempt.
 *
 * @param db - Database client
 * @param config - Auth configuration
 * @param email - User email
 * @param reason - Failure reason
 * @param ipAddress - Client IP address
 * @param userAgent - Client user agent
 * @complexity O(1)
 */
async function handleFailedLogin(
  db: DbClient,
  config: AuthConfig,
  email: string,
  reason: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await logLoginAttempt(db, email, false, ipAddress, userAgent, reason);
  const lockoutStatus = await getAccountLockoutStatus(db, email, config.lockout);
  if (lockoutStatus.isLocked) {
    getMetricsCollector().recordLockout();
    await logAccountLockedEvent(db, email, lockoutStatus.failedAttempts, ipAddress, userAgent);
  }
}

/**
 * Rehash password in the background (fire-and-forget with retry).
 *
 * @param db - Database client
 * @param config - Auth configuration
 * @param userId - User ID
 * @param password - Plain text password
 * @param logger - Logger instance
 * @param callback - Optional callback for rehash events
 * @param retryCount - Remaining retry attempts
 * @complexity O(1) per attempt
 */
function rehashPassword(
  db: DbClient,
  config: AuthConfig,
  userId: string,
  password: string,
  logger: AuthLogger,
  callback?: (userId: string, error?: Error) => void,
  retryCount = 3,
): void {
  // Fire and forget - don't block login
  hashPassword(password, config.argon2)
    .then((newHash) =>
      db.execute(
        update(USERS_TABLE).set({ password_hash: newHash }).where(eq('id', userId)).toSql(),
      ),
    )
    .then(() => callback?.(userId))
    .catch((error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      // Always log rehash failures for observability
      logger.error('Failed to upgrade password hash', {
        userId,
        error: normalizedError.message,
        stack: normalizedError.stack,
        retryCount,
      });

      if (retryCount > 0) {
        setTimeout(
          () => {
            rehashPassword(db, config, userId, password, logger, callback, retryCount - 1);
          },
          1000 * (4 - retryCount),
        ); // 1s, 2s, 3s
      } else {
        callback?.(userId, normalizedError);
      }
    });
}
