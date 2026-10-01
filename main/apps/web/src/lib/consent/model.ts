// main/apps/web/src/lib/consent/model.ts
/**
 * The consent model: one vocabulary, one decision, no DOM.
 *
 * This is the single source of truth for what we are allowed to load. It is
 * deliberately pure — every rule below is a legal position, and a legal
 * position you cannot unit-test is a legal position you do not have.
 *
 * `necessary` is a category but never a stored flag: it is always on, and
 * persisting it would imply it could be switched off. Only `analytics` and
 * `ads` are recorded.
 *
 * The vocabulary is shared with the server-side consent record
 * (compliance consent_records, via `useUpdateConsent`) through the mappers at
 * the foot of this file. There is one decision; the server keeps the durable,
 * auditable copy for signed-in users and this module keeps the copy that can
 * be read synchronously, before React, for everyone else.
 */

import { createEnumSchema, createSchema, parseString } from '@bslt/shared/schema';

import type { Schema } from '@bslt/shared/schema';

// ============================================================================
// Categories
// ============================================================================

export const CONSENT_CATEGORIES = ['analytics', 'ads'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export const CONSENT_STATUSES = ['granted', 'denied', 'unset'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** What was chosen, without regard to when. */
export interface ConsentStatuses {
  readonly analytics: ConsentStatus;
  /** Personalised advertising — i.e. "sharing" under the CPRA. */
  readonly ads: ConsentStatus;
}

/**
 * A recorded choice. Absence of a decision is represented by `null` everywhere
 * rather than by a decision full of `unset` — "never asked" and "asked, and
 * they declined to answer" are the same in law but different in the UI, and a
 * sentinel object blurs the two.
 */
export interface ConsentDecision extends ConsentStatuses {
  /** ISO-8601. GDPR requires the *when* of a consent, not just the *what*. */
  readonly updatedAt: string;
}

// ============================================================================
// Persistence schema
// ============================================================================

const consentStatusSchema = createEnumSchema(CONSENT_STATUSES, 'consent status');

/** localStorage is an untrusted boundary: anything can be typed into it. */
export const consentDecisionSchema: Schema<ConsentDecision> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    analytics: consentStatusSchema.parse(obj['analytics']),
    ads: consentStatusSchema.parse(obj['ads']),
    updatedAt: parseString(obj['updatedAt'], 'updatedAt', { min: 1 }),
  };
});

// ============================================================================
// Server vocabulary (compliance consent_records, via useUpdateConsent)
// ============================================================================

/**
 * Personalised advertising is exactly two of the server's consent types at
 * once: the data is *shared* with a third party, and it is used to *profile*
 * the user. Both must be granted, or the answer is no — which is also what
 * makes the CPRA opt-out coherent, since "Do Not Sell or Share" must revoke
 * both. `marketing_email` is deliberately absent: it is an email preference,
 * not a script consent, and it has its own control in Settings.
 */
export interface ServerConsentInput {
  readonly analytics?: boolean;
  readonly third_party_sharing?: boolean;
  readonly profiling?: boolean;
}

export interface ServerConsentPreferences {
  readonly analytics: boolean | null;
  readonly third_party_sharing: boolean | null;
  readonly profiling: boolean | null;
}

export function toServerConsent(decision: ConsentDecision): ServerConsentInput {
  const adsGranted = decision.ads === 'granted';
  const input: {
    analytics?: boolean;
    third_party_sharing?: boolean;
    profiling?: boolean;
  } = {};

  if (decision.analytics !== 'unset') input.analytics = decision.analytics === 'granted';
  if (decision.ads !== 'unset') {
    input.third_party_sharing = adsGranted;
    input.profiling = adsGranted;
  }
  return input;
}

function statusOf(value: boolean | null): ConsentStatus {
  if (value === null) return 'unset';
  return value ? 'granted' : 'denied';
}

/**
 * Rehydrate the local statuses from the server record (signed-in users). The
 * caller stamps the time, so this stays a pure projection of the server's answer.
 */
export function fromServerConsent(preferences: ServerConsentPreferences): ConsentStatuses {
  const { third_party_sharing: sharing, profiling } = preferences;
  const adsUnset = sharing === null && profiling === null;

  return {
    analytics: statusOf(preferences.analytics),
    ads: adsUnset ? 'unset' : statusOf(sharing === true && profiling === true),
  };
}
