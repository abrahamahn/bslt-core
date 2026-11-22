// main/kernel/db/src/queue/client.ts
/**
 * Queue Server
 *
 * Background job processor with polling, retries, and exponential backoff.
 *
 * Features:
 * - Polling-based job processing
 * - Configurable retry with exponential backoff
 * - Graceful shutdown
 * - Injectable metrics for observability
 * - Error serialization for debugging
 */

import type {
  QueueConfig,
  QueueSnapshotMetrics,
  QueueStore,
  Task,
  TaskError,
  TaskHandler,
  TaskHandlers,
} from './types';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Minimal logger interface for queue server.
 * Compatible with any structured logger (Fastify, Pino, etc.)
 */
interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string | Error, data?: Record<string, unknown>): void;
}

/**
 * Minimal metrics interface for queue job tracking.
 * Pass a no-op implementation (default) or a real collector.
 */
export interface QueueMetrics {
  recordJobEnqueued(name: string): void;
  recordJobStarted(name: string): void;
  recordJobCompleted(name: string): void;
  recordJobFailed(name: string): void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<QueueConfig> = {
  pollIntervalMs: 1000,
  defaultMaxAttempts: 3,
  backoffBaseMs: 1000,
  maxBackoffMs: 300_000, // 5 minutes
};

const NOOP_METRICS: QueueMetrics = {
  recordJobEnqueued: () => undefined,
  recordJobStarted: () => undefined,
  recordJobCompleted: () => undefined,
  recordJobFailed: () => undefined,
};

// ============================================================================
// Queue Server
// ============================================================================

export interface QueueServerJobSpec {
  readonly queue?: string | undefined;
  readonly maxAttempts?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export function queuesForRole(
  role: 'all' | 'worker' | 'media-worker',
): Readonly<Record<string, { readonly concurrency: number }>> {
  switch (role) {
    case 'worker':
      return { default: { concurrency: 4 } };
    case 'media-worker':
      return { media: { concurrency: 2 } };
    case 'all':
      return { default: { concurrency: 4 }, media: { concurrency: 2 } };
  }
}

export interface QueueServerOptions {
  store: QueueStore;
  handlers: TaskHandlers;
  config?: QueueConfig;
  log?: Logger;
  /** Optional metrics collector. Defaults to no-op. */
  metrics?: QueueMetrics;
  /** Per-queue concurrency map. When omitted, polls across all queues with concurrency 1. */
  queues?: Readonly<Record<string, { readonly concurrency: number }>>;
  /** Optional per-job runtime specs (queue, maxAttempts, timeoutMs). */
  jobSpecs?: Readonly<Record<string, QueueServerJobSpec>>;
}

export class QueueServer {
  private readonly store: QueueStore;
  private readonly handlers: TaskHandlers;
  private readonly config: Required<QueueConfig>;
  private readonly log?: Logger;
  private readonly metrics: QueueMetrics;
  private readonly queues?: Readonly<Record<string, { readonly concurrency: number }>>;
  private readonly jobSpecs: Readonly<Record<string, QueueServerJobSpec>>;
  private running = false;
  private workerPromises: Promise<void>[] = [];
  private readonly sleepAbortControllers = new Set<AbortController>();

