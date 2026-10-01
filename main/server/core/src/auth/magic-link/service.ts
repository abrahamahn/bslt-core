// main/server/core/src/auth/magic-link/service.ts
/**
 * Magic Link Service
 *
 * Business logic for passwordless authentication via magic links.
 * Handles token generation, verification, and rate limiting.
 *
 * @module magic-link/service
 */

import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, select, update } from '@bslt/db/builder';
import { AUTH_TOKENS_TABLE, USER_COLUMNS, USERS_TABLE, type User } from '@bslt/db/schema';
import { toCamelCase, withTransaction } from '@bslt/db/utils';
import { QUOTAS } from '@bslt/shared/constants';
import { AUTH_EXPIRY } from '@bslt/shared/constants/core';
import { MS_PER_HOUR } from '@bslt/shared/constants/time';
import { isConsentConfirmed } from '@bslt/shared/core/compliance';
import { canReactivate, isAccountActive, isAttestationConfirmed } from '@bslt/shared/core/users';
import { canonicalizeEmail, normalizeEmail } from '@bslt/shared/helpers';
import { TooManyRequestsError } from '@bslt/shared/system';

import { EligibilityAttestationRequiredError } from '../attestation';
import {
  findSignupAgreementDocuments,
  insertConsentedUser,
  SignupConsentRequiredError,
} from '../consented-user';
import { AccountLockedError, EmailSendError, InvalidTokenError } from '../errors';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshTokenFamily,
  generateBase64UrlToken,
  generateUniqueUsername,
  hashToken,
  type AuthUser,
} from '../utils';

import type { AuthEmailService, AuthEmailTemplates } from '../types';
import type { DbClient } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';
import type { AuthConfig } from '@bslt/shared/system/config';

// ============================================================================
// Constants
// ============================================================================

/** Token length in bytes (32 bytes = 256 bits of entropy) */
const TOKEN_BYTES = 32;

/** Token expiry in minutes (default, can be overridden by config) */
const DEFAULT_TOKEN_EXPIRY_MINUTES = AUTH_EXPIRY.MAGIC_LINK_MINUTES;

/** Max requests per email per hour for rate limiting (default) */
const DEFAULT_MAX_REQUESTS_PER_EMAIL = QUOTAS.MAGIC_LINK_MAX_PER_EMAIL;

/** Max requests per IP per hour for rate limiting */
const DEFAULT_MAX_REQUESTS_PER_IP = QUOTAS.MAGIC_LINK_MAX_PER_IP;

/** Rate limit window in milliseconds (1 hour) */
const RATE_LIMIT_WINDOW_MS = MS_PER_HOUR;

// ============================================================================
// Types
// ============================================================================

/**
 * Magic link authentication result.
 */
export interface MagicLinkResult {
  /** JWT access token */
  accessToken: string;
  /** Opaque refresh token */
  refreshToken: string;
  /** Authenticated user data, including account-lifecycle fields (see AuthUser). */
  user: AuthUser;
}

/**
 * Magic link request result.
 */
