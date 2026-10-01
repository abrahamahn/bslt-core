// main/server/core/src/auth/otp/routes.ts
/**
 * Email OTP Routes
 *
 * Route definitions for passwordless login via a one-time email code.
 *
 * @module otp/routes
 */

import { createRouteMap } from '@bslt/server-system/http';
import {
  completeOnboardingRequestSchema,
  emailOtpRequestSchema,
  emailOtpVerifyRequestSchema,
  type CompleteOnboardingRequest,
  type EmailOtpRequest,
  type EmailOtpVerifyRequest,
} from '@bslt/shared/core/auth';

import { authProtectedRoute, authPublicRoute, defineAuthRouteEntries } from '../routes/helpers';

import { handleCompleteOnboarding, handleEmailOtpRequest, handleEmailOtpVerify } from './handlers';

// ============================================================================
// Route Entries (for merging with parent routes)
// ============================================================================

export const emailOtpRouteEntries = defineAuthRouteEntries([
  [
    'auth/otp/request',
    authPublicRoute<EmailOtpRequest>('POST', handleEmailOtpRequest, emailOtpRequestSchema, {
      summary: 'Request a 6-digit email login code',
      tags: ['Auth', 'Email OTP'],
    }),
  ],

  [
    'auth/otp/verify',
    authPublicRoute<EmailOtpVerifyRequest>(
      'POST',
      handleEmailOtpVerify,
      emailOtpVerifyRequestSchema,
      { summary: 'Verify a 6-digit email login code', tags: ['Auth', 'Email OTP'] },
    ),
  ],

  [
    'auth/onboarding/complete',
    authProtectedRoute<CompleteOnboardingRequest>(
      'POST',
      handleCompleteOnboarding,
      [],
      completeOnboardingRequestSchema,
      { summary: 'Complete profile for a new passwordless user', tags: ['Auth', 'Email OTP'] },
    ),
  ],
]);

// ============================================================================
// Route Map (for standalone use)
// ============================================================================

export const emailOtpRoutes = createRouteMap(emailOtpRouteEntries);
