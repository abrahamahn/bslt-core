// main/server/core/src/auth/handlers/logout-all.ts
/**
 * Logout All Devices Handler
 *
 * Revokes all refresh tokens for a user, logging them out of all devices.
 *
 * @module handlers/logout-all
 */

import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { AuthenticationError } from '@bslt/shared/system';

import { invalidateLiveness } from '../liveness-cache';
import { createErrorMapperLogger } from '../types';
import { clearRefreshTokenCookie, revokeAllUserTokens } from '../utils';

import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';

/**
 * Handle logout from all devices.
 * Bumps token_version (killing every outstanding access token via the
 * middleware live check — without this, 15-minute JWTs survived "sign out
 * everywhere"), revokes all refresh-token families, and clears the current
 * cookie.
 *
 * @param ctx - Application context
 * @param request - Request with cookies and auth info
 * @param reply - Reply with cookie support
 * @returns Success response or error
 * @complexity O(1)
 */
export async function handleLogoutAll(
  ctx: AppContext,
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;

    if (userId === undefined || userId === '') {
      throw new AuthenticationError('Unauthorized');
    }

    await ctx.repos.users.incrementTokenVersion(userId);
    invalidateLiveness(userId);
    await revokeAllUserTokens(ctx.db, userId);
    clearRefreshTokenCookie(reply);

    return { message: 'Logged out from all devices' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
