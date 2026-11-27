// main/kernel/db/src/queue/types/queue-types.test.ts
import { describe, expect, it } from 'vitest';

import { JOB_STATUSES } from '../../schema/system';

import type {
  JobDetails,
  JobListOptions,
  JobListResult,
  JobStatus,
  QueueConfig,
  QueueSnapshotMetrics,
  QueueStats,
  QueueStore,
  Task,
  TaskError,
  TaskHandler,
  TaskHandlers,
  TaskResult,
} from './queue-types';

function isValidJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

describe('queue-types contracts', () => {
  it('accepts every canonical JobStatus and rejects unknown values', () => {
    for (const status of JOB_STATUSES) {
      expect(isValidJobStatus(status)).toBe(true);
    }
    expect(isValidJobStatus('queued')).toBe(false);
    expect(isValidJobStatus('timeout')).toBe(false);
    expect(isValidJobStatus('')).toBe(false);
  });

  it('models failed TaskResult, JobDetails, and dead-letter metadata accurately', () => {
    const error: TaskError = {
      name: 'TimeoutError',
      message: 'Handler timed out after 30s',
      stack: 'TimeoutError: Handler timed out',
    };
    const task: Task<'email.send', { to: string }> = {
      id: 'job-1',
      name: 'email.send',
      queue: 'critical',
      priority: 10,
      args: { to: 'user@example.com' },
      scheduledAt: '2026-01-01T00:00:00.000Z',
      attempts: 3,
      maxAttempts: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      idempotencyKey: 'welcome:user-1',
    };
    const result: TaskResult = {
      taskId: task.id,
      success: false,
      error,
      completedAt: '2026-01-01T00:00:30.000Z',
      durationMs: 30_000,
    };
    const details: JobDetails = {
      id: task.id,
      name: task.name,
      args: task.args,
      status: 'dead_letter',
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      scheduledAt: task.scheduledAt,
      createdAt: task.createdAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      error,
      deadLetterReason: 'Exhausted retries',
    };

    expect(result.success).toBe(false);
    expect(details.status).toBe('dead_letter');
    expect(details.error?.name).toBe('TimeoutError');
    expect(details.deadLetterReason).toBe('Exhausted retries');
  });

  it('supports QueueStore, JobListResult, QueueStats, and TaskHandlers end-to-end', async () => {
    const handled: string[] = [];
    const handler: TaskHandler<{ id: string }> = async (args) => {
      handled.push(args.id);
      await Promise.resolve();
    };
    const handlers: TaskHandlers = {
      'sync.run': handler as TaskHandler,
    };
    const config: QueueConfig = {
      pollIntervalMs: 500,
      defaultMaxAttempts: 5,
      backoffBaseMs: 1000,
      maxBackoffMs: 60_000,
    };
    const listOptions: JobListOptions = {
      status: 'failed',
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    const listResult: JobListResult = {
      data: [],
      total: 0,
      page: listOptions.page,
      limit: listOptions.limit,
      hasNext: false,
      hasPrev: false,
      totalPages: 0,
    };
    const stats: QueueStats = {
      pending: 0,
      processing: 0,
      completed: 1,
      failed: 2,
      deadLetter: 1,
      total: 4,
      failureRate: 0.75,
      recentCompleted: 1,
      recentFailed: 2,
    };
    const metrics: QueueSnapshotMetrics = {
      depth: 0,
      oldestPendingAgeMs: 0,
      totalAttempts: 6,
      deadCount: 1,
    };
    const store: QueueStore = {
      enqueue: async () => Promise.resolve(),
      dequeue: async () => Promise.resolve(null),
      complete: async () => Promise.resolve(),
      fail: async () => Promise.resolve(),
      get: async () => Promise.resolve(null),
      getPendingCount: async () => Promise.resolve(0),
      getFailedCount: async () => Promise.resolve(stats.failed),
      clearCompleted: async () => Promise.resolve(0),
      listJobs: async () => Promise.resolve(listResult),
      getQueueStats: async () => Promise.resolve(stats),
      getQueueMetrics: async () => Promise.resolve(metrics),
    };

    const runHandler = handlers['sync.run'];
    expect(runHandler).toBeDefined();
    await runHandler?.({ id: 'item-1' });
    expect(handled).toEqual(['item-1']);
    expect(config.defaultMaxAttempts).toBe(5);
    expect(await store.dequeue('2026-01-01T00:00:00.000Z')).toBeNull();
    expect(await store.getFailedCount()).toBe(2);
    expect((await store.listJobs?.(listOptions))?.hasNext).toBe(false);
    expect((await store.getQueueMetrics?.('default'))?.deadCount).toBe(1);
  });
});
