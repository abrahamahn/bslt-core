// main/server/core/src/auth/handlers/refresh.ts
/**
 * Refresh Handler
 *
 * Handles token refresh using HTTP-only refresh token cookie.
 *
 * @module handlers/refresh
 */

import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { AUTH_ERROR_MESSAGES as ERROR_MESSAGES } from '@bslt/shared/constants';
import {
  sessionIdleWindowMs,
  sessionSpanDaysOf,
  type RefreshResponse,
} from '@bslt/shared/core/auth';
import { AuthenticationError } from '@bslt/shared/system';

import { sendTokenReuseAlert } from '../security';
import { refreshUserTokens } from '../service';
import { createErrorMapperLogger, REFRESH_COOKIE_NAME } from '../types';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../utils';

import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';

/**
 * Handle token refresh.
 * Rotates the refresh token and issues a new access token.
 *
 * @param ctx - Application context
 * @param request - Request with cookies
 * @param reply - Reply with cookie support
 * @returns New tokens or error response
 * @complexity O(1)
 */
export async function handleRefresh(
  ctx: AppContext,
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<RefreshResponse | HttpErrorResponse> {
  const oldRefreshToken = request.cookies[REFRESH_COOKIE_NAME];

  ctx.log.debug(
    { hasRefreshToken: oldRefreshToken !== undefined && oldRefreshToken !== '' },
    'Refresh attempt',
  );

  if (oldRefreshToken === undefined || oldRefreshToken === '') {
    throw new AuthenticationError(ERROR_MESSAGES.NO_REFRESH_TOKEN, 'NO_REFRESH_TOKEN');
  }

  const ipAddress = request.requestInfo.ipAddress ?? request.requestInfo.ip;
  const { userAgent } = request.requestInfo;

  try {
    // Idle timeout check: reject if the old token was created too long ago
    // (token creation time approximates last activity since tokens rotate on
    // each refresh). Rotated rows are exempt — they must reach the rotation
    // logic so token reuse is detected and the family revoked.
    const tokenRecord = await ctx.repos.refreshTokens.findByToken(oldRefreshToken);
    // Recovered here so the rotated cookie keeps the span the user chose at
    // login; without it a remembered session silently shrinks to the default
    // on its first refresh.
    const spanDays =
      tokenRecord == null
        ? undefined
        : sessionSpanDaysOf(tokenRecord.createdAt, tokenRecord.expiresAt);

    if (tokenRecord != null && tokenRecord.rotatedAt == null) {
      // The idle window is DERIVED from this session's own span, recovered from
      // the row's dates. A fixed timeout paired with a longer cookie is how a
      // browser ends up holding a credential the server has already decided to
      // reject — the user is signed out while holding a valid-looking session.
      const idleMs = Date.now() - tokenRecord.createdAt.getTime();
      if (idleMs > sessionIdleWindowMs(spanDays ?? ctx.config.auth.refreshToken.expiryDays)) {
        clearRefreshTokenCookie(reply);
        throw new AuthenticationError(ERROR_MESSAGES.INVALID_TOKEN, 'INVALID_TOKEN');
      }
    }

    const result = await refreshUserTokens(
      ctx.db,
      ctx.repos,
      ctx.config.auth,
      oldRefreshToken,
      ipAddress,
      userAgent,
      spanDays,
    );

    // Set new refresh token cookie, preserving this session's original span.
    setRefreshTokenCookie(reply, result.refreshToken, ctx.config.auth, spanDays);

    return { token: result.accessToken };
  } catch (error) {
    // Use error.name checks instead of instanceof for ESM compatibility
    if (error instanceof Error) {
      // Clear cookie on invalid token before returning error
      if (error.name === 'InvalidTokenError') {
        clearRefreshTokenCookie(reply);
        throw new AuthenticationError(ERROR_MESSAGES.INVALID_TOKEN, 'INVALID_TOKEN');
      }

      // Handle token reuse detection - send security alert email
      if (error.name === 'TokenReuseError') {
        clearRefreshTokenCookie(reply);

        // Extract token reuse properties
        const tokenReuseError = error as Error & {
          email?: string;
          userId?: string;
          ipAddress?: string;
          userAgent?: string;
        };

        // Send email alert (fire and forget - don't block the response)
        if (tokenReuseError.email != null && tokenReuseError.email !== '') {
          sendTokenReuseAlert(ctx.email, ctx.emailTemplates, {
            email: tokenReuseError.email,
            ipAddress: tokenReuseError.ipAddress ?? ipAddress,
            userAgent: tokenReuseError.userAgent ?? userAgent,
            timestamp: new Date(),
          }).catch((emailError: unknown) => {
            const err = emailError instanceof Error ? emailError : new Error(String(emailError));
            const logData: { error: Error; userId?: string; email?: string } = { error: err };
            if (tokenReuseError.userId !== undefined) {
              logData.userId = tokenReuseError.userId;
            }
            if (tokenReuseError.email !== undefined) {
              logData.email = tokenReuseError.email;
            }
            ctx.log.error(logData, 'Failed to send token reuse alert email');
          });
        }

        throw new AuthenticationError(ERROR_MESSAGES.INVALID_TOKEN, 'INVALID_TOKEN');
      }
    }

    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
