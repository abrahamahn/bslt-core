// main/server/core/src/auth/consented-user.ts
/**
 * Signup Consent — enforcement and record.
 *
 * A new account and its consent to the published signup agreements (Terms of
 * Service, Privacy Policy — see SIGNUP_AGREEMENT_DOCUMENT_TYPES in shared) must
 * be born together. {@link insertConsentedUser} wraps {@link insertAttestedUser}
 * — the only way an authentication flow may insert into `users` — and adds the
 * refusal-or-record for consent, so every account-creating path (password
 * register, email OTP, magic link, OAuth) either records one `consent_records`
 * row per agreement or creates nothing.
 *
 * Posture when nothing is published (a fresh clone before the legal-template
 * migration ran, or an operator who unpublished everything): there is nothing
 * to consent to, so user creation proceeds and zero consent rows are written —
 * the same fail-open posture as the ToS acceptance gate in ./tos-gating.ts.
 *
 * The admin invite flow (admin/userService.ts) deliberately does NOT come
 * through here: an admin cannot consent on the user's behalf.
 *
 * @module auth/consented-user
 */

import { insert } from '@bslt/db/builder';
import { CONSENT_RECORDS_TABLE, type LegalDocument, type User } from '@bslt/db/schema';
import {
  isConsentConfirmed,
  SIGNUP_AGREEMENT_DOCUMENT_TYPES,
  SIGNUP_CONSENT_REQUIRED_CODE,
} from '@bslt/shared/core/compliance';
import { ForbiddenError } from '@bslt/shared/system';

import { insertAttestedUser, type NewUserValues } from './attestation';

import type { RawDb } from '@bslt/db/client';
import type { Repositories } from '@bslt/db/factory';

// ============================================================================
// Errors
// ============================================================================

/** Message shown to a caller that tried to create an account without consenting. */
const SIGNUP_CONSENT_REQUIRED_MESSAGE =
  'To create an account you must accept the Terms of Service and Privacy Policy.';

/**
 * Thrown when a request would create an account but carries no consent to the
 * published signup agreements.
 *
 * 403 rather than 400: the request is well-formed, we are refusing to act on it.
 * On the magic-link and email-OTP paths this is thrown without consuming the
 * one-time token, so the client can re-submit the SAME token with consent.
 */
export class SignupConsentRequiredError extends ForbiddenError {
  constructor() {
    super(SIGNUP_CONSENT_REQUIRED_MESSAGE, SIGNUP_CONSENT_REQUIRED_CODE);
    this.name = 'SignupConsentRequiredError';
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * The confirmations a signup request carries. Both fields are `unknown` on
 * purpose: they arrive from an untrusted body or encrypted state, and only the
 * strict checks here and in {@link insertAttestedUser} may interpret them.
 */
export interface SignupConsent {
  /** Consent to the signup agreements; counts only when exactly `true`. */
  agreed: unknown;
  /** Eligibility attestation (see ./attestation); counts only when exactly `true`. */
  attested: unknown;
  /** Client IP for the consent audit trail. */
  ipAddress?: string | undefined;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * The latest published documents a new account must consent to.
 *
 * Exposed so the magic-link/OTP pre-consume peek can decide whether missing
 * consent blocks (it does not when nothing is published — see module doc).
 *
 * @param repos - Repositories with legalDocuments
 * @returns Latest published version of each signup-agreement type
 * @complexity O(1) — one indexed query
 */
export async function findSignupAgreementDocuments(repos: Repositories): Promise<LegalDocument[]> {
  return (await repos.legalDocuments.findAllLatest()).filter((document) =>
    SIGNUP_AGREEMENT_DOCUMENT_TYPES.has(document.type),
  );
}

/**
 * Create a user row plus its signup-consent records, or refuse.
 *
 * The consent check runs BEFORE any write, and the consent rows are written in
 * the caller's transaction, so a user row and its consent evidence commit
 * together or not at all. The `created_at` on each consent row comes from the
 * database (`DEFAULT NOW()`), so a caller cannot backdate consent.
 *
 * @param tx - Transaction to insert within
 * @param repos - Repositories (published-agreement lookup)
 * @param values - Column values for the new user
 * @param consent - The raw confirmations from the client; required, never defaulted
 * @returns The created user
 * @throws {SignupConsentRequiredError} If agreements are published and consent
 *   was not confirmed — thrown before any write
 * @throws {EligibilityAttestationRequiredError} If the attestation was not confirmed
 * @complexity O(1) — bounded by the number of signup agreements (2)
 */
export async function insertConsentedUser(
  tx: RawDb,
  repos: Repositories,
  values: NewUserValues,
  consent: SignupConsent,
): Promise<User> {
  const documents = await findSignupAgreementDocuments(repos);

  if (documents.length > 0 && !isConsentConfirmed(consent.agreed)) {
    throw new SignupConsentRequiredError();
  }

  // Enforces the eligibility attestation, then inserts the row.
  const user = await insertAttestedUser(tx, values, consent.attested);

  for (const document of documents) {
    await tx.execute(
      insert(CONSENT_RECORDS_TABLE)
        .values({
          user_id: user.id,
          record_type: 'legal_document',
          document_id: document.id,
          // The driver refuses undefined outright; an unknown IP is NULL.
          ip_address: consent.ipAddress ?? null,
        })
        .toSql(),
    );
  }

  return user;
}
