// main/shared/src/modules/core/users/attestation.policy.ts

/**
 * @file Signup Eligibility Attestation Policy
 * @description The single source of truth for what a person confirms when they
 *   create an account: that they are old enough to consent in their country,
 *   that they meet their jurisdiction's requirements, and that they accept the
 *   Terms of Service.
 *
 *   The published Terms say these things. This module is what makes them true:
 *   the statement rendered in the UI and the statement recorded against the user
 *   row are the same string, from here.
 *
 *   Changing {@link SIGNUP_ATTESTATION_STATEMENT} without bumping
 *   {@link SIGNUP_ATTESTATION_VERSION} would silently rewrite what past users are
 *   recorded as having said. `attestation.policy.test.ts` pins both to prevent it.
 * @module Core/Users
 */

// ============================================================================
// Policy
// ============================================================================

/**
 * Minimum age to hold an account. We attest to it; we do not verify it (no
 * date of birth is collected). In the EEA the digital age of consent can be as
 * high as 16, which the statement below calls out explicitly.
 */
export const MINIMUM_SIGNUP_AGE = 13;

/**
 * Version of the statement below. Bump on ANY wording change so that a user's
 * recorded version always resolves to the words they actually saw.
 */
export const SIGNUP_ATTESTATION_VERSION = '2026-07-15.v1';

/** The exact words the user confirms. Rendered in the UI; recorded per user. */
export const SIGNUP_ATTESTATION_STATEMENT =
  'I am old enough to consent to these terms in my country (at least 13, or 16 in the EEA), I meet my jurisdiction’s requirements for holding an account, and I accept the Terms of Service.';

// ============================================================================
// Types
// ============================================================================

/** A confirmation that was actually made: the words, and the moment. */
export interface SignupAttestation {
  /** Which version of {@link SIGNUP_ATTESTATION_STATEMENT} was confirmed. */
  readonly version: string;
  /** When it was confirmed. */
  readonly attestedAt: Date;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Whether a value is an explicit confirmation.
 *
 * Strictly `true` — never a truthy string, number, or object. An absent or
 * coerced value is not consent, so a client that omits the field, or sends
 * `"false"`, `"true"`, or `1`, has not attested.
 *
 * @param value - Raw value from an untrusted request body or token metadata
 * @returns True only for the boolean `true`
 * @complexity O(1)
 */
export function isAttestationConfirmed(value: unknown): value is true {
  return value === true;
}

/**
 * Record an attestation being made now, stamped with the current statement version.
 *
 * @param now - The moment of attestation (injectable for tests)
 * @returns The attestation to persist
 * @complexity O(1)
 */
export function createSignupAttestation(now: Date = new Date()): SignupAttestation {
  return { version: SIGNUP_ATTESTATION_VERSION, attestedAt: now };
}
