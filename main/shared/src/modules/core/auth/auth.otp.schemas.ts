// main/shared/src/modules/core/auth/auth.otp.schemas.ts
/**
 * @file Auth Email OTP Schemas
 * @description Schemas for passwordless login via a one-time 6-digit email code.
 * @module Core/Auth
 */

import { createSchema, parseBoolean, parseString } from '../../../schema';
import { emailSchema, passwordSchema } from '../schemas';
import { userSchema } from '../users/users.schemas';

import type { Schema } from '../../../schema';
import type { User } from '../users/users.schemas';

// ============================================================================
// Constants
// ============================================================================

/** Number of digits in an email OTP code. */
export const EMAIL_OTP_CODE_LENGTH = 6;

/** Matches a 6-digit numeric code. */
const EMAIL_OTP_CODE_REGEX = /^\d{6}$/;

// ============================================================================
// Types
// ============================================================================

export interface EmailOtpRequest {
  email: string;
}

export interface EmailOtpVerifyRequest {
  email: string;
  code: string;
  /**
   * Confirmation of the signup eligibility statement (see
   * SIGNUP_ATTESTATION_STATEMENT in Core/Users).
   *
   * Optional because this endpoint is also how an EXISTING user signs in, and a
   * returning user must not be made to re-attest. The server requires it only
   * when the code would create a new account, and refuses to create one without
   * it (`ELIGIBILITY_ATTESTATION_REQUIRED`).
   */
  eligibilityAttested?: boolean;
  /**
   * Consent to the published signup agreements (see
   * SIGNUP_AGREEMENT_DOCUMENT_TYPES in Core/Compliance).
   *
   * Optional for the same reason: a returning user is never re-asked. The
   * server requires it only when the code would create a new account and there
   * are published agreements to consent to, and refuses to create one without
   * it (`SIGNUP_CONSENT_REQUIRED`) — leaving the one-time code unconsumed (and
   * uncounted against the attempt budget) so the same code can be re-submitted
   * with consent.
   */
  tosAccepted?: boolean;
}

export interface EmailOtpRequestResponse {
  message: string;
}

export interface EmailOtpVerifyResponse {
  token: string;
  user: User;
  /** True when this verification just created the account, so the client must run onboarding. */
  isNewUser: boolean;
}

/**
 * Profile completion for a brand-new passwordless user. All fields are required:
 * a first-time OTP sign-in creates a bare account, and onboarding fills in the
 * real name, a chosen username, and a password so the user can also sign in with
 * a password later.
 */
export interface CompleteOnboardingRequest {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
}

export interface CompleteOnboardingResponse {
  user: User;
}

// ============================================================================
// Schemas
// ============================================================================

export const emailOtpRequestSchema: Schema<EmailOtpRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { email: emailSchema.parse(obj['email']) };
});

export const emailOtpVerifyRequestSchema: Schema<EmailOtpVerifyRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      email: emailSchema.parse(obj['email']),
      code: parseString(obj['code'], 'code', {
        trim: true,
        length: EMAIL_OTP_CODE_LENGTH,
        regex: EMAIL_OTP_CODE_REGEX,
        regexMessage: 'Code must be 6 digits',
      }),
      ...(obj['eligibilityAttested'] !== undefined
        ? { eligibilityAttested: parseBoolean(obj['eligibilityAttested'], 'eligibilityAttested') }
        : {}),
      ...(obj['tosAccepted'] !== undefined
        ? { tosAccepted: parseBoolean(obj['tosAccepted'], 'tosAccepted') }
        : {}),
    };
  },
);

export const emailOtpRequestResponseSchema: Schema<EmailOtpRequestResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { message: parseString(obj['message'], 'message') };
  },
);

export const emailOtpVerifyResponseSchema: Schema<EmailOtpVerifyResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      token: parseString(obj['token'], 'token'),
      user: userSchema.parse(obj['user']),
      isNewUser: parseBoolean(obj['isNewUser'], 'isNewUser'),
    };
  },
);

export const completeOnboardingRequestSchema: Schema<CompleteOnboardingRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      firstName: parseString(obj['firstName'], 'first name', { min: 1, trim: true }),
      lastName: parseString(obj['lastName'], 'last name', { min: 1, trim: true }),
      username: parseString(obj['username'], 'username', { min: 2, trim: true }),
      password: passwordSchema.parse(obj['password']),
    };
  },
);

export const completeOnboardingResponseSchema: Schema<CompleteOnboardingResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { user: userSchema.parse(obj['user']) };
  },
);
