// main/kernel/db/src/repositories/system/jobs.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  countJobsByStatus,
  countJobsGroupedByStatus,
  countJobsMatching,
  countRecentJobOutcomes,
  dequeueNextDueJob,
  findJobDetailsById,
  findJobTaskById,
  listJobDetailsMatching,
  queryQueueSnapshotMetrics,
} from './jobs';

import type { DbClient } from '../../client';

describe('sys_jobs repository', () => {
  it('returns null when dequeueNextDueJob, findJobTaskById, or findJobDetailsById finds no row', async () => {
    const db = {
      query: vi.fn().mockResolvedValue([]),
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as DbClient;

    expect(await dequeueNextDueJob(db, '2026-11-21T00:00:00Z')).toBeNull();
    expect(await findJobTaskById(db, 'missing')).toBeNull();
    expect(await findJobDetailsById(db, 'missing')).toBeNull();
  });

  it('returns zero defaults when count and metrics queries yield empty rows', async () => {
    const db = {
      raw: vi.fn().mockResolvedValue([]),
    } as unknown as DbClient;

    expect(await countJobsByStatus(db, 'pending')).toBe(0);
    expect(await countJobsMatching(db, '', [])).toBe(0);
    expect(await queryQueueSnapshotMetrics(db)).toEqual({
      depth: 0,
      oldestPendingAgeMs: 0,
      totalAttempts: 0,
      deadCount: 0,
    });
    expect(await countRecentJobOutcomes(db)).toEqual({
      recentCompleted: 0,
      recentFailed: 0,
    });
  });

  it('propagates DB rejections across dequeue, metrics, and listing queries', async () => {
    const db = {
      query: vi.fn().mockRejectedValue(new Error('dequeue failure')),
      raw: vi.fn().mockRejectedValue(new Error('raw failure')),
    } as unknown as DbClient;

    await expect(dequeueNextDueJob(db, '2026-11-21T00:00:00Z', 'media')).rejects.toThrow(
      'dequeue failure',
    );
    await expect(countJobsGroupedByStatus(db)).rejects.toThrow('raw failure');
    await expect(
      listJobDetailsMatching(db, 'WHERE status = $1', 'created_at', 'DESC', ['pending'], 20, 0),
    ).rejects.toThrow('raw failure');
  });

  it('clamps negative oldestPendingAgeMs and binds queue filter when provided', async () => {
    const raw = vi.fn().mockResolvedValue([
      {
        depth: 2,
        oldest_pending_age_ms: -50,
        total_attempts: 4,
        dead_count: 1,
      },
    ]);
    const db = { raw } as unknown as DbClient;

    const metrics = await queryQueueSnapshotMetrics(db, 'media');
    expect(metrics).toEqual({
      depth: 2,
      oldestPendingAgeMs: 0,
      totalAttempts: 4,
      deadCount: 1,
    });
    expect(raw).toHaveBeenCalledWith(expect.stringContaining('WHERE queue = $1'), ['media']);
  });
});
