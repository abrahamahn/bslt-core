// main/server/core/src/auth/otp/service.ts
/**
 * Email OTP Service
 *
 * Business logic for passwordless authentication via a one-time 6-digit code
 * delivered by email. Handles code generation, rate limiting, brute-force
 * protection (per-code attempt cap), and verification.
 *
 * @module otp/service
 */

import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, select, update } from '@bslt/db/builder';
import { AUTH_TOKENS_TABLE, USER_COLUMNS, USERS_TABLE, type User } from '@bslt/db/schema';
import { toCamelCase, withTransaction } from '@bslt/db/utils';
import { QUOTAS } from '@bslt/shared/constants';
import { AUTH_EXPIRY } from '@bslt/shared/constants/core';
import { MS_PER_HOUR } from '@bslt/shared/constants/time';
import { validatePassword } from '@bslt/shared/core/auth';
import { isConsentConfirmed } from '@bslt/shared/core/compliance';
import { canReactivate, isAccountActive, isAttestationConfirmed } from '@bslt/shared/core/users';
import { canonicalizeEmail, normalizeEmail } from '@bslt/shared/helpers';
import { ConflictError, TooManyRequestsError } from '@bslt/shared/system';

import { EligibilityAttestationRequiredError } from '../attestation';
import {
  findSignupAgreementDocuments,
  insertConsentedUser,
  SignupConsentRequiredError,
} from '../consented-user';
import {
  AccountLockedError,
  EmailSendError,
  InvalidCredentialsError,
  InvalidTokenError,
  WeakPasswordError,
} from '../errors';
import { hasPassword } from '../password/service';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshTokenFamily,
  generateNumericCode,
  generateUniqueUsername,
  hashPassword,
  hashToken,
  type AuthUser,
} from '../utils';

import type { AuthEmailService, AuthEmailTemplates } from '../types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { CompleteOnboardingRequest } from '@bslt/shared/core/auth';
import type { AuthConfig } from '@bslt/shared/system/config';

// ============================================================================
// Constants
// ============================================================================

/** Number of digits in the OTP code. */
const CODE_DIGITS = 6;

/** Code expiry in minutes (default, can be overridden by options). */
const DEFAULT_CODE_EXPIRY_MINUTES = AUTH_EXPIRY.EMAIL_OTP_MINUTES;

/** Max requests per email per hour (default). */
const DEFAULT_MAX_REQUESTS_PER_EMAIL = QUOTAS.EMAIL_OTP_MAX_PER_EMAIL;

/** Max requests per IP per hour (default). */
const DEFAULT_MAX_REQUESTS_PER_IP = QUOTAS.EMAIL_OTP_MAX_PER_IP;

/** Max failed verification attempts before a code is invalidated. */
const MAX_VERIFY_ATTEMPTS = QUOTAS.EMAIL_OTP_MAX_VERIFY_ATTEMPTS;

/** Rate limit window in milliseconds (1 hour). */
const RATE_LIMIT_WINDOW_MS = MS_PER_HOUR;

// ============================================================================
// Types
// ============================================================================

/** Email OTP verification result (matches AuthResponseData from utils/response). */
export interface EmailOtpResult {
  accessToken: string;
  refreshToken: string;
  /** True when this verification just created the account (drives client onboarding). */
  isNewUser: boolean;
  /** Authenticated user data, including account-lifecycle fields (see AuthUser). */
  user: AuthUser;
}

/** Email OTP request result. */
export interface RequestEmailOtpResult {
  success: boolean;
  message: string;
}

