// main/kernel/db/src/queue/types/queue-types.ts
/**
 * Queue Types
 *
 * Type definitions for the background job queue system.
 */

import type { JOB_STATUSES } from '../../schema/system';

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface TaskError {
  name: string;
  message: string;
  stack?: string | undefined;
}

export interface JobDetails {
  id: string;
  name: string;
  args: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: TaskError | null;
  deadLetterReason?: string | null;
}

export interface JobListOptions {
  status?: JobStatus | undefined;
  name?: string | undefined;
  page: number;
  limit: number;
  sortBy?: 'createdAt' | 'scheduledAt' | 'completedAt' | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface JobListResult {
  data: JobDetails[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalPages: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  total: number;
  failureRate: number;
  recentCompleted: number;
  recentFailed: number;
}

// ============================================================================
// Task Types
// ============================================================================

/**
 * Base task definition
 */
export interface Task<TName extends string = string, TArgs = unknown> {
  /** Unique task ID */
  id: string;
  /** Task name (maps to handler) */
  name: TName;
  /** Named queue lane (default: 'default') */
  queue?: string;
  /** Execution priority (higher runs first; default: 0) */
  priority?: number;
  /** Task arguments */
  args: TArgs;
  /** When to run (ISO string) */
  scheduledAt: string;
  /** Number of attempts so far */
  attempts: number;
  /** Max retry attempts */
  maxAttempts: number;
  /** Created timestamp */
  createdAt: string;
  /** Optional idempotency key — if set, duplicate enqueues with the same (name, key) are silently skipped */
  idempotencyKey?: string;
}

/**
 * Task result after completion
 */
export interface TaskResult {
  /** Task ID */
  taskId: string;
  /** Success status */
  success: boolean;
  /** Error details if failed */
  error?: TaskError;
  /** Completion timestamp */
  completedAt: string;
  /** Duration in ms */
  durationMs: number;
}

// TaskError is aliased from shared's JobError (see imports above)

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Task handler function signature
 */
export type TaskHandler<TArgs = unknown> = (args: TArgs) => Promise<void>;

/**
 * Registry of task handlers
 */
export type TaskHandlers = Record<string, TaskHandler>;

// ============================================================================
// Queue Configuration
// ============================================================================

export interface QueueConfig {
  /** Polling interval in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Default max attempts for tasks (default: 3) */
  defaultMaxAttempts?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  backoffBaseMs?: number;
  /** Max backoff delay in ms (default: 300000 = 5 min) */
  maxBackoffMs?: number;
}

export interface QueueSnapshotMetrics {
  readonly depth: number;
  readonly oldestPendingAgeMs: number;
  readonly totalAttempts: number;
  readonly deadCount: number;
}

// ============================================================================
// Queue Store Interface
// ============================================================================

/**
 * Storage interface for the queue
 * Can be implemented with Postgres or in-memory
 */
export interface QueueStore {
  /** Enqueue a new task */
  enqueue(task: Task): Promise<void>;

  /** Dequeue the next ready task (returns null if none) */
  dequeue(now: string, queue?: string): Promise<Task | null>;

  /** Mark task as completed */
  complete(taskId: string, result: TaskResult): Promise<void>;

  /** Mark task as failed (will retry if attempts < maxAttempts) */
  fail(taskId: string, error: TaskError, nextAttemptAt?: string): Promise<void>;

  /** Get task by ID */
  get(taskId: string): Promise<Task | null>;

  /** Get pending task count */
  getPendingCount(): Promise<number>;

  /** Get failed task count */
  getFailedCount(): Promise<number>;

  /** Get dead-lettered ('dead') task count */
  getDeadCount?(): Promise<number>;

  /** Get operational metrics snapshot (depth, oldest pending age, attempts, dead count) */
  getQueueMetrics?(queue?: string): Promise<QueueSnapshotMetrics>;

  /** Clear all completed tasks older than given date */
  clearCompleted(before: string): Promise<number>;

  /** List jobs with filtering and pagination (for monitoring) */
  listJobs?(options: JobListOptions): Promise<JobListResult>;

  /** Get detailed job information by ID */
  getJobDetails?(taskId: string): Promise<JobDetails | null>;

  /** Get queue statistics */
  getQueueStats?(): Promise<QueueStats>;

  /** Retry a failed job */
  retryJob?(taskId: string): Promise<boolean>;

  /** Cancel a pending or processing job */
  cancelJob?(taskId: string): Promise<boolean>;

  /** Move job to dead letter queue */
  moveToDeadLetter?(taskId: string, reason: string): Promise<boolean>;
}
