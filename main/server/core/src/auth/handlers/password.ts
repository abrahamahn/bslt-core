// main/server/core/src/auth/handlers/password.ts
/**
 * Password Handlers
 *
 * Handles forgot password, reset password, and set password flows.
 *
 * @module handlers/password
 */

import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { ERROR_MESSAGES, AUTH_SUCCESS_MESSAGES as SUCCESS_MESSAGES } from '@bslt/shared/constants';
import { isStrategyEnabled, type ForgotPasswordRequest } from '@bslt/shared/core/auth';
import {
  AuthenticationError,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '@bslt/shared/system';

import { assertUserActive } from '../middleware';
import { requestPasswordReset, resetPassword, setPassword } from '../password/service';
import { isCaptchaRequired, sendPasswordChangedAlert, verifyCaptchaToken } from '../security';
import { createErrorMapperLogger } from '../types';

import type { AppContext, RequestWithCookies } from '../types';

/**
 * Handle forgot password request.
 * Always returns success to prevent user enumeration.
 *
 * @param ctx - Application context
 * @param body - Request body with email
 * @returns Success response (always, for enumeration prevention)
 * @complexity O(1)
 */
export async function handleForgotPassword(
  ctx: AppContext,
  body: ForgotPasswordRequest,
  request: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  try {
    // Verify CAPTCHA token if enabled
    if (isCaptchaRequired(ctx.config.auth)) {
      const { ipAddress } = request.requestInfo;
      const captchaToken = body.captchaToken ?? '';
      const captchaResult = await verifyCaptchaToken(ctx.config.auth, captchaToken, ipAddress);
      if (!captchaResult.success) {
        throw new BadRequestError('CAPTCHA verification failed', 'CAPTCHA_VERIFICATION_FAILED');
      }
    }

    const { email } = body;
    const baseUrl = ctx.config.server.appBaseUrl;
    await requestPasswordReset(ctx.db, ctx.repos, ctx.email, ctx.emailTemplates, email, baseUrl);

    return { message: SUCCESS_MESSAGES.PASSWORD_RESET_SENT };
  } catch (error) {
    // Email send failed - log but return success to prevent user enumeration
    // The user can retry the forgot password request
    // Use error.name check instead of instanceof for ESM compatibility
    if (error instanceof Error && error.name === 'EmailSendError') {
      const emailError = error as Error & { originalError?: Error };
      ctx.log.error(
        { email: body.email, originalError: emailError.originalError?.message },
        'Failed to send password reset email',
      );
      // Return success anyway to prevent enumeration (user can retry)
      return { message: SUCCESS_MESSAGES.PASSWORD_RESET_SENT };
    }

    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle password reset with token.
 *
 * @param ctx - Application context
 * @param body - Request body with token and new password
 * @param req - Request with cookies and request info
 * @returns Success response or error
 * @complexity O(1)
 */
export async function handleResetPassword(
  ctx: AppContext,
  body: { token: string; password: string },
  req: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  try {
    const { token, password } = body;
    const email = await resetPassword(ctx.db, ctx.repos, ctx.config.auth, token, password);
    const ipAddress = req.requestInfo.ipAddress ?? req.requestInfo.ip;
    const { userAgent } = req.requestInfo;

    // Fire-and-forget: send "Was this you?" password changed alert
    sendPasswordChangedAlert(ctx.email, ctx.emailTemplates, {
      email,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    }).catch((err: unknown) => {
      ctx.log.warn({ err, email }, 'Failed to send password changed alert email');
    });

    return { message: 'Password reset successfully' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle set password for magic-link-only users.
 *
 * @param ctx - Application context
 * @param body - Request body with new password
 * @param req - Request with auth info
 * @returns Success response or error
 * @complexity O(1)
 */
export async function handleSetPassword(
  ctx: AppContext,
  body: { password: string },
  req: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  try {
    // User ID comes from the authenticated request
    const userId = req.user?.userId;
    if (userId === undefined || userId === '') {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    // Verify user account is not suspended
    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    const { password } = body;
    await setPassword(ctx.db, ctx.repos, ctx.config.auth, userId, password);

    return { message: 'Password set successfully' };
  } catch (error) {
    // Handle specific error for user already having a password
    if (error instanceof Error && error.name === 'PasswordAlreadySetError') {
      throw new ConflictError(error.message, 'PASSWORD_ALREADY_SET');
    }
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