export interface RequestMagicLinkResult {
  /** Whether the request was processed */
  success: boolean;
  /** Human-readable message */
  message: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if rate limit is exceeded for an email.
 *
 * @param repos - Repositories
 * @param email - Email to check
 * @param maxRequests - Max requests allowed in the window
 * @returns True if rate limited
 * @complexity O(1)
 */
async function isEmailRateLimited(
  repos: Repositories,
  email: string,
  maxRequests: number = DEFAULT_MAX_REQUESTS_PER_EMAIL,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const requestCount = await repos.authTokens.countRecentByEmail(email, windowStart);
  return requestCount >= maxRequests;
}

/**
 * Check if rate limit is exceeded for an IP address.
 * Prevents abuse from a single source targeting multiple emails.
 *
 * @param repos - Repositories
 * @param ipAddress - IP address to check
 * @param maxRequests - Max requests allowed in the window
 * @returns True if rate limited
 * @complexity O(1)
 */
async function isIpRateLimited(
  repos: Repositories,
  ipAddress: string,
  maxRequests: number = DEFAULT_MAX_REQUESTS_PER_IP,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const requestCount = await repos.authTokens.countRecentByIp(ipAddress, windowStart);
  return requestCount >= maxRequests;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Magic link request options.
 */
export interface MagicLinkRequestOptions {
  /** Token expiry in minutes (default: 15) */
  tokenExpiryMinutes?: number;
  /** Max requests per email per hour (default: 3) */
  maxAttemptsPerEmail?: number;
  /** Max requests per IP per hour (default: 10) */
  maxAttemptsPerIp?: number;
}

/**
 * Request a magic link for passwordless authentication.
 *
 * @param _db - Database client (kept for interface consistency)
 * @param repos - Repositories for database operations
 * @param emailService - Email service for sending magic links
 * @param emailTemplates - Email templates for rendering the magic link email
 * @param email - User's email address
 * @param baseUrl - Frontend base URL for the magic link
 * @param ipAddress - Client IP address (for security logging and rate limiting)
 * @param userAgent - Client user agent (for security logging)
 * @param options - Optional configuration overrides
 * @returns Result indicating success (always returns success to prevent email enumeration)
 * @throws {TooManyRequestsError} If rate limit is exceeded
 * @complexity O(1)
 */
export async function requestMagicLink(
  _db: DbClient,
  repos: Repositories,
  emailService: AuthEmailService,
  emailTemplates: AuthEmailTemplates,
  email: string,
  baseUrl: string,
  ipAddress?: string,
  userAgent?: string,
  options?: MagicLinkRequestOptions,
): Promise<RequestMagicLinkResult> {
  const {
    tokenExpiryMinutes = DEFAULT_TOKEN_EXPIRY_MINUTES,
    maxAttemptsPerEmail = DEFAULT_MAX_REQUESTS_PER_EMAIL,
    maxAttemptsPerIp = DEFAULT_MAX_REQUESTS_PER_IP,
  } = options ?? {};

  const normalizedEmail = normalizeEmail(email);
  const canonicalEmail = canonicalizeEmail(email);

  // Check email-based rate limit (using repository)
  const emailRateLimited = await isEmailRateLimited(repos, canonicalEmail, maxAttemptsPerEmail);
  if (emailRateLimited) {
    throw new TooManyRequestsError('Too many magic link requests. Please try again later.');
  }

  // Check IP-based rate limit (if IP is provided)
  if (ipAddress !== undefined && ipAddress !== '') {
    const ipRateLimited = await isIpRateLimited(repos, ipAddress, maxAttemptsPerIp);
    if (ipRateLimited) {
      throw new TooManyRequestsError(
        'Too many requests from this location. Please try again later.',
      );
    }
  }

  // Generate token
  const token = generateBase64UrlToken(TOKEN_BYTES);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + tokenExpiryMinutes * 60 * 1000);

  // Store hashed token (using repository)
  await repos.authTokens.create({
    type: 'magic_link',
    email: canonicalEmail,
    tokenHash,
    expiresAt,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  // Build magic link URL
  const magicLinkUrl = `${baseUrl}/auth/magic-link?token=${token}`;

  // Send email
  const emailTemplate = emailTemplates.magicLink(magicLinkUrl, tokenExpiryMinutes);

  try {
    // Build email options explicitly to avoid exactOptionalPropertyTypes issues
    // when spreading emailTemplate which may have optional html/text as undefined
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
    // Token was created but email failed
    throw new EmailSendError(
      'Failed to send magic link email',
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  // Always return success to prevent email enumeration
  return {
    success: true,
    message: 'If an account exists with this email, a magic link has been sent.',
  };
}

/**
 * Verify a magic link token and authenticate the user.
 *
 * Uses atomic update to prevent race conditions - the token is marked as used
 * in the same operation that validates it, ensuring only one request can succeed.
 *
 * @param db - Database client
 * @param repos - Repositories for username uniqueness checks
 * @param config - Auth configuration
 * @param token - The magic link token from the URL
 * @param eligibilityAttested - Confirmation of the signup eligibility statement;
 *   required only when the link would create a new account
 * @param tosAccepted - Consent to the published signup agreements; required only
 *   when the link would create a new account AND agreements are published
 * @returns Authentication result with tokens and user info
 * @throws {InvalidTokenError} If token is invalid, expired, or already used — or the
 *   account is deactivated/pending deletion (generic to prevent status enumeration)
 * @throws {AccountLockedError} If the account is admin-locked
 * @throws {EligibilityAttestationRequiredError} If the link would create an account
 *   and no attestation was supplied — the one-time link is NOT burned
 * @throws {SignupConsentRequiredError} If the link would create an account and no
 *   consent to the published agreements was supplied — the link is NOT burned
 * @complexity O(1) - constant database operations
 */
export async function verifyMagicLink(
  db: DbClient,
  repos: Repositories,
  config: AuthConfig,
  token: string,
  eligibilityAttested?: boolean,
  tosAccepted?: boolean,
): Promise<MagicLinkResult> {
  // Hash the token to look it up
  const tokenHash = hashToken(token);

  // Find or create user and generate tokens atomically
  const result = await withTransaction(db, async (tx) => {
    // Atomically mark token as used while validating it
    // This prevents race conditions - only the first request succeeds
    const now = new Date();
    type TokenRecord = Record<string, unknown> & {
      id: string;
      email: string;
      token_hash: string;
      expires_at: Date;
      used_at: Date | null;
    };

    // Peek at the token WITHOUT consuming it. If this link would CREATE an account
    // and either required confirmation is missing — the eligibility statement, or
    // consent to the published signup agreements — refuse, but leave the one-time
    // link live, so the person can confirm and complete sign-up with the same
    // link instead of being dead-ended. Anyone holding the link can already
    // redeem it, so not burning it here grants nothing.
    if (!isAttestationConfirmed(eligibilityAttested) || !isConsentConfirmed(tosAccepted)) {
      const pending = await tx.queryOne<TokenRecord>(
        select(AUTH_TOKENS_TABLE)
          .where(
            and(
              eq('token_hash', tokenHash),
              eq('type', 'magic_link'),
              gt('expires_at', now),
              isNull('used_at'),
            ),
          )
          .limit(1)
          .toSql(),
      );

      if (pending != null) {
        const existing = await tx.queryOne(
          select(USERS_TABLE)
            .where(eq('canonical_email', canonicalizeEmail(pending.email)))
            .limit(1)
            .toSql(),
        );
        if (existing == null) {
          if (!isAttestationConfirmed(eligibilityAttested)) {
            return { ok: false as const, needsAttestation: true as const };
          }
          // Consent is required only while signup agreements are published —
          // fail-open parity with insertConsentedUser (see ../consented-user).
          if ((await findSignupAgreementDocuments(repos)).length > 0) {
            return { ok: false as const, needsConsent: true as const };
          }
        }
      }
    }

    const tokenRecords = await tx.query<TokenRecord>(
      update(AUTH_TOKENS_TABLE)
        .set({ used_at: now })
        .where(
          and(
            eq('token_hash', tokenHash),
            eq('type', 'magic_link'),
            gt('expires_at', now),
            isNull('used_at'),
          ),
        )
        .returningAll()
        .toSql(),
    );
    const tokenRecord = tokenRecords[0];

    // If no rows were updated, token is invalid, expired, or already used
    if (tokenRecord == null) {
      return { ok: false as const };
    }

    // Find existing user
    const tokenCanonicalEmail = canonicalizeEmail(tokenRecord.email);
    const userRow = await tx.queryOne(
      select(USERS_TABLE).where(eq('canonical_email', tokenCanonicalEmail)).limit(1).toSql(),
    );
    let user: User | null = userRow != null ? toCamelCase<User>(userRow, USER_COLUMNS) : null;

    // Account-status gate (parity with password login): admin-locked accounts
    // are blocked outright. Deactivated / within-grace pending-deletion accounts
    // are allowed through so the owner can self-service reactivate; only accounts
    // past an expired deletion grace period stay blocked. Returned (not thrown)
    // so the token consumption above still commits — throwing inside the
    // transaction would roll back used_at, leaving the one-time link replayable.
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

    // If user doesn't exist, create them — refuses unless the eligibility statement
    // was confirmed and the published agreements consented to. The peek above
    // already returned for those cases; this is the structural backstop that makes
    // it impossible to reach the INSERT without them (a throw here rolls the
    // consume back, so the link still survives).
    if (user == null) {
      // Generate a unique username from the email prefix
      const username = await generateUniqueUsername(repos, tokenRecord.email);

      user = await insertConsentedUser(
        tx,
        repos,
        {
          email: normalizeEmail(tokenRecord.email),
          canonical_email: canonicalizeEmail(tokenRecord.email),
          username,
          first_name: 'User',
          last_name: '',
          // Magic link users don't have a password - generate a random unusable hash
          password_hash: `magiclink:${randomBytes(32).toString('hex')}`,
          role: 'user',
          email_verified: true, // Email is verified by using magic link
          email_verified_at: new Date(),
        },
        { agreed: tosAccepted, attested: eligibilityAttested },
      );
    } else if (!user.emailVerified) {
      // If user exists but email not verified, verify it now
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

    // Create refresh token
    const { token: refreshToken } = await createRefreshTokenFamily(
      tx,
      user.id,
      config.refreshToken.expiryDays,
    );

    return { ok: true as const, user, refreshToken };
  });

  // Throw outside the transaction so the token consumption above is preserved —
  // throwing inside would roll back used_at and leave the one-time link replayable.
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
    // The link was valid but would have created an account. It has NOT been
    // consumed: the client prompts for the confirmation and re-submits this token.
    if ('needsAttestation' in result) {
      throw new EligibilityAttestationRequiredError();
    }
    if ('needsConsent' in result) {
      throw new SignupConsentRequiredError();
    }
    throw new InvalidTokenError('Invalid or expired magic link');
  }

  // Create access token
  const accessToken = createAccessToken(
    result.user.id,
    result.user.email,
    result.user.role,
    config.jwt.secret,
    config.jwt.accessTokenExpiry,
    result.user.tokenVersion,
  );

  return createAuthResponse(accessToken, result.refreshToken, result.user);
}

/**
 * Clean up expired magic link tokens.
 * Should be called periodically by a scheduled job.
 *
 * @param _db - Database client (kept for interface consistency)
 * @param repos - Repositories for database operations
 * @returns Number of tokens deleted
 * @complexity O(n) where n is the number of expired tokens
 */
export async function cleanupExpiredMagicLinkTokens(
  _db: DbClient,
  repos: Repositories,
): Promise<number> {
  return repos.authTokens.deleteExpired();
}
