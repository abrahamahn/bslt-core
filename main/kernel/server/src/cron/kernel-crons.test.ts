// main/kernel/server/src/cron/kernel-crons.test.ts
import { createMemoryQueueStore } from '@bslt/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMetricsCollector, resetMetricsCollector } from '../observability/metrics';

import { createKernelCrons, KERNEL_CRON_JOB_NAMES } from './kernel-crons';

import type { CronHandler, CronRegisterOptions } from './types';
import type { DbClient } from '@bslt/db';

interface RegisteredCron {
  readonly expression: string;
  readonly handler: CronHandler;
  readonly options: CronRegisterOptions | undefined;
}

describe('createKernelCrons', () => {
  afterEach(() => {
    resetMetricsCollector();
    vi.restoreAllMocks();
  });

  it('registers all three kernel schedules and ONLY enqueues jobs on cron ticks (never runs work inline)', async () => {
    const execute = vi.fn().mockResolvedValue(0);
    const db = { execute } as unknown as DbClient;
    const queueStore = createMemoryQueueStore();
    const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

    const registered = new Map<string, RegisteredCron>();
    const scheduler = {
      register: (
        name: string,
        expression: string,
        handler: CronHandler,
        options?: CronRegisterOptions,
      ) => {
        registered.set(name, { expression, handler, options });
      },
      start: vi.fn(),
      stop: vi.fn(),
      runDueOnce: vi.fn(),
    };

    const kernelCrons = createKernelCrons({ db, queueStore, clock });
    kernelCrons.registerSchedules(scheduler);

    expect([...registered.keys()].sort()).toEqual([
      KERNEL_CRON_JOB_NAMES.jobsDeadMetrics,
      KERNEL_CRON_JOB_NAMES.jobsRetention,
      KERNEL_CRON_JOB_NAMES.outboxRetention,
    ]);

    // Triggering the outbox retention cron tick ONLY enqueues into queueStore; db.execute is NOT called inline!
    await registered.get(KERNEL_CRON_JOB_NAMES.outboxRetention)!.handler({
      cron: KERNEL_CRON_JOB_NAMES.outboxRetention,
      scheduledFor: '2026-11-14T02:00:00.000Z',
    });
    expect(execute).not.toHaveBeenCalled();

    // Duplicate cron tick for the same occurrence deduplicates via idempotencyKey
    await registered.get(KERNEL_CRON_JOB_NAMES.outboxRetention)!.handler({
      cron: KERNEL_CRON_JOB_NAMES.outboxRetention,
      scheduledFor: '2026-11-14T02:00:00.000Z',
    });
    expect(await queueStore.getPendingCount()).toBe(1);
  });

  it('executes outbox 7-day retention, jobs 7-day retention, and dead-job metrics via queued job handlers', async () => {
    const execute = vi.fn().mockResolvedValue(3);
    const db = { execute } as unknown as DbClient;
    const queueStore = createMemoryQueueStore();
    const now = new Date('2026-11-14T12:00:00.000Z');
    const clock = { now: () => now };

    // Seed an old completed job (13 days ago) and a dead job
    await queueStore.enqueue({
      id: 'done-old',
      name: 'test.old',
      args: {},
      scheduledAt: '2026-11-01T00:00:00.000Z',
      attempts: 1,
      maxAttempts: 3,
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    await queueStore.dequeue(now.toISOString());
    await queueStore.complete('done-old', {
      taskId: 'done-old',
      success: true,
      completedAt: '2026-11-01T00:01:00.000Z',
      durationMs: 10,
    });
    await queueStore.enqueue({
      id: 'dead-1',
      name: 'test.dead',
      args: {},
      scheduledAt: '2026-11-14T00:00:00.000Z',
      attempts: 0,
      maxAttempts: 1,
      createdAt: '2026-11-14T00:00:00.000Z',
    });
    await queueStore.dequeue(now.toISOString());
    await queueStore.fail('dead-1', { name: 'Error', message: 'boom' });

    const clearSpy = vi.spyOn(queueStore, 'clearCompleted');
    const kernelCrons = createKernelCrons({ db, queueStore, clock });

    await kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.outboxRetention]!({});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]?.values).toEqual(['2026-11-07T12:00:00.000Z']);

    await kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.jobsRetention]!({});
    expect(clearSpy).toHaveBeenCalledWith('2026-11-07T12:00:00.000Z');
    expect(await queueStore.get('done-old')).toBeNull();

    await kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.jobsDeadMetrics]!({});
    expect(getMetricsCollector().getMetricsSummary().jobs.dead).toBe(1);
  });

  it('propagates DB and store failures from job handlers so QueueServer retries or dead-letters them', async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('outbox prune failed')),
    } as unknown as DbClient;
    const queueStore = createMemoryQueueStore();
    vi.spyOn(queueStore, 'clearCompleted').mockRejectedValue(new Error('jobs clear failed'));
    vi.spyOn(queueStore, 'getQueueMetrics').mockRejectedValue(new Error('stats failed'));

    const kernelCrons = createKernelCrons({
      db,
      queueStore,
      clock: { now: () => new Date('2026-11-14T12:00:00.000Z') },
    });

    await expect(kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.outboxRetention]!({})).rejects.toThrow(
      'outbox prune failed',
    );
    await expect(kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.jobsRetention]!({})).rejects.toThrow(
      'jobs clear failed',
    );
    await expect(kernelCrons.handlers[KERNEL_CRON_JOB_NAMES.jobsDeadMetrics]!({})).rejects.toThrow(
      'stats failed',
    );
  });
});
