// main/shared/src/modules/core/compliance/legal.policy.ts

/**
 * @file Signup Legal Consent Policy
 * @description The single source of truth for what a person consents to when
 *   they create an account: the DB-published signup agreements (Terms of
 *   Service and Privacy Policy), and what counts as consent to them.
 *
 *   `insertConsentedUser` in server core is the enforcement point — the only
 *   path by which an authentication flow may create a user row records one
 *   consent row per agreement listed here, or creates nothing. This module is
 *   the vocabulary it enforces. Deliberately NO age, date of birth, or
 *   jurisdiction here — those live in the eligibility attestation policy
 *   (Core/Users), which attests rather than verifies.
 * @module Core/Compliance
 */

import { PUBLISHABLE_DOCUMENT_TYPES } from '../../../constants/core';

import type { DocumentType } from './compliance.schemas';

// ============================================================================
// Policy
// ============================================================================

/**
 * The document types every new account consents to at signup — exactly the
 * DB-published subset, built from the shared constant so a misspelled or
 * removed member cannot compile. Declared as `ReadonlySet<string>` because
 * `legal_documents.type` is free text in the DB.
 */
export const SIGNUP_AGREEMENT_DOCUMENT_TYPES: ReadonlySet<string> = new Set<DocumentType>(
  PUBLISHABLE_DOCUMENT_TYPES,
);

/**
 * Error code a signup refusal carries when the request would create an account
 * without consent to the published signup agreements. 403 rather than 400: the
 * request is well-formed, the server is refusing to act on it. The client
 * prompts for the confirmation and re-submits the same request — including the
 * same one-time token on the magic-link and email-OTP paths, which the server
 * leaves unconsumed for exactly this retry.
 */
export const SIGNUP_CONSENT_REQUIRED_CODE = 'SIGNUP_CONSENT_REQUIRED';

// ============================================================================
// Functions
// ============================================================================

/**
 * Whether a value is an explicit consent.
 *
 * Strictly `true` — never a truthy string, number, or object. An absent or
 * coerced value is not consent, so a client that omits the field, or sends
 * `"true"`, `"on"`, or `1`, has not consented.
 *
 * @param value - Raw value from an untrusted request body or encrypted state
 * @returns True only for the boolean `true`
 * @complexity O(1)
 */
export function isConsentConfirmed(value: unknown): value is true {
  return value === true;
}