  constructor(options: QueueServerOptions) {
    this.store = options.store;
    this.handlers = options.handlers;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.jobSpecs = options.jobSpecs ?? {};
    if (options.queues !== undefined) {
      this.queues = options.queues;
    }
    if (options.log !== undefined) {
      this.log = options.log;
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Start processing jobs
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.workerPromises = [];

    this.log?.info('Queue server started');

    if (this.queues === undefined) {
      this.workerPromises.push(this.pollLoop(undefined));
      return;
    }

    for (const [queueName, queueSpec] of Object.entries(this.queues)) {
      const concurrency = Math.max(0, queueSpec.concurrency);
      for (let i = 0; i < concurrency; i++) {
        this.workerPromises.push(this.pollLoop(queueName));
      }
    }
  }

  /**
   * Stop processing jobs (gracefully waits for current in-flight jobs)
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.log?.info('Queue server stopping...');

    // Abort all pending sleeps across worker loops
    for (const controller of this.sleepAbortControllers) {
      controller.abort();
    }
    this.sleepAbortControllers.clear();

    if (this.workerPromises.length > 0) {
      await Promise.all(this.workerPromises);
      this.workerPromises = [];
    }

    this.log?.info('Queue server stopped');
  }

  /**
   * Enqueue a new task
   */
  async enqueue(
    name: string,
    args: Task['args'],
    options?: {
      scheduledAt?: Date;
      maxAttempts?: number;
      idempotencyKey?: string;
      queue?: string;
      priority?: number;
    },
  ): Promise<string> {
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const spec = this.jobSpecs[name];
    const resolvedQueue = options?.queue ?? spec?.queue;
    const resolvedMaxAttempts =
      options?.maxAttempts ?? spec?.maxAttempts ?? this.config.defaultMaxAttempts;

    const task: Task = {
      id: taskId,
      name,
      args,
      scheduledAt: options?.scheduledAt?.toISOString() ?? now,
      attempts: 0,
      maxAttempts: resolvedMaxAttempts,
      createdAt: now,
      ...(resolvedQueue !== undefined ? { queue: resolvedQueue } : {}),
      ...(options?.priority !== undefined ? { priority: options.priority } : {}),
      ...(options?.idempotencyKey != null ? { idempotencyKey: options.idempotencyKey } : {}),
    };

    await this.store.enqueue(task);
    this.metrics.recordJobEnqueued(name);
    this.log?.debug(`Task enqueued: ${name}`, { taskId });

    return taskId;
  }

  /**
   * Get queue stats
   */
  async getStats(): Promise<{ pending: number; failed: number; dead: number }> {
    const [pending, failed, dead] = await Promise.all([
      this.store.getPendingCount(),
      this.store.getFailedCount(),
      this.store.getDeadCount !== undefined ? this.store.getDeadCount() : Promise.resolve(0),
    ]);
    return { pending, failed, dead };
  }

  /**
   * Get operational metrics snapshot
   */
  async getMetrics(queue?: string): Promise<QueueSnapshotMetrics> {
    if (this.store.getQueueMetrics !== undefined) {
      return this.store.getQueueMetrics(queue);
    }
    const stats = await this.getStats();
    return {
      depth: stats.pending,
      oldestPendingAgeMs: 0,
      totalAttempts: 0,
      deadCount: stats.dead,
    };
  }

  /**
   * Prune completed tasks older than retentionMs
   */
  async pruneCompleted(retentionMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    return this.store.clearCompleted(cutoff);
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private async pollLoop(queueName: string | undefined): Promise<void> {
    while (this.running) {
      try {
        const now = new Date().toISOString();
        const task =
          queueName === undefined
            ? await this.store.dequeue(now)
            : await this.store.dequeue(now, queueName);

        if (task !== null) {
          await this.processTask(task);
        } else {
          // No tasks available, wait before polling again
          await this.sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        this.log?.error('Queue poll error', { error: serializeError(error) });
        await this.sleep(this.config.pollIntervalMs);
      }
    }
  }

  private async runWithTimeout(
    fn: () => Promise<void>,
    taskName: string,
    timeoutMs: number | undefined,
  ): Promise<void> {
    if (timeoutMs === undefined || timeoutMs <= 0) {
      await fn();
      return;
    }
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timerId = setTimeout(() => {
        const err = new Error(`Job "${taskName}" timed out after ${String(timeoutMs)}ms`);
        err.name = 'JobTimeoutError';
        reject(err);
      }, timeoutMs);
    });
    try {
      await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }
  }

  private async processTask(task: Task): Promise<void> {
    const handler = this.handlers[task.name] as TaskHandler | undefined;
    const startTime = Date.now();

    if (handler === undefined) {
      this.log?.error(`No handler for task: ${task.name}`, { taskId: task.id });
      await this.store.fail(task.id, {
        name: 'UnknownTaskError',
        message: `No handler registered for task: ${task.name}`,
      });
      this.metrics.recordJobFailed(task.name);
      return;
    }

    const timeoutMs = this.jobSpecs[task.name]?.timeoutMs;

    try {
      this.log?.debug(`Processing task: ${task.name}`, { taskId: task.id, attempt: task.attempts });
      this.metrics.recordJobStarted(task.name);

      await this.runWithTimeout(() => handler(task.args), task.name, timeoutMs);

      const durationMs = Date.now() - startTime;
      await this.store.complete(task.id, {
        taskId: task.id,
        success: true,
        completedAt: new Date().toISOString(),
        durationMs,
      });

      this.metrics.recordJobCompleted(task.name);
      this.log?.debug(`Task completed: ${task.name}`, { taskId: task.id, durationMs });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const taskError = serializeError(error);

      this.log?.warn(`Task failed: ${task.name}`, {
        taskId: task.id,
        attempt: task.attempts,
        error: taskError,
        durationMs,
      });

      if (task.attempts < task.maxAttempts) {
        // Schedule retry with exponential backoff
        const delay = this.calculateBackoff(task.attempts);
        const nextAttemptAt = new Date(Date.now() + delay).toISOString();

        this.log?.debug(`Task scheduled for retry: ${task.name}`, {
          taskId: task.id,
          nextAttempt: task.attempts + 1,
          delayMs: delay,
        });

        await this.store.fail(task.id, taskError, nextAttemptAt);
      } else {
        // Max attempts reached, permanent failure
        this.log?.error(`Task permanently failed: ${task.name}`, {
          taskId: task.id,
          attempts: task.attempts,
          error: taskError,
        });

        await this.store.fail(task.id, taskError);
        this.metrics.recordJobFailed(task.name);
      }
    }
  }

  private calculateBackoff(attempt: number): number {
    // Exponential backoff: base * 2^(attempt-1) with jitter
    const exponentialDelay = this.config.backoffBaseMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, this.config.maxBackoffMs);
  }

  private sleep(ms: number): Promise<void> {
    const controller = new AbortController();
    this.sleepAbortControllers.add(controller);
    const signal = controller.signal;

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.sleepAbortControllers.delete(controller);
        resolve();
      }, ms);

      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId);
          this.sleepAbortControllers.delete(controller);
          resolve();
        },
        { once: true },
      );
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Serialize an error for storage
 */
function serializeError(error: unknown): TaskError {
  if (error instanceof Error) {
    const taskError: TaskError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) {
      taskError.stack = error.stack;
    }
    return taskError;
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}

// ============================================================================
// Factory
// ============================================================================

export function createQueueServer(options: QueueServerOptions): QueueServer {
  return new QueueServer(options);
}
