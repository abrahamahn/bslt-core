// main/server/core/src/auth/handlers/invalidate-sessions.ts
/**
 * Invalidate All Sessions Handler
 *
 * Increments the user's token_version (invalidating all JWTs) and revokes
 * all refresh token families, forcing re-authentication on every device.
 *
 * @module handlers/invalidate-sessions
 */

import { createHttpErrorResponse, mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';

import { invalidateLiveness } from '../liveness-cache';
import { createErrorMapperLogger } from '../types';
import { clearRefreshTokenCookie, revokeAllUserTokens } from '../utils';

import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';

/**
 * Handle session invalidation for the current user.
 * Increments token_version and revokes all refresh token families.
 *
 * @param ctx - Application context
 * @param request - Request with auth info
 * @param reply - Reply with cookie support
 * @returns Success response or error
 */
export async function handleInvalidateSessions(
  ctx: AppContext,
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;

    if (userId === undefined || userId === '') {
      return createHttpErrorResponse(401, 'Unauthorized');
    }

    // Increment token version — all existing JWTs become stale on next refresh
    await ctx.repos.users.incrementTokenVersion(userId);
    invalidateLiveness(userId);

    // Revoke all refresh token families — forces immediate re-auth
    await revokeAllUserTokens(ctx.db, userId);

    clearRefreshTokenCookie(reply);

    return { message: 'All sessions invalidated' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
