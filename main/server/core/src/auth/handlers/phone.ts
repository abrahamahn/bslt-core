// main/server/core/src/auth/handlers/phone.ts
/**
 * Phone Management Handlers
 *
 * HTTP layer for setting, verifying, and removing phone numbers.
 *
 * @module handlers/phone
 */

import { SMS_VERIFICATION_CODES_TABLE, USERS_TABLE } from '@bslt/db/schema';
import { mapErrorToHttpResponse } from '@bslt/server-system/errors';
import { type HttpErrorResponse } from '@bslt/server-system/errors';
import { ERROR_MESSAGES } from '@bslt/shared/constants';
import {
  AuthenticationError,
  BadRequestError,
  ExternalDependencyError,
  TooManyRequestsError,
  UnavailableError,
} from '@bslt/shared/system';

import { assertUserActive } from '../middleware';
import { checkSmsRateLimit } from '../sms-2fa/rate-limit';
import { sendSms2faCode, verifySms2faCode } from '../sms-2fa/service';
import { createErrorMapperLogger, type AppContext, type RequestWithCookies } from '../types';

import type { SetPhoneRequest, VerifyPhoneRequest } from '../sms-2fa/types';

// ============================================================================
// Phone Regex (E.164-compatible, loose)
// ============================================================================

const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/;

// ============================================================================
// Handlers
// ============================================================================

/**
 * Handle setting a phone number and sending a verification code.
 *
 * POST /api/users/me/phone
 * Requires authentication.
 */
export async function handleSetPhone(
  ctx: AppContext,
  body: SetPhoneRequest,
  request: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    // Validate phone format
    if (!PHONE_REGEX.test(body.phone)) {
      throw new BadRequestError('Invalid phone number format', 'INVALID_PHONE_NUMBER');
    }

    // Check rate limit
    const rateLimit = await checkSmsRateLimit(ctx.db, userId);
    if (!rateLimit.allowed) {
      throw new TooManyRequestsError(
        'Too many SMS requests. Please try again later.',
        'SMS_RATE_LIMIT',
      );
    }

    // Get the SMS provider from context (may not be configured)
    if (ctx.sms === undefined) {
      ctx.log.error('SMS provider not configured');
      throw new UnavailableError('SMS service unavailable', 'SMS_SERVICE_UNAVAILABLE');
    }
    const smsProvider = ctx.sms;

    // Send verification code
    const result = await sendSms2faCode(ctx.db, smsProvider, userId, body.phone);

    if (!result.success) {
      ctx.log.error({ error: result.error }, 'Failed to send SMS verification code');
      throw new ExternalDependencyError('Failed to send verification code', 'SMS_SEND_FAILED', {
        error: result.error,
      });
    }

    return { message: 'Verification code sent' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle verifying a phone number with a code.
 *
 * POST /api/users/me/phone/verify
 * Requires authentication.
 */
export async function handleVerifyPhone(
  ctx: AppContext,
  body: VerifyPhoneRequest,
  request: RequestWithCookies,
): Promise<{ verified: true } | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    // Verify the code
    const result = await verifySms2faCode(ctx.db, userId, body.code);

    if (!result.valid) {
      throw new BadRequestError(result.message, 'SMS_VERIFICATION_FAILED');
    }

    // Get the phone number from the verified code record
    const pendingCode = await ctx.db.raw<{ phone: string }>(
      `SELECT phone FROM ${SMS_VERIFICATION_CODES_TABLE}
       WHERE user_id = $1 AND verified = true
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    const phone = pendingCode[0]?.phone;
    if (phone === undefined) {
      throw new BadRequestError('No phone number to verify', 'PHONE_VERIFICATION_PENDING');
    }

    // Update user record with verified phone
    await ctx.db.raw(
      `UPDATE ${USERS_TABLE} SET phone = $1, phone_verified = true, updated_at = NOW() WHERE id = $2`,
      [phone, userId],
    );

    return { verified: true };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}

/**
 * Handle removing a phone number.
 *
 * DELETE /api/users/me/phone
 * Requires authentication + sudo mode.
 */
export async function handleRemovePhone(
  ctx: AppContext,
  request: RequestWithCookies,
): Promise<{ message: string } | HttpErrorResponse> {
  try {
    const userId = request.user?.userId;
    if (userId === undefined) {
      throw new AuthenticationError(ERROR_MESSAGES.AUTHENTICATION_REQUIRED);
    }

    await assertUserActive((id) => ctx.repos.users.findById(id), userId);

    // Clear phone and phoneVerified
    await ctx.db.raw(
      `UPDATE ${USERS_TABLE} SET phone = NULL, phone_verified = NULL, updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    return { message: 'Phone number removed' };
  } catch (error) {
    return mapErrorToHttpResponse(error, createErrorMapperLogger(ctx.log));
  }
}
