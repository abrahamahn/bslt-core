// main/apps/web/src/features/auth/utils/attestation.ts

/**
 * Recognising the server's "you must confirm you are eligible" refusal.
 *
 * @module features/auth/utils/attestation
 */

/**
 * Server error code meaning: this request is valid, but acting on it would CREATE
 * an account, and no eligibility confirmation was supplied.
 *
 * Mirrors ELIGIBILITY_ATTESTATION_REQUIRED_CODE in main/server/core/src/auth/attestation.ts.
 */
export const ELIGIBILITY_ATTESTATION_REQUIRED = 'ELIGIBILITY_ATTESTATION_REQUIRED';

/**
 * Server error code meaning: acting on this request would CREATE an account, and
 * no consent to the published signup agreements was supplied.
 *
 * Mirrors SIGNUP_CONSENT_REQUIRED_CODE in @bslt/shared (Core/Compliance). The
 * confirmation checkbox on the passwordless surfaces covers both statements, so
 * both codes lead to the same prompt-and-retry UI.
 */
export const SIGNUP_CONSENT_REQUIRED = 'SIGNUP_CONSENT_REQUIRED';

/**
 * Whether the server refused for want of a signup confirmation (the eligibility
 * statement or consent to the signup agreements — one checkbox covers both).
 *
 * Reads `code` structurally rather than testing `instanceof ApiError`. The error
 * class can be duplicated across an ESM/CJS boundary, which makes `instanceof`
 * quietly false for a genuine ApiError — and a false negative here does not fail
 * loudly, it strips the confirmation prompt and strands a new user on an error
 * screen with no way forward. The same reason `register.ts` matches on `error.name`.
 *
 * @param error - Anything thrown by the API client
 * @returns True when the refusal was specifically a signup-confirmation gate
 * @complexity O(1)
 */
export function isEligibilityAttestationRequired(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === ELIGIBILITY_ATTESTATION_REQUIRED || code === SIGNUP_CONSENT_REQUIRED;
}
