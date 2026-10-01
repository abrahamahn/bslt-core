// main/shared/src/modules/core/auth/auth.magic.link.schemas.ts
/**
 * @file Auth Magic Link Schemas
 * @description Schemas for magic link authentication flows.
 * @module Core/Auth
 */

import { createSchema, parseBoolean, parseString } from '../../../schema';
import { emailSchema } from '../schemas';
import { userSchema } from '../users/users.schemas';

import type { Schema } from '../../../schema';
import type { User } from '../users/users.schemas';

// ============================================================================
// Types
// ============================================================================

export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkVerifyRequest {
  token: string;
  /**
   * Confirmation of the signup eligibility statement (see
   * SIGNUP_ATTESTATION_STATEMENT in Core/Users).
   *
   * Optional because this endpoint is also how an EXISTING user signs in, and a
   * returning user must not be made to re-attest. The server requires it only
   * when the link would create a new account, and refuses to create one without
   * it (`ELIGIBILITY_ATTESTATION_REQUIRED`).
   */
  eligibilityAttested?: boolean;
  /**
   * Consent to the published signup agreements (see
   * SIGNUP_AGREEMENT_DOCUMENT_TYPES in Core/Compliance).
   *
   * Optional for the same reason: a returning user is never re-asked. The
   * server requires it only when the link would create a new account and there
   * are published agreements to consent to, and refuses to create one without
   * it (`SIGNUP_CONSENT_REQUIRED`) — leaving the one-time link unconsumed so
   * the same token can be re-submitted with consent.
   */
  tosAccepted?: boolean;
}

export interface MagicLinkRequestResponse {
  message: string;
}

export interface MagicLinkVerifyResponse {
  token: string;
  user: User;
}

// ============================================================================
// Schemas
// ============================================================================

export const magicLinkRequestSchema: Schema<MagicLinkRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { email: emailSchema.parse(obj['email']) };
});

export const magicLinkVerifyRequestSchema: Schema<MagicLinkVerifyRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      token: parseString(obj['token'], 'token', { min: 1 }),
      ...(obj['eligibilityAttested'] !== undefined
        ? { eligibilityAttested: parseBoolean(obj['eligibilityAttested'], 'eligibilityAttested') }
        : {}),
      ...(obj['tosAccepted'] !== undefined
        ? { tosAccepted: parseBoolean(obj['tosAccepted'], 'tosAccepted') }
        : {}),
    };
  },
);

export const magicLinkRequestResponseSchema: Schema<MagicLinkRequestResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return { message: parseString(obj['message'], 'message') };
  },
);

export const magicLinkVerifyResponseSchema: Schema<MagicLinkVerifyResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      token: parseString(obj['token'], 'token'),
      user: userSchema.parse(obj['user']),
    };
  },
);
