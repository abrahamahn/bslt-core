// main/server/core/src/auth/handlers/totp.ts
/**
 * TOTP (2FA) Handlers
 *
 * HTTP layer for TOTP setup, enable, disable, and status.
 *
 * @module handlers/totp
 */

import { withTransaction } from '@bslt/db/utils';
import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { JwtError, verify as jwtVerify } from '@bslt/server-system/security';
import { ERROR_MESSAGES } from '@bslt/shared/constants';
import {
  type AuthResponse,
  type BackupCodesRegenerateResponse,
  type BackupCodesStatusResponse,
  type TotpLoginVerifyRequest,
  type TotpSetupResponse,
  type TotpStatusResponse,
  type TotpVerifyRequest,
  type TotpVerifyResponse,
} from '@bslt/shared/core/auth';
import { AuthenticationError, BadRequestError, TooManyRequestsError } from '@bslt/shared/system';

import { InvalidTokenError } from '../errors';
import { assertUserActive } from '../middleware';
import { authRateLimiters } from '../security/rateLimitPresets';
import { burnChallenge, isChallengeBurned } from '../security/totp-challenge-guard';
import {
  disableTotp,
  enableTotp,
  getBackupCodesStatus,
  getTotpStatus,
  regenerateBackupCodes,
  setupTotp,
  verifyTotpForLogin,
} from '../totp';
import {
  createErrorMapperLogger,
  type AppContext,
  type ReplyWithCookies,
  type RequestWithCookies,
} from '../types';
import {
  createAccessToken,
  createAuthResponse,
  createRefreshTokenFamily,
  setRefreshTokenCookie,
} from '../utils';

/**
 * Handle TOTP setup — generate a secret and QR-code URI.
 */
export async function handleTotpSetup(
  ctx: AppContext,
  _body: unknown,
  request: RequestWithCookies,
): Promise<TotpSetupResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const email = request.user?.email ?? '';
    const result = await setupTotp(ctx.db, userId, email, ctx.config.auth);

    return result;
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle TOTP enable — verify code and activate 2FA.
 */
export async function handleTotpEnable(
  ctx: AppContext,
  body: TotpVerifyRequest,
  request: RequestWithCookies,
): Promise<TotpVerifyResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const result = await enableTotp(ctx.db, userId, body.code, ctx.config.auth);

    if (!result.success) {
      throw new BadRequestError(result.message, 'TOTP_ENABLE_FAILED');
    }

    return result;
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle TOTP disable — verify code and deactivate 2FA.
 */
export async function handleTotpDisable(
  ctx: AppContext,
  body: TotpVerifyRequest,
  request: RequestWithCookies,
): Promise<TotpVerifyResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const result = await disableTotp(ctx.db, userId, body.code, ctx.config.auth);

    if (!result.success) {
      throw new BadRequestError(result.message, 'TOTP_DISABLE_FAILED');
    }

    return result;
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle TOTP status check.
 */
export async function handleTotpStatus(
  ctx: AppContext,
  _body: unknown,
  request: RequestWithCookies,
): Promise<TotpStatusResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    const result = await getTotpStatus(ctx.db, userId);
    return result;
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle TOTP backup code status check.
 */
export async function handleBackupCodesStatus(
  ctx: AppContext,
  _body: unknown,
  request: RequestWithCookies,
): Promise<BackupCodesStatusResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    return await getBackupCodesStatus(ctx.db, userId);
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle TOTP backup code regeneration.
 */
export async function handleBackupCodesRegenerate(
  ctx: AppContext,
  body: TotpVerifyRequest,
  request: RequestWithCookies,
): Promise<BackupCodesRegenerateResponse | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const result = await regenerateBackupCodes(ctx.db, userId, body.code, ctx.config.auth);
    if (!result.success || result.backupCodes === undefined) {
      throw new BadRequestError(result.message, 'BACKUP_CODES_REGENERATE_FAILED');
    }

    return { backupCodes: result.backupCodes };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle TOTP login verification — verify challenge token + TOTP code, return auth tokens.
 *
 * This is called after login returns a 202 TOTP challenge. The client sends back
 * the challenge JWT and the 6-digit TOTP code. On success, full auth tokens are issued.
 *
 * @param ctx - Application context
 * @param body - Challenge token and TOTP code
 * @param _request - Request with cookies (unused)
 * @param reply - Reply with cookie support
 * @returns Auth response with tokens or error
 * @complexity O(1)
 */
