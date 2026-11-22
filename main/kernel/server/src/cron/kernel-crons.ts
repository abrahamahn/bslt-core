// main/kernel/server/src/cron/kernel-crons.ts
/**
 * Kernel-owned maintenance schedules (Plan §9.2):
 *   - `sys.outbox.retention`: daily 02:00 UTC — prune dispatched `sys_outbox` rows older than 7 days
 *   - `sys.jobs.retention`:   daily 02:10 UTC — prune completed `sys_jobs` rows older than 7 days
 *   - `sys.jobs.dead_metrics`: every minute   — sample `sys_jobs` dead/pending counts into Prometheus gauges
 *
 * Every schedule tick ONLY enqueues a job onto `QueueServer` (`sys_jobs`) with
 * `idempotencyKey = "${cron}:${scheduledFor}"`; actual work executes inside the
 * worker pool.
 */

import {
  pruneDispatchedOutbox,
  type DbClient,
  type QueueServerJobSpec,
  type QueueStore,
  type TaskHandlers,
} from '@bslt/db';

import { getMetricsCollector } from '../observability/metrics';

import type { CronScheduler } from './scheduler';

export const KERNEL_CRON_JOB_NAMES = {
  outboxRetention: 'sys.outbox.retention',
  jobsRetention: 'sys.jobs.retention',
  jobsDeadMetrics: 'sys.jobs.dead_metrics',
} as const;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface CreateKernelCronsOptions {
  readonly db: DbClient;
  readonly queueStore: QueueStore;
  readonly clock?: { now(): Date } | undefined;
}

interface KernelCronsBundle {
  readonly handlers: TaskHandlers;
  readonly jobSpecs: Readonly<Record<string, QueueServerJobSpec>>;
  registerSchedules(scheduler: Pick<CronScheduler, 'register'>): void;
}

export function createKernelCrons(options: CreateKernelCronsOptions): KernelCronsBundle {
  const { db, queueStore } = options;
  const now = (): Date => (options.clock !== undefined ? options.clock.now() : new Date());

  const jobSpecs: Readonly<Record<string, QueueServerJobSpec>> = {
    [KERNEL_CRON_JOB_NAMES.outboxRetention]: {
      queue: 'default',
      maxAttempts: 3,
      timeoutMs: 60_000,
    },
    [KERNEL_CRON_JOB_NAMES.jobsRetention]: {
      queue: 'default',
      maxAttempts: 3,
      timeoutMs: 60_000,
    },
    [KERNEL_CRON_JOB_NAMES.jobsDeadMetrics]: {
      queue: 'default',
      maxAttempts: 2,
      timeoutMs: 15_000,
    },
  };

  const handlers: TaskHandlers = {
    [KERNEL_CRON_JOB_NAMES.outboxRetention]: async (): Promise<void> => {
      const cutoffIso = new Date(now().getTime() - SEVEN_DAYS_MS).toISOString();
      await pruneDispatchedOutbox(db, cutoffIso);
    },
    [KERNEL_CRON_JOB_NAMES.jobsRetention]: async (): Promise<void> => {
      const cutoffIso = new Date(now().getTime() - SEVEN_DAYS_MS).toISOString();
      await queueStore.clearCompleted(cutoffIso);
    },
    [KERNEL_CRON_JOB_NAMES.jobsDeadMetrics]: async (): Promise<void> => {
      if (queueStore.getQueueMetrics !== undefined) {
        const metrics = await queueStore.getQueueMetrics();
        getMetricsCollector().recordQueueSnapshot({
          dead: metrics.deadCount,
          pending: metrics.depth,
        });
        return;
      }
      const pending = await queueStore.getPendingCount();
      const dead = queueStore.getDeadCount !== undefined ? await queueStore.getDeadCount() : 0;
      getMetricsCollector().recordQueueSnapshot({ dead, pending });
    },
  };

  function enqueueCronJob(name: string, maxAttempts: number, scheduledFor: string): Promise<void> {
    const nowIso = now().toISOString();
    return queueStore.enqueue({
      id: crypto.randomUUID(),
      name,
      queue: 'default',
      priority: 0,
      args: {},
      scheduledAt: nowIso,
      attempts: 0,
      maxAttempts,
      createdAt: nowIso,
      idempotencyKey: `${name}:${scheduledFor}`,
    });
  }

  function registerSchedules(scheduler: Pick<CronScheduler, 'register'>): void {
    scheduler.register(
      KERNEL_CRON_JOB_NAMES.outboxRetention,
      '0 2 * * *',
      async ({ cron, scheduledFor }) => {
        await enqueueCronJob(cron, 3, scheduledFor);
      },
      { catchUp: false },
    );

    scheduler.register(
      KERNEL_CRON_JOB_NAMES.jobsRetention,
      '10 2 * * *',
      async ({ cron, scheduledFor }) => {
        await enqueueCronJob(cron, 3, scheduledFor);
      },
      { catchUp: false },
    );

    scheduler.register(
      KERNEL_CRON_JOB_NAMES.jobsDeadMetrics,
      '* * * * *',
      async ({ cron, scheduledFor }) => {
        await enqueueCronJob(cron, 2, scheduledFor);
      },
      { catchUp: false },
    );
  }

  return { handlers, jobSpecs, registerSchedules };
}
