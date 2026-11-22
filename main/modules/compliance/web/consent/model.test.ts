// main/modules/compliance/web/consent/model.test.ts
import { describe, expect, it } from 'vitest';

import { consentDecisionSchema, fromServerConsent, toServerConsent } from './model';

import type { ConsentDecision } from './model';

function decision(overrides: Partial<ConsentDecision> = {}): ConsentDecision {
  return { analytics: 'unset', ads: 'unset', updatedAt: '2026-07-15T00:00:00.000Z', ...overrides };
}

describe('consentDecisionSchema', () => {
  it('accepts a well-formed decision and rejects invalid statuses, empty timestamps, missing categories, or non-objects', () => {
    const value = decision({ ads: 'denied', analytics: 'granted' });
    expect(consentDecisionSchema.parse(value)).toEqual(value);

    expect(consentDecisionSchema.safeParse({ ...decision(), ads: 'maybe' }).success).toBe(false);
    expect(consentDecisionSchema.safeParse({ ...decision(), updatedAt: '' }).success).toBe(false);
    expect(consentDecisionSchema.safeParse({ analytics: 'granted' }).success).toBe(false);
    expect(consentDecisionSchema.safeParse(null).success).toBe(false);
    expect(consentDecisionSchema.safeParse('granted').success).toBe(false);
    expect(consentDecisionSchema.safeParse(42).success).toBe(false);
  });

  it('maps between client consent and server vocabulary without drift', () => {
    expect(toServerConsent(decision({ ads: 'granted' }))).toEqual({
      third_party_sharing: true,
      profiling: true,
    });
    expect(toServerConsent(decision({ ads: 'denied' }))).toEqual({
      third_party_sharing: false,
      profiling: false,
    });
    expect(toServerConsent(decision())).toEqual({});
    expect(
      fromServerConsent({ analytics: null, third_party_sharing: true, profiling: false }).ads,
    ).toBe('denied');
    expect(
      fromServerConsent({ analytics: null, third_party_sharing: null, profiling: null }),
    ).toEqual({ analytics: 'unset', ads: 'unset' });
  });
});
