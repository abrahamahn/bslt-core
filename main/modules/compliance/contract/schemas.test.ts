// main/modules/compliance/contract/schemas.test.ts
import { describe, expect, it } from 'vitest';

import {
  acceptTosBodySchema,
  acceptTosResponseSchema,
  complianceEnvSchema,
  isConsentConfirmed,
  placeLegalHoldBodySchema,
  publishLegalDocumentBodySchema,
  requestDataExportBodySchema,
  startAgeAssuranceBodySchema,
  tosStatusResponseSchema,
  updateConsentPreferencesBodySchema,
  upsertJurisdictionRuleBodySchema,
} from './schemas';

describe('compliance contract schemas', () => {
  it('rejects malformed publishLegalDocumentBodySchema inputs and accepts valid ISO effectiveAt', () => {
    expect(() =>
      publishLegalDocumentBodySchema.parse({
        type: '',
        title: 'Terms',
        content: 'Body',
        effectiveAt: '2026-11-19T00:00:00.000Z',
      }),
    ).toThrow();
    expect(() =>
      publishLegalDocumentBodySchema.parse({
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Body',
        effectiveAt: 'not-a-date',
      }),
    ).toThrow(/effectiveAt/);
    expect(() =>
      publishLegalDocumentBodySchema.parse({
        type: 'terms_of_service',
        title: 'Terms',
        content: '',
        effectiveAt: '2026-11-19T00:00:00.000Z',
      }),
    ).toThrow();

    expect(
      publishLegalDocumentBodySchema.parse({
        type: 'terms_of_service',
        title: 'Terms',
        content: '# Terms',
        effectiveAt: '2026-11-19T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'terms_of_service',
      title: 'Terms',
      content: '# Terms',
      version: undefined,
      effectiveAt: '2026-11-19T00:00:00.000Z',
    });
  });

  it('requires at least one boolean preference in updateConsentPreferencesBodySchema', () => {
    expect(() => updateConsentPreferencesBodySchema.parse({})).toThrow(/At least one/);
    expect(() => updateConsentPreferencesBodySchema.parse({ analytics: 'yes' })).toThrow();
    expect(() => updateConsentPreferencesBodySchema.parse(null)).toThrow();

    expect(updateConsentPreferencesBodySchema.parse({ analytics: true })).toEqual({
      analytics: true,
      marketing_email: undefined,
      third_party_sharing: undefined,
      profiling: undefined,
    });
  });

  it('validates requestDataExportBodySchema, startAgeAssuranceBodySchema, legal holds, jurisdiction rules, and env', () => {
    expect(() => requestDataExportBodySchema.parse({ format: 'xml' })).toThrow();
    expect(() => startAgeAssuranceBodySchema.parse({ threshold: 10, confirmed: true })).toThrow();
    expect(() => startAgeAssuranceBodySchema.parse({ method: 'magic', confirmed: true })).toThrow();
    expect(() =>
      placeLegalHoldBodySchema.parse({ subjectType: 'user', subjectId: '', reason: 'Hold' }),
    ).toThrow();
    expect(() =>
      placeLegalHoldBodySchema.parse({ subjectType: 'user', subjectId: 'u-1', reason: 'no' }),
    ).toThrow();
    expect(() =>
      upsertJurisdictionRuleBodySchema.parse({
        jurisdiction: 'X',
        minimumAge: 18,
        requiresAgeAssurance: true,
      }),
    ).toThrow();
    expect(() => complianceEnvSchema.parse({ COMPLIANCE_MINIMUM_SIGNUP_AGE: '12' })).toThrow();

    expect(isConsentConfirmed(false)).toBe(false);
    expect(isConsentConfirmed('true')).toBe(false);
    expect(isConsentConfirmed(true)).toBe(true);
    expect(requestDataExportBodySchema.parse({})).toEqual({ format: undefined });
    expect(complianceEnvSchema.parse({ COMPLIANCE_MINIMUM_SIGNUP_AGE: '18' })).toEqual({
      COMPLIANCE_MINIMUM_SIGNUP_AGE: 18,
      COMPLIANCE_DEFAULT_JURISDICTION: undefined,
    });
  });

  it('validates ToS status and acceptance schemas with >= 60% failure assertions', () => {
    expect(() => acceptTosBodySchema.parse({})).toThrow();
    expect(() => acceptTosBodySchema.parse({ documentId: '' })).toThrow();
    expect(() => acceptTosBodySchema.parse({ documentId: 42 })).toThrow();
    expect(() => acceptTosResponseSchema.parse({ agreedAt: '' })).toThrow();
    expect(() =>
      tosStatusResponseSchema.parse({
        accepted: 'yes',
        requiredVersion: 1,
        documentId: 'doc-1',
      }),
    ).toThrow();
    expect(() =>
      tosStatusResponseSchema.parse({
        accepted: false,
        requiredVersion: 0,
        documentId: 'doc-1',
      }),
    ).toThrow();

    expect(acceptTosBodySchema.parse({ documentId: 'doc-1' })).toEqual({ documentId: 'doc-1' });
    expect(acceptTosResponseSchema.parse({ agreedAt: '2026-11-20T00:00:00.000Z' })).toEqual({
      agreedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(
      tosStatusResponseSchema.parse({
        accepted: true,
        requiredVersion: null,
        documentId: null,
      }),
    ).toEqual({
      accepted: true,
      requiredVersion: null,
      documentId: null,
    });
  });
});