/** Optional overrides for the OTP request flow. */
export interface EmailOtpRequestOptions {
  /** Code expiry in minutes (default: 10). */
  codeExpiryMinutes?: number;
  /** Max requests per email per hour (default: 5). */
  maxAttemptsPerEmail?: number;
  /** Max requests per IP per hour (default: 15). */
  maxAttemptsPerIp?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Hash a code bound to its target email. Binding the code to the email means a
 * leaked hash for one account can never validate another.
 *
 * @complexity O(1)
 */
function hashCodeForEmail(canonicalEmail: string, code: string): string {
  return hashToken(`${canonicalEmail}:${code}`);
}

/**
 * Read the attempt counter from a token's metadata.
 *
 * @complexity O(1)
 */
function readAttempts(metadata: unknown): number {
  if (metadata !== null && typeof metadata === 'object' && 'attempts' in metadata) {
    const value = (metadata as Record<string, unknown>)['attempts'];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return 0;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Request a one-time login code for passwordless authentication.
 *
 * Always returns success (enumeration-safe). Only one active code exists per
 * email at a time — requesting a new code invalidates the previous one.
 *
 * @param _db - Database client (kept for interface consistency)
 * @param repos - Repositories for database operations
 * @param emailService - Email service for sending the code
 * @param emailTemplates - Email templates for rendering the code email
 * @param email - User's email address
 * @param ipAddress - Client IP address (rate limiting + security logging)
 * @param userAgent - Client user agent (security logging)
 * @param options - Optional configuration overrides
 * @returns Result indicating success
 * @throws {TooManyRequestsError} If rate limit is exceeded
 * @complexity O(1)
 */
export async function requestEmailOtp(
  _db: DbClient,
  repos: Repositories,
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  email: string,
  ipAddress?: string,
  userAgent?: string,
  options?: EmailOtpRequestOptions,
): Promise<RequestEmailOtpResult> {
  const {
    codeExpiryMinutes = DEFAULT_CODE_EXPIRY_MINUTES,
    maxAttemptsPerEmail = DEFAULT_MAX_REQUESTS_PER_EMAIL,
    maxAttemptsPerIp = DEFAULT_MAX_REQUESTS_PER_IP,
  } = options ?? {};

  const normalizedEmail = normalizeEmail(email);
  const canonicalEmail = canonicalizeEmail(email);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  // Email-based rate limit
  const emailCount = await repos.authTokens.countRecentByEmail(
    canonicalEmail,
    windowStart,
    'email_otp',
  );
  if (emailCount >= maxAttemptsPerEmail) {
    throw new TooManyRequestsError('Too many code requests. Please try again later.');
  }

  // IP-based rate limit
  if (ipAddress !== undefined && ipAddress !== '') {
    const ipCount = await repos.authTokens.countRecentByIp(ipAddress, windowStart, 'email_otp');
    if (ipCount >= maxAttemptsPerIp) {
      throw new TooManyRequestsError(
        'Too many requests from this location. Please try again later.',
      );
    }
  }

  // Keep only one live code per email
  await repos.authTokens.invalidateActiveByEmail('email_otp', canonicalEmail);

  // Generate and store the code
  const code = generateNumericCode(CODE_DIGITS);
  const tokenHash = hashCodeForEmail(canonicalEmail, code);
  const expiresAt = new Date(Date.now() + codeExpiryMinutes * 60 * 1000);

  await repos.authTokens.create({
    type: 'email_otp',
    email: canonicalEmail,
    tokenHash,
    expiresAt,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
    metadata: { attempts: 0 },
  });

  // Send the code email
  const emailTemplate = emailTemplates.emailOtp(code, codeExpiryMinutes);
  try {
    const emailOptions: Parameters<typeof emailService.send>[0] = {
      to: normalizedEmail,
      subject: emailTemplate.subject,
    };
    if (emailTemplate.html !== undefined) {
      emailOptions.html = emailTemplate.html;
    }
    if (emailTemplate.text !== undefined) {
      emailOptions.text = emailTemplate.text;
    }
    await emailService.send(emailOptions);
  } catch (error) {
    throw new EmailSendError(
      'Failed to send security code email',
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  return {
    success: true,
    message: 'If an account exists for this email, a security code has been sent.',
  };
}

/**
 * Verify a one-time login code and authenticate the user.
 *
 * Looks up the single active code for the email, then compares hashes in the
 * application layer so failed attempts can be counted. After
 * {@link MAX_VERIFY_ATTEMPTS} failures the code is invalidated, defeating
 * brute force against the 6-digit space.
 *
 * @param db - Database client
 * @param repos - Repositories for username uniqueness checks
 * @param config - Auth configuration
 * @param email - The email the code was sent to
 * @param code - The 6-digit code entered by the user
 * @param eligibilityAttested - Confirmation of the signup eligibility statement;
 *   required only when the code would create a new account
 * @param tosAccepted - Consent to the published signup agreements; required only
 *   when the code would create a new account AND agreements are published
 * @returns Authentication result with tokens and user info
 * @throws {InvalidTokenError} If the code is invalid, expired, or exhausted — or the
 *   account is deactivated/pending deletion (generic to prevent status enumeration)
 * @throws {AccountLockedError} If the account is admin-locked
 * @throws {EligibilityAttestationRequiredError} If the code would create an account
 *   and no attestation was supplied — the code is NOT consumed
 * @throws {SignupConsentRequiredError} If the code would create an account and no
 *   consent to the published agreements was supplied — the code is NOT consumed
 *   and the attempt budget is NOT charged
 * @complexity O(1)
 */
export async function verifyEmailOtp(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  email: string,
  code: string,
  eligibilityAttested?: boolean,
  tosAccepted?: boolean,
): Promise<EmailOtpResult> {
  const canonicalEmail = canonicalizeEmail(email);
  const expectedHash = hashCodeForEmail(canonicalEmail, code);

  const result = await withTransaction(db, async (tx) => {
    const now = new Date();
    type TokenRecord = {
      id: string;
      email: string;
      token_hash: string;
      expires_at: Date;
      used_at: Date | null;
      metadata: unknown;
    };

    // Find the single active code for this email
    const tokenRecord = await tx.queryOne<TokenRecord>(
      select(AUTH_TOKENS_TABLE)
        .where(
          and(
            eq('type', 'email_otp'),
            eq('email', canonicalEmail),
            isNull('used_at'),
            gt('expires_at', now),
          ),
        )
        .orderBy('created_at', 'desc')
        .limit(1)
        .toSql(),
    );

    if (tokenRecord == null) {
      return { ok: false as const };
    }

    // Wrong code: count the attempt, invalidate once exhausted. The counter
    // update must be committed by the transaction (not thrown past, which would
    // roll it back), so signal failure by returning rather than throwing.
    if (tokenRecord.token_hash !== expectedHash) {
      const attempts = readAttempts(tokenRecord.metadata) + 1;
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await tx.execute(
          update(AUTH_TOKENS_TABLE).set({ used_at: now }).where(eq('id', tokenRecord.id)).toSql(),
        );
      } else {
        await tx.execute(
          update(AUTH_TOKENS_TABLE)
            .set({ metadata: { attempts } })
            .where(eq('id', tokenRecord.id))
            .toSql(),
        );
      }
      return { ok: false as const };
    }

    // Find existing user. Done BEFORE consuming the code, because whether this
    // code signs someone in or creates an account changes what we require.
    const userRow = await tx.queryOne(
      select(USERS_TABLE).where(eq('canonical_email', canonicalEmail)).limit(1).toSql(),
    );

    // A code for an email with no account would CREATE one. Refuse without the
    // eligibility confirmation or (while signup agreements are published) consent
    // to them — and refuse without consuming the code, so the person can simply
    // confirm and re-submit the code they already have. They have proved
    // possession of it already, so leaving it live grants nothing. Note the
    // ordering: a wrong code above still charges the attempt budget; a missing
    // confirmation on a CORRECT code must not.
    if (userRow == null) {
      if (!isAttestationConfirmed(eligibilityAttested)) {
        return { ok: false as const, needsAttestation: true as const };
      }
      // Consent is required only while signup agreements are published —
      // fail-open parity with insertConsentedUser (see ../consented-user).
      if (
        !isConsentConfirmed(tosAccepted) &&
        (await findSignupAgreementDocuments(repos)).length > 0
      ) {
        return { ok: false as const, needsConsent: true as const };
      }
    }

    // Correct code: atomically consume it (guards against a concurrent verify)
    const consumed = await tx.query(
      update(AUTH_TOKENS_TABLE)
        .set({ used_at: now })
        .where(and(eq('id', tokenRecord.id), isNull('used_at')))
        .returningAll()
        .toSql(),
    );
    if (consumed[0] == null) {
      return { ok: false as const };
    }

    let user: User | null = userRow != null ? toCamelCase<User>(userRow, USER_COLUMNS) : null;
    const isNewUser = user == null;

    // Account-status gate (parity with password login): admin-locked accounts
    // are blocked outright. Deactivated / within-grace pending-deletion accounts
    // are allowed through so the owner can self-service reactivate; only accounts
    // past an expired deletion grace period stay blocked. Returned (not thrown)
    // so the code consumption above still commits.
    if (user != null) {
      if (user.lockedUntil !== null && user.lockedUntil > now) {
        return {
          ok: false as const,
          locked: { lockedUntil: user.lockedUntil, lockReason: user.lockReason },
        };
      }
      if (!isAccountActive(user) && !canReactivate(user)) {
        return { ok: false as const };
      }
    }

    // Create the user on first sign-in (passwordless onboarding). Refuses unless
    // the eligibility statement was confirmed and the published agreements
    // consented to — the guard above already returned for those cases, so this is
    // the structural backstop, not the only check (a throw here rolls the consume
    // back, so the code still survives).
    if (user == null) {
      const username = await generateUniqueUsername(repos, tokenRecord.email);
      user = await insertConsentedUser(
        tx,
        repos,
        {
          email: normalizeEmail(tokenRecord.email),
          canonical_email: canonicalEmail,
          username,
          first_name: 'User',
          last_name: '',
          // OTP users have no password — store a random unusable hash
          password_hash: `emailotp:${randomBytes(32).toString('hex')}`,
          role: 'user',
          email_verified: true,
          email_verified_at: new Date(),
        },
        { agreed: tosAccepted, attested: eligibilityAttested },
      );
    } else if (!user.emailVerified) {
      const updatedRows = await tx.query(
        update(USERS_TABLE)
          .set({ email_verified: true, email_verified_at: new Date() })
          .where(eq('id', user.id))
          .returningAll()
          .toSql(),
      );
      if (updatedRows[0] != null) {
        user = toCamelCase<User>(updatedRows[0], USER_COLUMNS);
      }
    }

    const { token: refreshToken } = await createRefreshTokenFamily(
      tx,
      user.id,
      config.refreshToken.expiryDays,
    );

    return { ok: true as const, user, refreshToken, isNewUser };
  });

  // Throw outside the transaction so any committed attempt-counter update above
  // is preserved (throwing inside would roll it back, defeating the lockout).
  if (!result.ok) {
    if ('locked' in result) {
      const lockOpts: { lockReason?: string; lockedUntil?: string } = {
        lockedUntil: result.locked.lockedUntil.toISOString(),
      };
      if (result.locked.lockReason !== null) {
        lockOpts.lockReason = result.locked.lockReason;
      }
      throw new AccountLockedError(lockOpts);
    }
    // The code was valid but would have created an account. It has NOT been
    // consumed: the client prompts for the confirmation and re-submits this code.
    if ('needsAttestation' in result) {
      throw new EligibilityAttestationRequiredError();
    }
    if ('needsConsent' in result) {
      throw new SignupConsentRequiredError();
    }
    throw new InvalidTokenError('Invalid or expired security code');
  }

  const accessToken = createAccessToken(
    result.user.id,
    result.user.email,
    result.user.role,
    config.jwt.secret,
    config.jwt.accessTokenExpiry,
    result.user.tokenVersion,
  );

  return {
    ...createAuthResponse(accessToken, result.refreshToken, result.user),
    isNewUser: result.isNewUser,
  };
}

/**
 * Complete profile for a brand-new passwordless user: set the real name, a chosen
 * username, and a first password. Only callable while the account still carries a
 * passwordless sentinel hash, so an already-onboarded user cannot rename via this path.
 *
 * @throws {InvalidCredentialsError} If the user does not exist
 * @throws {ConflictError} If onboarding is already complete or the username is taken
 * @throws {WeakPasswordError} If the password fails policy
 * @complexity O(1)
 */
export async function completeOnboarding(
  _db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  userId: string,
  input: CompleteOnboardingRequest,
): Promise<User> {
  const user = await repos.users.findById(userId);
  if (user === null) {
    throw new InvalidCredentialsError();
  }

  // Guard: only passwordless new accounts may onboard. A real password means done.
  if (hasPassword(user.passwordHash)) {
    throw new ConflictError('Onboarding has already been completed');
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const username = input.username.trim();

  const existing = await repos.users.findByUsername(username);
  if (existing !== null && existing.id !== userId) {
    throw new ConflictError('Username is already taken');
  }

  const passwordValidation = validatePassword(input.password, [
    user.email,
    username,
    firstName,
    lastName,
  ]);
  if (!passwordValidation.isValid) {
    throw new WeakPasswordError({ errors: passwordValidation.errors });
  }

  const passwordHash = await hashPassword(input.password, config.argon2);

  const updated = await repos.users.update(userId, {
    firstName,
    lastName,
    username,
    passwordHash,
  });
  if (updated === null) {
    throw new Error('Failed to complete onboarding');
  }

  return updated;
}
