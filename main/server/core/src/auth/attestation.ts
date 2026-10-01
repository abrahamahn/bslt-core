// main/server/core/src/auth/attestation.ts
/**
 * Signup Eligibility Attestation — enforcement and record.
 *
 * The published Terms say an account holder is old enough to consent (13+, or
 * 16+ in the EEA), meets their jurisdiction's requirements, and accepts the
 * Terms. This module is the only place an authentication flow may create a
 * user row, and it will not do so without an explicit confirmation.
 *
 * The checkbox in the browser is decoration; it is trivially bypassed by anyone
 * posting JSON. {@link insertAttestedUser} is the actual gate. Every account-
 * creating path — password register, email OTP, magic link, OAuth — funnels
 * through it, which is what makes "you cannot sign up without attesting" a
 * property of the system rather than a promise in a document.
 *
 * @module auth/attestation
 */

import { insert } from '@bslt/db/builder';
import { USER_COLUMNS, USERS_TABLE, type User } from '@bslt/db/schema';
import { toCamelCase } from '@bslt/db/utils';
import { createSignupAttestation, isAttestationConfirmed } from '@bslt/shared/core/users';
import { ForbiddenError } from '@bslt/shared/system';

import type { RawDb } from '@bslt/db/client';

// ============================================================================
// Constants
// ============================================================================

/** Error code clients switch on to prompt for the attestation and retry. */
export const ELIGIBILITY_ATTESTATION_REQUIRED_CODE = 'ELIGIBILITY_ATTESTATION_REQUIRED';

/** Message shown to a caller that tried to create an account without attesting. */
const ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE =
  'To create an account you must confirm that you are old enough to consent in your country, meet your jurisdiction’s requirements, and accept the Terms of Service.';

// ============================================================================
// Errors
// ============================================================================

/**
 * Thrown when a request would create an account but carries no attestation.
 *
 * 403 rather than 400: the request is well-formed, we are refusing to act on it.
 */
export class EligibilityAttestationRequiredError extends ForbiddenError {
  constructor() {
    super(ELIGIBILITY_ATTESTATION_REQUIRED_MESSAGE, ELIGIBILITY_ATTESTATION_REQUIRED_CODE);
    this.name = 'EligibilityAttestationRequiredError';
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Column values for a new user row, minus the attestation columns —
 * those are supplied by {@link insertAttestedUser} and may not be forged
 * by callers.
 */
export interface NewUserValues {
  email: string;
  canonical_email: string;
  username: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  role: 'user';
  email_verified: boolean;
  email_verified_at?: Date | null;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Create a user row, or refuse.
 *
 * The only path by which an authentication flow may insert into `users`. The
 * attestation is not an optional parameter and not a boolean the caller can
 * default — an unconfirmed value throws before any row is written.
 *
 * The timestamp and statement version are stamped here, from the server clock and
 * the shared policy constant. A caller cannot supply either, so a user row can
 * never carry a record of an attestation that was not just made.
 *
 * @param tx - Transaction to insert within (so the row and its attestation commit together)
 * @param values - Column values for the new user
 * @param attested - The raw confirmation from the client; must be exactly `true`
 * @returns The created user
 * @throws {EligibilityAttestationRequiredError} If the attestation was not confirmed
 * @throws {Error} If the insert returns no row
 * @complexity O(1)
 */
export async function insertAttestedUser(
  tx: RawDb,
  values: NewUserValues,
  attested: unknown,
): Promise<User> {
  if (!isAttestationConfirmed(attested)) {
    throw new EligibilityAttestationRequiredError();
  }

  const attestation = createSignupAttestation();

  const rows = await tx.query(
    insert(USERS_TABLE)
      .values({
        ...values,
        eligibility_attested_at: attestation.attestedAt,
        eligibility_attestation_version: attestation.version,
      })
      .returningAll()
      .toSql(),
  );

  if (rows[0] === undefined) {
    throw new Error('Failed to create user');
  }

  return toCamelCase<User>(rows[0], USER_COLUMNS);
}
