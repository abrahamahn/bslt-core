// main/modules/compliance/server/repository.test.ts
import { describe, expect, it, vi } from 'vitest';

import { complianceRepository } from './repository';

import type { RawDb } from '@bslt/db';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const REQ_ID = '33333333-3333-4333-8333-333333333333';
const HOLD_ID = '44444444-4444-4444-8444-444444444444';

function makeDb(overrides: Partial<RawDb> = {}): RawDb {
  return {
    query: vi.fn(async () => Promise.resolve([])),
    queryOne: vi.fn(async () => Promise.resolve(null)),
    execute: vi.fn(async () => Promise.resolve(0)),
    raw: vi.fn(async () => Promise.resolve([])),
    ...overrides,
  } as unknown as RawDb;
}

describe('complianceRepository', () => {
  it('returns null/empty safely for non-UUID inputs and throws when insert returns no row', async () => {
    const db = makeDb();
    const repo = complianceRepository(db);

    await expect(repo.findLegalDocumentById('not-a-uuid')).resolves.toBeNull();
    await expect(repo.findAgreementByUserAndDocument('bad', DOC_ID)).resolves.toBeNull();
    await expect(repo.findDataRequestById('bad')).resolves.toBeNull();
    await expect(repo.findLegalHoldById('bad')).resolves.toBeNull();
    await expect(repo.listAgreementsByUserId('bad')).resolves.toEqual([]);
    await expect(repo.deleteDataRequestsByUserId('bad')).resolves.toBe(0);
    await expect(repo.deleteAgeAssuranceChecksByUserId('bad')).resolves.toBe(0);

    await expect(
      repo.insertLegalDocument({
        type: 'terms_of_service',
        title: 'Terms',
        content: 'Body',
        version: 1,
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/legal document/i);

    await expect(
      repo.recordAgreement({
        userId: USER_ID,
        documentId: DOC_ID,
      }),
    ).rejects.toThrow(/agreement/i);

    await expect(
      repo.insertDataRequest({
        userId: USER_ID,
        type: 'export',
      }),
    ).rejects.toThrow(/data request/i);
  });

  it('uses $N::text::jsonb parameter casts and transforms snake_case rows accurately', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: DOC_ID,
          type: 'terms_of_service',
          title: 'Terms',
          content: 'Body',
          version: 2,
          effective_at: new Date('2026-01-01T00:00:00.000Z'),
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: REQ_ID,
          user_id: USER_ID,
          type: 'export',
          status: 'pending',
          format: 'json',
          download_url: null,
          expires_at: null,
          completed_at: null,
          error_message: null,
          metadata: { requestedAt: '2026-01-01T00:00:00.000Z' },
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: HOLD_ID,
          subject_type: 'user',
          subject_id: USER_ID,
          reason: 'Investigation',
          created_by_user_id: USER_ID,
          held_until: null,
          released_at: null,
          released_by_user_id: null,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

    const db = makeDb({ raw: raw as unknown as RawDb['raw'] });
    const repo = complianceRepository(db);

    const docs = await repo.findAllLatestLegalDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.version).toBe(2);

    const createdReq = await repo.insertDataRequest({
      userId: USER_ID,
      type: 'export',
      format: 'json',
      metadata: { requestedAt: '2026-01-01T00:00:00.000Z' },
    });
    expect(createdReq.id).toBe(REQ_ID);
    const insertSql = String(raw.mock.calls[1]?.[0]);
    expect(insertSql).toContain('::text::jsonb');

    const hold = await repo.insertLegalHold({
      subjectType: 'user',
      subjectId: USER_ID,
      reason: 'Investigation',
      createdByUserId: USER_ID,
    });
    expect(hold.id).toBe(HOLD_ID);
  });
});
