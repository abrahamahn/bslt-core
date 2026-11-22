// tests/integration/api/data-hygiene.integration.test.ts
/**
 * Data Hygiene Integration Tests
 *
 * Verifies the full lifecycle of data hygiene operations in `@bslt/identity/server`
 * and `@bslt/audit/server`:
 * 1. Soft-delete user -> PII anonymization cron runs -> PII overwritten -> audit events queryable
 * 2. Unverified user past expiry threshold -> cleanup cron deletes unless OAuth or active session exists
 */

import { listActorAuditTrailForExport } from '@bslt/audit/server';
import {
  anonymizedEmailFor,
  anonymizeExpiredUsers,
  cleanupUnverifiedUsers,
  type AnonymizeResult,
  type CleanupResult,
} from '@bslt/identity/server';
import { createMockLogger } from '@bslt/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@bslt/db';
import type { Logger as ServerLogger } from '@bslt/server-system/logger';

function createMockDb(): DbClient {
  return {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue({ count: 0 }),
    execute: vi.fn().mockResolvedValue(1),
    raw: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
  } as unknown as DbClient;
}

describe('soft-delete user -> PII anonymized -> audit trail intact', () => {
  let db: DbClient;
  let log: ServerLogger;

  beforeEach(() => {
    db = createMockDb();
    log = createMockLogger();
  });

  it('PII anonymization cron anonymizes expired soft-deleted users and excludes already-anonymized rows', async () => {
    const userId = 'user-soft-deleted-1';

    vi.mocked(db.raw).mockResolvedValueOnce([{ id: userId }]);
    vi.mocked(db.execute).mockResolvedValueOnce(1);

    const result: AnonymizeResult = await anonymizeExpiredUsers(db, log);
    expect(result).toEqual({ anonymizedCount: 1, failedCount: 0 });
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [statement] = vi.mocked(db.execute).mock.calls[0] ?? [];
    expect(statement?.text).toContain('UPDATE identity_users SET');
    expect(statement?.text).toContain('INSERT INTO identity_profiles');
    expect(statement?.text).toContain('INSERT INTO identity_lockouts');
    expect(statement?.values).toEqual(
      expect.arrayContaining([anonymizedEmailFor(userId), 'Deleted', 'User', userId]),
    );

    vi.mocked(db.raw).mockResolvedValueOnce([]);
    const second: AnonymizeResult = await anonymizeExpiredUsers(db, log);
    const [selectSql] = vi.mocked(db.raw).mock.calls[1] ?? [];
    expect(selectSql).toContain(
      `NOT ("email" = 'deleted-' || "id"::text || '@anonymized.invalid')`,
    );
    expect(second.anonymizedCount).toBe(0);
  });

  it('audit events remain queryable by actorId after PII anonymization', async () => {
    const userId = 'user-soft-deleted-2';
    vi.mocked(db.raw).mockResolvedValueOnce([{ id: userId }]);
    vi.mocked(db.execute).mockResolvedValueOnce(1);
    await anonymizeExpiredUsers(db, log);

    const now = new Date('2026-06-01T00:00:00.000Z');
    vi.mocked(db.raw).mockResolvedValueOnce([
      {
        id: '11111111-1111-4111-8111-111111111111',
        org_id: null,
        actor_id: userId,
        subject_email: null,
        action: 'user.login',
        category: 'security',
        severity: 'info',
        resource: 'user',
        resource_id: userId,
        metadata: {},
        ip_address: null,
        user_agent: null,
        idempotency_key: null,
        created_at: now,
      },
    ]);

    const events = await listActorAuditTrailForExport(db, userId, 50);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: userId, action: 'user.login' });
  });
});

describe('create unverified user -> past threshold -> cron deletes', () => {
  let db: DbClient;
  let log: ServerLogger;

  beforeEach(() => {
    db = createMockDb();
    log = createMockLogger();
  });

  it('hard-deletes unverified users without OAuth or active sessions, and skips users with either', async () => {
    // 1. User with neither OAuth nor active sessions -> deleted
    vi.mocked(db.query).mockResolvedValueOnce([{ id: 'unverified-1' }]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    vi.mocked(db.execute).mockResolvedValueOnce(1);

    const deleted: CleanupResult = await cleanupUnverifiedUsers(db, log);
    expect(deleted.deletedCount).toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);

    // 2. User with OAuth connection -> skipped
    vi.mocked(db.query).mockResolvedValueOnce([{ id: 'oauth-user' }]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ count: 1 });
    expect((await cleanupUnverifiedUsers(db, log)).deletedCount).toBe(0);
    expect(db.execute).toHaveBeenCalledTimes(1);

    // 3. User with active session -> skipped
    vi.mocked(db.query).mockResolvedValueOnce([{ id: 'session-user' }]);
    vi.mocked(db.queryOne).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 2 });
    expect((await cleanupUnverifiedUsers(db, log)).deletedCount).toBe(0);
    expect(db.execute).toHaveBeenCalledTimes(1);

    // 4. Empty candidate list with custom expiry period -> zero deletions
    vi.mocked(db.query).mockResolvedValueOnce([]);
    expect((await cleanupUnverifiedUsers(db, log, 14)).deletedCount).toBe(0);
  });
});
