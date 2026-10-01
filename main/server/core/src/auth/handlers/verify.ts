// main/server/core/src/auth/handlers/verify.ts
/**
 * Email Verification Handlers
 *
 * Handles email verification and resend verification flows.
 *
 * @module handlers/verify
 */

import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { HTTP_STATUS, AUTH_SUCCESS_MESSAGES as SUCCESS_MESSAGES } from '@bslt/shared/constants';
import { isStrategyEnabled, type AuthResponse } from '@bslt/shared/core/auth';
import { NotFoundError } from '@bslt/shared/system';

import { createErrorMapperLogger } from '../types';
import { setRefreshTokenCookie } from '../utils';
import { resendVerificationEmail, verifyEmail } from '../verification/service';

import type { AppContext, ReplyWithCookies } from '../types';

/**
 * Handle email verification.
 * Verifies the token and returns auth credentials for auto-login.
 *
 * @param ctx - Application context
 * @param body - Request body with verification token
 * @param reply - Reply with cookie support
 * @returns Auth response with verified flag or error
 * @complexity O(1)
 */
export async function handleVerifyEmail(
  ctx: AppContext,
  body: { token: string },
  reply: ReplyWithCookies,
): Promise<{ status: 200; body: AuthResponse & { verified: boolean } } | HttpErrorResponse> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  try {
    const { token } = body;
    const result = await verifyEmail(ctx.db, ctx.repos, ctx.config.auth, token);

    // Set refresh token as HTTP-only cookie for auto-login
    setRefreshTokenCookie(reply, result.refreshToken, ctx.config.auth);

    return {
      status: HTTP_STATUS.OK,
      body: {
        verified: true,
        token: result.accessToken,
        user: result.user,
      },
    };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle resend verification email.
 * Creates a new verification token and sends the email.
 *
 * @param ctx - Application context
 * @param body - Request body with email
 * @returns Success response or error
 * @complexity O(1)
 */
export async function handleResendVerification(
  ctx: AppContext,
  body: { email: string },
): Promise<{ status: 200; body: { message: string } } | HttpErrorResponse> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  try {
    const { email } = body;
    const baseUrl = ctx.config.server.appBaseUrl;
    await resendVerificationEmail(ctx.db, ctx.repos, ctx.email, ctx.emailTemplates, email, baseUrl);

    return {
      status: HTTP_STATUS.OK,
      body: { message: SUCCESS_MESSAGES.VERIFICATION_EMAIL_SENT },
    };
  } catch (error) {
    // Use error mapper with default EmailSendError handling (returns 503)
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
