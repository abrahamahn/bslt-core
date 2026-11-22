// main/modules/audit/server/repository.test.ts
import { describe, expect, it, vi } from 'vitest';

import { auditRepository } from './repository';

import type { RawDb } from '@bslt/db';

const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const LOG_ID = '11111111-1111-4111-8111-111111111111';

describe('auditRepository', () => {
  it('inserts idempotent audit_log rows using ON CONFLICT DO NOTHING when idempotencyKey is set', async () => {
    const raw = vi.fn().mockResolvedValue([
      {
        id: LOG_ID,
        org_id: ORG_ID,
        actor_id: ACTOR_ID,
        subject_email: null,
        action: 'tasks.task.created',
        category: 'data',
        severity: 'info',
        resource: 'task',
        resource_id: 'task-1',
        metadata: { taskId: 'task-1' },
        ip_address: null,
        user_agent: null,
        idempotency_key: 'audit:ev-1',
        created_at: new Date('2026-11-17T00:00:00.000Z'),
      },
    ]);
    const repo = auditRepository({ raw } as unknown as RawDb);

    const inserted = await repo.appendLog({
      orgId: ORG_ID,
      actorId: ACTOR_ID,
      action: 'tasks.task.created',
      category: 'data',
      severity: 'info',
      resource: 'task',
      resourceId: 'task-1',
      metadata: { taskId: 'task-1' },
      idempotencyKey: 'audit:ev-1',
    });

    expect(inserted?.id).toBe(LOG_ID);
    expect(String(raw.mock.calls[0]?.[0])).toContain('ON CONFLICT (idempotency_key)');
  });

  it('returns null on duplicate idempotencyKey conflict for audit_log and audit_activity', async () => {
    const raw = vi.fn().mockResolvedValue([]);
    const repo = auditRepository({ raw } as unknown as RawDb);

    const dupLog = await repo.appendLog({
      action: 'tasks.task.created',
      category: 'data',
      severity: 'info',
      resource: 'task',
      idempotencyKey: 'audit:dup',
    });
    expect(dupLog).toBeNull();

    const dupAct = await repo.appendActivity({
      actorType: 'user',
      action: 'tasks.task.created',
      resourceType: 'task',
      resourceId: 'task-1',
      idempotencyKey: 'activity:dup',
    });
    expect(dupAct).toBeNull();
  });

  it('returns null when findSecurityLogById finds no matching security row', async () => {
    const raw = vi.fn().mockResolvedValue([]);
    const repo = auditRepository({ raw } as unknown as RawDb);

    expect(await repo.findSecurityLogById(LOG_ID)).toBeNull();
  });

  it('propagates database errors on appendLog, listLogs, and deleteActivitiesOlderThan', async () => {
    const raw = vi.fn().mockRejectedValue(new Error('db connection lost'));
    const repo = auditRepository({ raw } as unknown as RawDb);

    await expect(
      repo.appendLog({
        action: 'tasks.task.created',
        category: 'data',
        severity: 'info',
        resource: 'task',
      }),
    ).rejects.toThrow('db connection lost');

    await expect(repo.listLogs({ limit: 10 })).rejects.toThrow('db connection lost');
    await expect(repo.deleteActivitiesOlderThan(new Date())).rejects.toThrow('db connection lost');
  });
});