export async function handleTotpLoginVerify(
  ctx: AppContext,
  body: TotpLoginVerifyRequest,
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<AuthResponse | HttpErrorResponse> {
  try {
    const { ipAddress, userAgent } = request.requestInfo;

    // Verify the challenge JWT
    let payload: Record<string, unknown>;
    try {
      payload = jwtVerify(body.challengeToken, ctx.config.auth.jwt.secret) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if (error instanceof JwtError) {
        throw new InvalidTokenError('Challenge token is invalid or expired');
      }
      throw error;
    }

    // Validate challenge token purpose and extract userId
    if (payload['purpose'] !== 'totp_challenge' || typeof payload['userId'] !== 'string') {
      throw new InvalidTokenError('Invalid challenge token');
    }

    const userId = payload['userId'];
    const jti = typeof payload['jti'] === 'string' ? payload['jti'] : null;

    // A challenge that already spent its guess budget is dead: send the caller
    // back to the password step rather than let them keep trying the same token
    // once the rate-limit window rolls over.
    if (jti !== null && isChallengeBurned(jti)) {
      throw new InvalidTokenError('Challenge token is invalid or expired');
    }

    // Cap guesses at 5/min PER ACCOUNT, not per token. The threat is an attacker
    // who already has the password — the case 2FA exists for — who can mint a
    // fresh challenge for every five guesses; account lockout does not catch that
    // (each password step succeeds), so the limit follows the user. On the first
    // breach the challenge is burned so it cannot be reused after the minute.
    const rateLimit = await authRateLimiters.check('totpVerify', userId);
    if (!rateLimit.allowed) {
      if (jti !== null) {
        const exp = payload['exp'];
        const ttlMs = typeof exp === 'number' ? Math.max(0, exp * 1000 - Date.now()) : 5 * 60_000;
        burnChallenge(jti, ttlMs);
      }
      throw new TooManyRequestsError('Too many code attempts. Please sign in again.', undefined, {
        retryAfterMs: rateLimit.resetMs,
      });
    }

    // Verify TOTP code
    const isValid = await verifyTotpForLogin(ctx.db, userId, body.code, ctx.config.auth);
    if (!isValid) {
      throw new AuthenticationError('Invalid TOTP code', 'TOTP_INVALID_CODE');
    }

    // Fetch user for token creation
    const user = await ctx.repos.users.findById(userId);
    if (user === null) {
      throw new InvalidTokenError('User not found');
    }

    // Create tokens
    const { token: refreshToken } = await withTransaction(ctx.db, async (tx) => {
      const sessionMeta: { ipAddress?: string; userAgent?: string } = {};
      if (ipAddress !== undefined) {
        sessionMeta.ipAddress = ipAddress;
      }
      if (userAgent !== undefined) {
        sessionMeta.userAgent = userAgent;
      }
      return createRefreshTokenFamily(
        tx,
        user.id,
        ctx.config.auth.refreshToken.expiryDays,
        sessionMeta,
      );
    });

    const accessToken = createAccessToken(
      user.id,
      user.email,
      user.role,
      ctx.config.auth.jwt.secret,
      ctx.config.auth.jwt.accessTokenExpiry,
      user.tokenVersion,
    );

    // Set refresh token cookie
    setRefreshTokenCookie(reply, refreshToken, ctx.config.auth);

    const authResponse = createAuthResponse(accessToken, refreshToken, user);

    return {
      token: authResponse.accessToken,
      user: authResponse.user,
    };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
