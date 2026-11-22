// main/kernel/db/src/queue/postgres-store.ts
/**
 * PostgreSQL Queue Store
 *
 * Persistent queue storage using PostgreSQL.
 * Uses SELECT FOR UPDATE SKIP LOCKED for safe concurrent dequeue.
 */

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
  type JobDetailsDbRow,
} from '../repositories/system/jobs';

import type {
  JobDetails,
  JobListOptions,
  JobListResult,
  JobStatus,
  QueueSnapshotMetrics,
  QueueStats,
  QueueStore,
  Task,
  TaskError,
  TaskResult,
} from './types/queue-types';
import type { DbClient } from '@bslt/db';

// ============================================================================
// PostgreSQL Queue Store
// ============================================================================

export class PostgresQueueStore implements QueueStore {
  constructor(private readonly db: DbClient) {}

  async healthCheck(): Promise<boolean> {
    try {
      await this.db.execute({ text: 'SELECT 1', values: [] });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Enqueue a task, skipping it if its idempotency key has already been seen.
   *
   * The empty string is treated as absent, matching the memory and Redis stores
   * (`task.idempotencyKey != null && task.idempotencyKey !== ''`). Storing `''`
   * would make it a real key, and the second un-keyed-but-empty-string task
   * would then silently collide with the first.
   *
   * `ON CONFLICT` is unconditional because it does not need a condition: the
   * column is nullable and UNIQUE, and Postgres treats NULLs as distinct, so an
   * un-keyed task can never conflict with anything.
   *
   * The arguments travel as JSON text that Postgres parses (`$3::text::jsonb`).
   * Bound to a `jsonb` parameter, the driver encodes the value it is given, so
   * the text would be stored as one JSON string and a handler would be called
   * with that string instead of its arguments.
   */
  async enqueue(task: Task): Promise<void> {
    const idempotencyKey =
      task.idempotencyKey != null && task.idempotencyKey !== '' ? task.idempotencyKey : null;
    const queue = task.queue ?? 'default';
    const priority = task.priority ?? 0;

    await this.db.execute({
      text: `INSERT INTO sys_jobs (id, name, queue, priority, args, scheduled_at, attempts, max_attempts, created_at, status, idempotency_key)
        VALUES ($1, $2, $3, $4, $5::text::jsonb, $6::timestamptz, $7, $8, $9::timestamptz, 'pending', $10)
        ON CONFLICT (name, idempotency_key) DO NOTHING`,
      values: [
        task.id,
        task.name,
        queue,
        priority,
        JSON.stringify(task.args),
        task.scheduledAt,
        task.attempts,
        task.maxAttempts,
        task.createdAt,
        idempotencyKey,
      ],
    });
  }

  async dequeue(now: string, queue?: string): Promise<Task | null> {
    return dequeueNextDueJob(this.db, now, queue);
  }

  async complete(taskId: string, result: TaskResult): Promise<void> {
    await this.db.execute({
      text: `UPDATE sys_jobs
        SET status = 'completed', completed_at = $1::timestamptz, duration_ms = $2
        WHERE id = $3`,
      values: [result.completedAt, result.durationMs, taskId],
    });
  }

  async fail(taskId: string, error: TaskError, nextAttemptAt?: string): Promise<void> {
    const lastError = `${error.name}: ${error.message}`;
    if (nextAttemptAt !== undefined && nextAttemptAt !== '') {
      // Retry: reset to pending with new scheduled time
      await this.db.execute({
        text: `UPDATE sys_jobs
          SET status = 'pending', scheduled_at = $1::timestamptz, error = $2::text::jsonb, last_error = $3
          WHERE id = $4`,
        values: [nextAttemptAt, JSON.stringify(error), lastError, taskId],
      });
    } else {
      // Final failure — move to dead status with dead_at and last_error
      await this.db.execute({
        text: `UPDATE sys_jobs
          SET status = 'dead', error = $1::text::jsonb, last_error = $2, dead_at = NOW(), completed_at = NOW()
          WHERE id = $3`,
        values: [JSON.stringify(error), lastError, taskId],
      });
    }
  }

  async get(taskId: string): Promise<Task | null> {
    return findJobTaskById(this.db, taskId);
  }

  private async countByStatus(status: 'pending' | 'failed' | 'dead'): Promise<number> {
    return countJobsByStatus(this.db, status);
  }

  async getPendingCount(): Promise<number> {
    return this.countByStatus('pending');
  }

  async getFailedCount(): Promise<number> {
    return this.countByStatus('failed');
  }

  async getDeadCount(): Promise<number> {
    return this.countByStatus('dead');
  }

  async getQueueMetrics(queue?: string): Promise<QueueSnapshotMetrics> {
    return queryQueueSnapshotMetrics(this.db, queue);
  }

  async clearCompleted(before: string): Promise<number> {
    return await this.db.execute({
      text: `DELETE FROM sys_jobs
        WHERE status = 'completed' AND completed_at < $1::timestamptz`,
      values: [before],
    });
  }

  // ===========================================================================
  // Monitoring Methods
  // ===========================================================================

  async listJobs(options: JobListOptions): Promise<JobListResult> {
    const { status, name, page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = options;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      conditions.push(`status = $${String(paramIndex)}`);
      values.push(status);
      paramIndex++;
    }

    if (name !== undefined && name !== '') {
      conditions.push(`name ILIKE $${String(paramIndex)}`);
      values.push(`%${name}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Map sortBy to column names
    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      scheduledAt: 'scheduled_at',
      completedAt: 'completed_at',
    };
    const sortColumn = columnMap[sortBy] ?? 'created_at';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const total = await countJobsMatching(this.db, whereClause, values);
    const rows = await listJobDetailsMatching(
      this.db,
      whereClause,
      sortColumn,
      order,
      values,
      limit,
      offset,
    );

    const data: JobDetails[] = rows.map((row) => this.mapRowToJobDetails(row));

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      totalPages,
    };
  }

  async getJobDetails(taskId: string): Promise<JobDetails | null> {
    const row = await findJobDetailsById(this.db, taskId);
    if (row === null) return null;
    return this.mapRowToJobDetails(row);
  }

  async getQueueStats(): Promise<QueueStats> {
    const statusRows = await countJobsGroupedByStatus(this.db);

    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    let deadLetter = 0;
    let cancelled = 0;

    for (const row of statusRows) {
      const count = row.count;
      switch (row.status) {
        case 'pending':
          pending = count;
          break;
        case 'processing':
          processing = count;
          break;
        case 'completed':
          completed = count;
          break;
        case 'failed':
          failed = count;
          break;
        case 'dead':
        case 'dead_letter':
          deadLetter += count;
          break;
        case 'cancelled':
          cancelled = count;
          break;
      }
    }

    const { recentCompleted, recentFailed } = await countRecentJobOutcomes(this.db);

    const total = pending + processing + completed + failed + deadLetter + cancelled;
    const completedTotal = completed + failed;
    const failureRate = completedTotal > 0 ? (failed / completedTotal) * 100 : 0;

    return {
      pending,
      processing,
      completed,
      failed,
      deadLetter,
      total,
      failureRate: Math.round(failureRate * 100) / 100,
      recentCompleted,
      recentFailed,
    };
  }

  async retryJob(taskId: string): Promise<boolean> {
    // Retry failed or dead jobs
    const result = await this.db.execute({
      text: `UPDATE sys_jobs
        SET status = 'pending', attempts = 0, error = NULL, last_error = NULL, dead_at = NULL, completed_at = NULL, scheduled_at = NOW()
        WHERE id = $1 AND status IN ('failed', 'dead', 'dead_letter')`,
      values: [taskId],
    });
    return result > 0;
  }

  async cancelJob(taskId: string): Promise<boolean> {
    // Cancel pending/processing jobs or discard dead jobs
    const result = await this.db.execute({
      text: `UPDATE sys_jobs
        SET status = 'cancelled', completed_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'processing', 'dead', 'dead_letter')`,
      values: [taskId],
    });
    return result > 0;
  }

  async moveToDeadLetter(taskId: string, reason: string): Promise<boolean> {
    const result = await this.db.execute({
      text: `UPDATE sys_jobs
        SET status = 'dead_letter', dead_letter_reason = $2, completed_at = NOW()
        WHERE id = $1 AND status = 'failed'`,
      values: [taskId, reason],
    });
    return result > 0;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private mapRowToJobDetails(row: JobDetailsDbRow): JobDetails {
    let parsedError: TaskError | null = null;
    if (row.error !== null && row.error !== '') {
      try {
        parsedError = JSON.parse(row.error) as TaskError;
      } catch {
        parsedError = { name: 'UnknownError', message: row.error };
      }
    }

    return {
      id: row.id,
      name: row.name,
      args: row.args,
      status: row.status as JobStatus,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      scheduledAt: row.scheduled_at,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      error: parsedError,
      deadLetterReason: row.dead_letter_reason ?? null,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createPostgresQueueStore(db: DbClient): PostgresQueueStore {
  return new PostgresQueueStore(db);
}
