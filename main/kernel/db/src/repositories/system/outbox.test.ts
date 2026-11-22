// main/kernel/db/src/repositories/system/outbox.test.ts
import { describe, expect, it } from 'vitest';

import {
  claimUndispatchedOutboxRows,
  insertOutboxEvent,
  markOutboxDispatched,
  pruneDispatchedOutbox,
} from './outbox';

import type { DbClient } from '../../client';

describe('sys_outbox repository', () => {
  it('rejects non-positive or non-integer batch sizes in claimUndispatchedOutboxRows', async () => {
    const fakeDb = {
      raw: () => Promise.resolve([]),
    } as unknown as DbClient;

    await expect(claimUndispatchedOutboxRows(fakeDb, 0)).rejects.toThrow(/batchSize/i);
    await expect(claimUndispatchedOutboxRows(fakeDb, -5)).rejects.toThrow(/batchSize/i);
    await expect(claimUndispatchedOutboxRows(fakeDb, 1.5)).rejects.toThrow(/batchSize/i);
  });

  it('skips SQL execution when markOutboxDispatched receives an empty id list', async () => {
    let executed = false;
    const fakeDb = {
      execute: () => {
        executed = true;
        return Promise.resolve(0);
      },
    } as unknown as DbClient;

    await markOutboxDispatched(fakeDb, [], '2026-11-14T00:00:00.000Z');
    expect(executed).toBe(false);
  });

  it('propagates DB errors from insertOutboxEvent and pruneDispatchedOutbox', async () => {
    const failingDb = {
      execute: () => Promise.reject(new Error('rls violation')),
    } as unknown as DbClient;

    await expect(
      insertOutboxEvent(failingDb, {
        name: 'orgs.member.added',
        version: 1,
        payloadJson: '{"orgId":"o-1"}',
        sealed: null,
        actorUserId: null,
        orgId: null,
        occurredAt: '2026-11-14T00:00:00.000Z',
      }),
    ).rejects.toThrow('rls violation');

    await expect(pruneDispatchedOutbox(failingDb, '2026-11-01T00:00:00.000Z')).rejects.toThrow(
      'rls violation',
    );
  });

  it('executes parameterized SQL for insert, SKIP LOCKED claim, mark dispatched, and prune', async () => {
    const executed: Array<{ text: string; values?: readonly unknown[] }> = [];
    const fakeDb = {
      raw: (text: string, values?: readonly unknown[]) => {
        executed.push({ text, ...(values !== undefined ? { values } : {}) });
        return Promise.resolve([
          {
            id: '42',
            name: 'orgs.member.added',
            version: 1,
            payload: { orgId: 'o-1' },
            sealed_b64: null,
            actor_user_id: 'u-1',
            org_id: 'o-1',
            occurred_at: '2026-11-14T00:00:00.000Z',
          },
        ]);
      },
      execute: (q: { text: string; values?: readonly unknown[] }) => {
        executed.push(q);
        return Promise.resolve(1);
      },
    } as unknown as DbClient;

    await insertOutboxEvent(fakeDb, {
      name: 'orgs.member.added',
      version: 1,
      payloadJson: '{"orgId":"o-1"}',
      sealed: null,
      actorUserId: 'u-1',
      orgId: 'o-1',
      occurredAt: '2026-11-14T00:00:00.000Z',
    });
    expect(executed[0]?.text).toContain('$3::text::jsonb');

    const claimed = await claimUndispatchedOutboxRows(fakeDb, 50);
    expect(claimed).toHaveLength(1);
    expect(executed[1]?.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(executed[1]?.values).toEqual([50]);

    await markOutboxDispatched(fakeDb, ['42'], '2026-11-14T00:01:00.000Z');
    expect(executed[2]?.text).toContain('UPDATE sys_outbox');

    const pruned = await pruneDispatchedOutbox(fakeDb, '2026-11-07T00:00:00.000Z');
    expect(pruned).toBe(1);
    expect(executed[3]?.text).toContain('DELETE FROM sys_outbox');
  });
});
