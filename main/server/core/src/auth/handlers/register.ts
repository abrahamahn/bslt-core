// main/server/core/src/auth/handlers/register.ts
/**
 * Register Handler
 *
 * Handles new user registration.
 *
 * @module handlers/register
 */

import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { isStrategyEnabled, type RegisterRequest } from '@bslt/shared/core/auth';
import { isConsentConfirmed } from '@bslt/shared/core/compliance';
import { isAttestationConfirmed } from '@bslt/shared/core/users';
import { BadRequestError, NotFoundError } from '@bslt/shared/system';

import { EligibilityAttestationRequiredError } from '../attestation';
import { SignupConsentRequiredError } from '../consented-user';
import { isCaptchaRequired, verifyCaptchaToken } from '../security';
import { registerUser, type RegisterResult } from '../service';
import { createErrorMapperLogger } from '../types';

import type { AppContext, ReplyWithCookies, RequestWithCookies } from '../types';

/**
 * Handle new user registration.
 * Creates user with unverified email and sends verification email.
 *
 * @param ctx - Application context
 * @param body - Registration request body (email, username, firstName, lastName, password)
 * @param _reply - Reply with cookie support (unused - no cookies set before verification)
 * @returns Registration result or error
 * @complexity O(1)
 */
export async function handleRegister(
  ctx: AppContext,
  body: RegisterRequest,
  request: RequestWithCookies,
  _reply: ReplyWithCookies,
): Promise<(RegisterResult & { emailSendFailed?: boolean }) | HttpErrorResponse> {
  if (Array.isArray(ctx.config.auth.strategies) && !isStrategyEnabled(ctx.config.auth, 'local')) {
    throw new NotFoundError('Local authentication is not enabled', 'LOCAL_AUTH_DISABLED');
  }

  try {
    // Fail before hashing a password or touching the database. `registerUser`
    // enforces both again at the insert itself (insertConsentedUser) — this is
    // the fast path, not the guarantee. Register has an explicit consent
    // checkbox, so the strict check applies even before any document is
    // published (unlike the passwordless paths, which fail open there).
    if (!isConsentConfirmed(body.tosAccepted)) {
      throw new SignupConsentRequiredError();
    }
    if (!isAttestationConfirmed(body.eligibilityAttested)) {
      throw new EligibilityAttestationRequiredError();
    }

    // Verify CAPTCHA token if enabled
    if (isCaptchaRequired(ctx.config.auth)) {
      const { ipAddress } = request.requestInfo;
      const captchaToken = body.captchaToken ?? '';
      const captchaResult = await verifyCaptchaToken(ctx.config.auth, captchaToken, ipAddress);
      if (!captchaResult.success) {
        throw new BadRequestError('CAPTCHA verification failed', 'CAPTCHA_VERIFICATION_FAILED');
      }
    }

    const { email, username, firstName, lastName, password } = body;
    const baseUrl = ctx.config.server.appBaseUrl;
    const registerRequestContext = {
      tosAccepted: body.tosAccepted,
      eligibilityAttested: body.eligibilityAttested,
      logger: ctx.log,
      ...(request.requestInfo.ipAddress !== undefined
        ? { ipAddress: request.requestInfo.ipAddress }
        : {}),
      ...(request.requestInfo.userAgent !== undefined
        ? { userAgent: request.requestInfo.userAgent }
        : {}),
    };
    const result = await registerUser(
      ctx.db,
      ctx.repos,
      ctx.email,
      ctx.emailTemplates,
      ctx.config.auth,
      email,
      password,
      username,
      firstName,
      lastName,
      baseUrl,
      registerRequestContext,
    );

    // No cookies set - user must verify email first
    return result;
  } catch (error) {
    // Handle EmailSendError specially for registration: user was created, but email failed
    // Return success with a flag so the user knows to use the resend endpoint
    // Use error.name check instead of instanceof for ESM compatibility
    if (error instanceof Error && error.name === 'EmailSendError') {
      const emailError = error as Error & { originalError?: Error };
      ctx.log.error(
        { email: body.email, originalError: emailError.originalError?.message },
        'Failed to send verification email after user creation',
      );
      return {
        status: 'pending_verification',
        message:
          'Account created successfully, but we had trouble sending the verification email. Please use the resend verification option.',
        email: body.email,
        emailSendFailed: true,
      };
    }

    // Use error mapper for all errors (including EmailAlreadyExistsError, WeakPasswordError, etc.)
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
