// main/kernel/db/src/repositories/system/realtime.test.ts
import { describe, expect, it, vi } from 'vitest';

import { selectOwnedRealtimeRows, updateOwnedRealtimeRow } from './realtime';

import type { DbClient } from '../../client';

describe('realtime repository helpers', () => {
  it('returns false when optimistic lock or owner predicate matches zero rows', async () => {
    const db = {
      query: vi.fn().mockResolvedValue([]),
    } as unknown as DbClient;

    const updated = await updateOwnedRealtimeRow(db, {
      tableName: 'tasks',
      ownerColumn: 'owner_user_id',
      userId: 'u-1',
      id: 'row-1',
      expectedVersion: 2,
      nextVersion: 3,
      writable: { title: 'Updated' },
      updatedAt: new Date('2026-11-21T00:00:00Z'),
    });
    expect(updated).toBe(false);
  });

  it('propagates DB rejections on select and update', async () => {
    const db = {
      query: vi.fn().mockRejectedValue(new Error('rls violation')),
    } as unknown as DbClient;

    await expect(
      selectOwnedRealtimeRows(db, {
        tableName: 'tasks',
        readableColumns: ['id', 'version'],
        ownerColumn: 'owner_user_id',
        userId: 'u-1',
        ids: ['row-1'],
      }),
    ).rejects.toThrow('rls violation');
  });

  it('returns true when exactly one owned row is updated and selects matching rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'row-1', version: 1 }])
      .mockResolvedValueOnce([{ id: 'row-1' }]);
    const db = { query } as unknown as DbClient;

    const rows = await selectOwnedRealtimeRows(db, {
      tableName: 'tasks',
      readableColumns: ['id', 'version'],
      ownerColumn: 'owner_user_id',
      userId: 'u-1',
      ids: ['row-1'],
    });
    expect(rows).toEqual([{ id: 'row-1', version: 1 }]);

    const updated = await updateOwnedRealtimeRow(db, {
      tableName: 'tasks',
      ownerColumn: 'owner_user_id',
      userId: 'u-1',
      id: 'row-1',
      expectedVersion: 1,
      nextVersion: 2,
      writable: { title: 'Next' },
      updatedAt: new Date('2026-11-21T00:00:00Z'),
    });
    expect(updated).toBe(true);
  });
});
