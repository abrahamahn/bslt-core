// main/server/core/src/auth/otp/handlers.ts
/**
 * Email OTP Handlers
 *
 * HTTP handlers for passwordless login via a one-time email code.
 * Thin layer that calls services and formats responses.
 *
 * @module otp/handlers
 */

import { createHttpErrorResponse, mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { getMetricsCollector } from '@bslt/server-system/observability';
import { AUTH_SUCCESS_MESSAGES as SUCCESS_MESSAGES } from '@bslt/shared/constants';
import {
  type CompleteOnboardingRequest,
  type EmailOtpRequest,
  type EmailOtpVerifyRequest,
  isStrategyEnabled,
} from '@bslt/shared/core/auth';

import { EmailSendError } from '../errors';
import {
  logEmailOtpFailedEvent,
  logEmailOtpRequestEvent,
  logEmailOtpVerifiedEvent,
} from '../security';
import { createErrorMapperLogger } from '../types';
import { setRefreshTokenCookie, toAuthUser } from '../utils';

import { completeOnboarding, requestEmailOtp, verifyEmailOtp } from './service';

import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';

/**
 * Handle an email OTP request.
 * Always returns success to prevent email enumeration; rate limiting is in the service.
 *
 * @complexity O(1)
 */
export async function handleEmailOtpRequest(
  ctx: AppContext,
  body: EmailOtpRequest,
  request: RequestWithCookies,
): Promise<object> {
  // Email OTP is a passwordless email flow, so it rides the `magic` strategy
  // rather than carrying its own switch. The web UI surfaces it under
  // VITE_ENABLE_ADVANCED_AUTH — keep `magic` in AUTH_STRATEGIES whenever that is on.
  if (!isStrategyEnabled(ctx.config.auth, 'magic')) {
    return createHttpErrorResponse(404, 'Email code authentication is not enabled');
  }

  const { ipAddress, userAgent } = request.requestInfo;

  try {
    const { email } = body;
    const result = await requestEmailOtp(
      ctx.db,
      ctx.repos,
      ctx.email,
      ctx.emailTemplates,
      email,
      ipAddress,
      userAgent,
    );

    // Await so the audit row is durable before responding; this also prevents the
    // fire-and-forget INSERT from racing later writes (e.g. test-harness TRUNCATE).
    // Swallow audit errors so they never change the response.
    try {
      await logEmailOtpRequestEvent(ctx.db, email.toLowerCase(), ipAddress, userAgent);
    } catch (err) {
      ctx.log.error({ err }, 'Failed to record email_otp_requested event');
    }

    return { status: 200, body: { message: result.message } };
  } catch (error) {
    // Email send failed — log but return success to prevent enumeration
    if (error instanceof EmailSendError) {
      ctx.log.error(
        { email: body.email, originalError: error.originalError?.message },
        'Failed to send email OTP',
      );
      return { message: SUCCESS_MESSAGES.EMAIL_OTP_SENT };
    }

    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle email OTP verification.
 * Verifies the code and returns auth credentials on success.
 *
 * @complexity O(1)
 */
export async function handleEmailOtpVerify(
  ctx: AppContext,
  body: EmailOtpVerifyRequest,
  request: RequestWithCookies,
  reply: ReplyWithCookies,
): Promise<object> {
  if (!isStrategyEnabled(ctx.config.auth, 'magic')) {
    return createHttpErrorResponse(404, 'Email code authentication is not enabled');
  }

  const { ipAddress, userAgent } = request.requestInfo;
  const metrics = getMetricsCollector();
  const provider = 'email_otp';

  try {
    const { email, code, eligibilityAttested, tosAccepted } = body;
    metrics.recordLoginAttempt(provider);

    const result = await verifyEmailOtp(
      ctx.db,
      ctx.repos,
      ctx.config.auth,
      email,
      code,
      eligibilityAttested,
      tosAccepted,
    );

    metrics.recordLoginSuccess(provider);
    setRefreshTokenCookie(reply, result.refreshToken, ctx.config.auth);

    try {
      await logEmailOtpVerifiedEvent(
        ctx.db,
        result.user.id,
        result.user.email,
        result.isNewUser,
        ipAddress,
        userAgent,
      );
    } catch (err) {
      ctx.log.error({ err }, 'Failed to record email_otp_verified event');
    }

    return {
      status: 200,
      body: { token: result.accessToken, user: result.user, isNewUser: result.isNewUser },
    };
  } catch (error) {
    metrics.recordLoginFailure(provider);

    if (
      error !== null &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'InvalidTokenError'
    ) {
      // Await so the audit INSERT completes before the response returns, instead
      // of racing the next request/cleanup (the fire-and-forget version deadlocked
      // against a concurrent TRUNCATE). Swallow audit errors so they never mask
      // the original 401.
      try {
        await logEmailOtpFailedEvent(
          ctx.db,
          body.email.toLowerCase(),
          'Invalid or expired security code',
          ipAddress,
          userAgent,
        );
      } catch (err) {
        ctx.log.error({ err }, 'Failed to record email_otp_failed event');
      }
    }

    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Complete profile for a brand-new passwordless user: set name, username, and a
 * first password. Authenticated — verify creates and signs in the user, then the
 * client posts here to finish onboarding.
 *
 * @complexity O(1)
 */
export async function handleCompleteOnboarding(
  ctx: AppContext,
  body: CompleteOnboardingRequest,
  request: RequestWithCookies,
): Promise<object> {
  const userId = request.user?.userId;
  if (userId === undefined || userId === '') {
    return createHttpErrorResponse(401, 'Authentication required');
  }

  try {
    const user = await completeOnboarding(ctx.db, ctx.repos, ctx.config.auth, userId, body);
    return { status: 200, body: { user: toAuthUser(user) } };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
