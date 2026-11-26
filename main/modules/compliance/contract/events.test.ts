// main/modules/compliance/contract/events.test.ts
import { describe, expect, it } from 'vitest';

import { complianceEvents } from './events';

describe('complianceEvents', () => {
  it('rejects malformed payloads and accepts valid compliance domain event payloads', () => {
    expect(
      complianceEvents.legalDocumentPublished.payload.safeParse({
        documentId: '',
        type: 'tos',
        version: 0,
        publishedByUserId: 'u1',
      }).success,
    ).toBe(false);

    expect(
      complianceEvents.ageAssuranceCompleted.payload.safeParse({
        checkId: 'chk-1',
        userId: 'u1',
        threshold: 10,
        resultOverThreshold: true,
      }).success,
    ).toBe(false);

    expect(
      complianceEvents.consentUpdated.payload.safeParse({
        userId: 'u1',
        updated: 0,
      }).success,
    ).toBe(false);

    expect(
      complianceEvents.legalDocumentPublished.payload.safeParse({
        documentId: 'doc-1',
        type: 'tos',
        version: 2,
        publishedByUserId: 'u1',
      }).success,
    ).toBe(true);

    expect(
      complianceEvents.legalHoldPlaced.payload.safeParse({
        holdId: 'hold-1',
        subjectType: 'user',
        subjectId: 'u1',
        createdByUserId: null,
      }).success,
    ).toBe(true);
  });
});
