// main/modules/compliance/web/consent/model.ts
import { enumOf, object, string, type Schema } from '@bslt/schema';

export const CONSENT_CATEGORIES = ['analytics', 'ads'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export const CONSENT_STATUSES = ['granted', 'denied', 'unset'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export interface ConsentStatuses {
  readonly analytics: ConsentStatus;
  readonly ads: ConsentStatus;
}

export interface ConsentDecision extends ConsentStatuses {
  readonly updatedAt: string;
}

const consentStatusSchema = enumOf(CONSENT_STATUSES);

export const consentDecisionSchema: Schema<ConsentDecision> = object({
  analytics: consentStatusSchema,
  ads: consentStatusSchema,
  updatedAt: string({ min: 1 }),
});

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

export function fromServerConsent(preferences: ServerConsentPreferences): ConsentStatuses {
  const { third_party_sharing: sharing, profiling } = preferences;
  const ads: ConsentStatus =
    sharing === null && profiling === null
      ? 'unset'
      : sharing === true && profiling === true
        ? 'granted'
        : 'denied';

  return {
    analytics: statusOf(preferences.analytics),
    ads,
  };
}
