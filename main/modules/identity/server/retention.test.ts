// main/modules/identity/server/retention.test.ts
import { describe, expect, it, vi } from 'vitest';

import { COMPOSITE_USER_COLUMNS } from './repository';
import {
  ANONYMIZED_EMAIL_DOMAIN,
  RETAINED_USER_FIELDS,
  anonymizeExpiredUsers,
  anonymizedEmailFor,
  anonymizedUserFields,
  cleanupUnverifiedUsers,
  filterDeletedUsers,
  filterSoftDeletedFromResults,
  hardDeleteAnonymizedUsers,
  isAnonymizedUser,
  isReservedAnonymizedEmail,
  isUserDeleted,
  runUserRetention,
} from './retention';

import type { DbClient } from '@bslt/db';
import type { Logger } from '@bslt/server-system/logger';

const USER_ID = '22222222-2222-4222-8222-222222222222';

function makeLogger(): Logger {
  const log: Logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => log,
  };
  return log;
}

function makeFakeDb(overrides: Partial<DbClient> = {}): DbClient {
  const db: DbClient = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    execute: vi.fn().mockResolvedValue(0),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (fn) => fn(db)),
    withSession: () => db,
    getClient: vi.fn() as unknown as DbClient['getClient'],
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return db;
}

describe('identity user retention, anonymization, and data hygiene', () => {
  it('partitions every column of users between anonymizedUserFields and RETAINED_USER_FIELDS and detects reserved domains', () => {
    expect(ANONYMIZED_EMAIL_DOMAIN).toBe('anonymized.invalid');
    const addr = anonymizedEmailFor(USER_ID);
    expect(addr).toBe(`deleted-${USER_ID}@anonymized.invalid`);
    expect(isAnonymizedUser({ id: USER_ID, email: addr })).toBe(true);
    expect(isAnonymizedUser({ id: USER_ID, email: 'other@example.com' })).toBe(false);
    expect(isAnonymizedUser({ id: USER_ID, email: anonymizedEmailFor('other-id') })).toBe(false);

    expect(isReservedAnonymizedEmail('  someone@ANONYMIZED.INVALID ')).toBe(true);
    expect(isReservedAnonymizedEmail('u@sub.anonymized.invalid')).toBe(true);
    expect(isReservedAnonymizedEmail('u@notanonymized.invalid')).toBe(false);
    expect(isReservedAnonymizedEmail('u@example.com')).toBe(false);

    const scrubbed = Object.keys(anonymizedUserFields(USER_ID));
    const retained = [...RETAINED_USER_FIELDS];
    const retainedSet = new Set<string>(retained);
    const allUserKeys = Object.keys(COMPOSITE_USER_COLUMNS).sort();
    expect([...scrubbed, ...retained].sort()).toEqual(allUserKeys);
    expect(scrubbed.filter((k) => retainedSet.has(k))).toEqual([]);
  });

  it('filters soft-deleted users from arrays and paginated results', () => {
    const active = { id: '1', deletedAt: null };
    const deleted = { id: '2', deletedAt: new Date() };
    expect(isUserDeleted(active)).toBe(false);
    expect(isUserDeleted(deleted)).toBe(true);
    expect(filterDeletedUsers([active, deleted])).toEqual([active]);
    expect(
      filterSoftDeletedFromResults({ data: [active, deleted], total: 10, page: 1, limit: 20 }),
    ).toEqual({ data: [active], total: 9, page: 1, limit: 20 });
  });

  it('counts failed anonymizations without aborting the batch', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'u-fail' }, { id: 'u-ok' }])
      .mockResolvedValueOnce([]);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('constraint failure'))
      .mockResolvedValueOnce(1);
    const log = makeLogger();
    const res = await anonymizeExpiredUsers(makeFakeDb({ raw, execute }), log, { batchSize: 10 });
    expect(res).toEqual({ anonymizedCount: 1, failedCount: 1 });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('blocks purge when user has billing rows, shared orgs, or FK violations, and purges unshared users', async () => {
    const log = makeLogger();

    // Case 1: user has billing rows -> blocked
    const billingDb = makeFakeDb({
      raw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'u-bill' }]) // batch
        .mockResolvedValueOnce([{ id: 'u-bill' }]) // FOR UPDATE
        .mockResolvedValueOnce([{ kept: true }]), // USER_HAS_BILLING
    });
    expect(await hardDeleteAnonymizedUsers(billingDb, log, { batchSize: 10 })).toEqual({
      purgedCount: 0,
      blockedCount: 1,
      failedCount: 0,
    });

    // Case 2: FK violation 23503 on DELETE -> blocked (not failed)
    const fkDb = makeFakeDb({
      raw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'u-fk' }]) // batch
        .mockResolvedValueOnce([{ id: 'u-fk' }]) // FOR UPDATE
        .mockResolvedValueOnce([{ kept: false }]) // USER_HAS_BILLING
        .mockResolvedValueOnce([]), // owned orgs
      execute: vi.fn().mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' })),
    });
    expect(await hardDeleteAnonymizedUsers(fkDb, log, { batchSize: 10 })).toEqual({
      purgedCount: 0,
      blockedCount: 1,
      failedCount: 0,
    });

    // Case 3: unshared org + user purged cleanly
    const okDb = makeFakeDb({
      raw: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'u-ok' }])
        .mockResolvedValueOnce([{ id: 'u-ok' }])
        .mockResolvedValueOnce([{ kept: false }])
        .mockResolvedValueOnce([{ id: 'org-solo', shared: false }]),
      execute: vi.fn().mockResolvedValue(1),
    });
    expect(await hardDeleteAnonymizedUsers(okDb, log, { batchSize: 10 })).toEqual({
      purgedCount: 1,
      blockedCount: 0,
      failedCount: 0,
    });
  });

  it('skips OAuth-linked or active-session unverified users and isolates step failures in runUserRetention', async () => {
    const log = makeLogger();
    const cleanupDb = makeFakeDb({
      query: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'u-oauth' }, { id: 'u-sess' }, { id: 'u-stale' }]),
      queryOne: vi
        .fn()
        // u-oauth: has oauth
        .mockResolvedValueOnce({ count: 1 })
        // u-sess: no oauth, has session
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 2 })
        // u-stale: no oauth, no session
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 }),
      execute: vi.fn().mockResolvedValue(1),
    });
    expect(await cleanupUnverifiedUsers(cleanupDb, log)).toEqual({ deletedCount: 1 });

    // Step failure isolation in runUserRetention
    const brokenDb = makeFakeDb({
      raw: vi.fn().mockRejectedValueOnce(new Error('step 1 boom')).mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([]),
    });
    const retentionRes = await runUserRetention(brokenDb, log);
    expect(retentionRes.failedCount).toBe(1);
    expect(log.error).toHaveBeenCalled();
  });
});
