// main/server/core/src/auth/routes/verification.ts
/**
 * Verification Route Entries
 *
 * Email verification and email-change confirmation flows.
 */

import {
  changeEmailRequestSchema,
  confirmEmailChangeRequestSchema,
  emailVerificationRequestSchema,
  resendVerificationRequestSchema,
  revertEmailChangeRequestSchema,
  type ChangeEmailRequest,
  type ConfirmEmailChangeRequest,
  type EmailVerificationRequest,
  type ResendVerificationRequest,
  type RevertEmailChangeRequest,
} from '@bslt/shared/core/auth';

import {
  handleChangeEmail,
  handleConfirmEmailChange,
  handleResendVerification,
  handleRevertEmailChange,
  handleVerifyEmail,
} from '../handlers';

import { authProtectedRoute, authPublicRoute, defineAuthRouteEntries } from './helpers';

export const verificationRouteEntries = defineAuthRouteEntries([
  [
    'auth/verify-email',
    authPublicRoute<EmailVerificationRequest>(
      'POST',
      (ctx, body, _request, reply) => handleVerifyEmail(ctx, body, reply),
      emailVerificationRequestSchema,
      { summary: 'Verify email address', tags: ['Auth'] },
    ),
  ],

  [
    'auth/resend-verification',
    authPublicRoute<ResendVerificationRequest>(
      'POST',
      (ctx, body) => handleResendVerification(ctx, body),
      resendVerificationRequestSchema,
      { summary: 'Resend verification email', tags: ['Auth'] },
    ),
  ],

  [
    'auth/change-email',
    authProtectedRoute<ChangeEmailRequest>(
      'POST',
      handleChangeEmail,
      'user',
      changeEmailRequestSchema,
      { summary: 'Request email change', tags: ['Auth', 'Email'] },
    ),
  ],

  [
    'auth/change-email/confirm',
    authPublicRoute<ConfirmEmailChangeRequest>(
      'POST',
      (ctx, body, request) => handleConfirmEmailChange(ctx, body, request),
      confirmEmailChangeRequestSchema,
      { summary: 'Confirm email change', tags: ['Auth', 'Email'] },
    ),
  ],

  [
    'auth/change-email/revert',
    authPublicRoute<RevertEmailChangeRequest>(
      'POST',
      (ctx, body) => handleRevertEmailChange(ctx, body),
      revertEmailChangeRequestSchema,
      { summary: 'Revert email change', tags: ['Auth', 'Email'] },
    ),
  ],
]);
