// main/kernel/db/src/repositories/system/jobs.ts
/**
 * Background Job Queue Repository (`sys_jobs`, Plan §8.4).
 */
import { and, eq, eqSubquery, lte, select, update } from '../../builder';

import type { DbClient } from '../../client';
import type { QueueSnapshotMetrics, Task } from '../../queue/types/queue-types';

const JOBS_TABLE = 'sys_jobs';

type TaskRow = Record<string, unknown> & {
  id: string;
  name: string;
  queue?: string;
  priority?: number;
  args: unknown;
  scheduled_at: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
};

export type JobDetailsDbRow = TaskRow & {
  status: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  last_error?: string | null;
  dead_at?: string | null;
  dead_letter_reason?: string | null;
};

type CountRow = Record<string, unknown> & {
  count: number;
};

export async function dequeueNextDueJob(
  db: DbClient,
  now: string,
  queue?: string,
): Promise<Task | null> {
  const whereCondition =
    queue !== undefined
      ? and(eq('queue', queue), eq('status', 'pending'), lte('scheduled_at', now))
      : and(eq('status', 'pending'), lte('scheduled_at', now));

  const nextDue = select(JOBS_TABLE)
    .columns('id')
    .where(whereCondition)
    .orderBy('priority', 'desc')
    .orderBy('scheduled_at', 'asc')
    .limit(1)
    .forUpdate()
    .skipLocked();

  const rows = await db.query<TaskRow>(
    update(JOBS_TABLE)
      .set({ status: 'processing' })
      .increment('attempts')
      .where(eqSubquery('id', nextDue))
      .returning(
        'id',
        'name',
        'queue',
        'priority',
        'args',
        'scheduled_at',
        'attempts',
        'max_attempts',
        'created_at',
      )
      .toSql(),
  );

  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    name: row.name,
    ...(row.queue !== undefined ? { queue: row.queue } : {}),
    ...(row.priority !== undefined ? { priority: row.priority } : {}),
    args: row.args,
    scheduledAt: row.scheduled_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
  };
}

export async function findJobTaskById(db: DbClient, taskId: string): Promise<Task | null> {
  const rows = await db.raw<TaskRow>(
    `SELECT id, name, args, scheduled_at, attempts, max_attempts, created_at
      FROM sys_jobs
      WHERE id = $1`,
    [taskId],
  );
  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    name: row.name,
    args: row.args,
    scheduledAt: row.scheduled_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
  };
}

export async function countJobsByStatus(
  db: DbClient,
  status: 'pending' | 'failed' | 'dead',
): Promise<number> {
  const rows = await db.raw<CountRow>(
    `SELECT COUNT(*)::int as count FROM sys_jobs WHERE status = '${status}'`,
  );
  return rows[0]?.count ?? 0;
}

export async function queryQueueSnapshotMetrics(
  db: DbClient,
  queue?: string,
): Promise<QueueSnapshotMetrics> {
  const whereQueue = queue !== undefined ? 'WHERE queue = $1' : '';
  const values = queue !== undefined ? [queue] : [];
  const rows = await db.raw<{
    depth: number;
    oldest_pending_age_ms: number;
    total_attempts: number;
    dead_count: number;
  }>(
    `SELECT
      (COUNT(*) FILTER (WHERE status = 'pending'))::int AS depth,
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - MIN(scheduled_at) FILTER (WHERE status = 'pending'))) * 1000,
        0
      )::int AS oldest_pending_age_ms,
      COALESCE(SUM(attempts), 0)::int AS total_attempts,
      (COUNT(*) FILTER (WHERE status = 'dead'))::int AS dead_count
    FROM sys_jobs
    ${whereQueue}`,
    values,
  );
  const row = rows[0];
  return {
    depth: row?.depth ?? 0,
    oldestPendingAgeMs: Math.max(0, row?.oldest_pending_age_ms ?? 0),
    totalAttempts: row?.total_attempts ?? 0,
    deadCount: row?.dead_count ?? 0,
  };
}

export async function countJobsMatching(
  db: DbClient,
  whereClause: string,
  values: unknown[],
): Promise<number> {
  const countQuery = `SELECT COUNT(*)::int as count FROM sys_jobs ${whereClause}`;
  const countRows = await db.raw<CountRow>(countQuery, values);
  return countRows[0]?.count ?? 0;
}

export async function listJobDetailsMatching(
  db: DbClient,
  whereClause: string,
  sortColumn: string,
  order: 'ASC' | 'DESC',
  values: unknown[],
  limit: number,
  offset: number,
): Promise<JobDetailsDbRow[]> {
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;
  const dataQuery = `
      SELECT id, name, args, status, attempts, max_attempts, scheduled_at, created_at,
             completed_at, duration_ms, error, dead_letter_reason
      FROM sys_jobs
      ${whereClause}
      ORDER BY ${sortColumn} ${order}
      LIMIT $${String(limitParam)} OFFSET $${String(offsetParam)}
    `;
  return db.raw<JobDetailsDbRow>(dataQuery, [...values, limit, offset]);
}

export async function findJobDetailsById(
  db: DbClient,
  taskId: string,
): Promise<JobDetailsDbRow | null> {
  const rows = await db.raw<JobDetailsDbRow>(
    `SELECT id, name, args, status, attempts, max_attempts, scheduled_at, created_at,
            completed_at, duration_ms, error, dead_letter_reason
       FROM sys_jobs
       WHERE id = $1`,
    [taskId],
  );
  return rows[0] ?? null;
}

export async function countJobsGroupedByStatus(
  db: DbClient,
): Promise<Array<{ status: string; count: number }>> {
  const statusQuery = `
      SELECT status, COUNT(*)::int as count
      FROM sys_jobs
      GROUP BY status
    `;
  return db.raw<{ status: string; count: number }>(statusQuery, []);
}

export async function countRecentJobOutcomes(
  db: DbClient,
): Promise<{ recentCompleted: number; recentFailed: number }> {
  const recentQuery = `
      SELECT
        (COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour'))::int as recent_completed,
        (COUNT(*) FILTER (WHERE status IN ('failed', 'dead') AND completed_at > NOW() - INTERVAL '1 hour'))::int as recent_failed
      FROM sys_jobs
    `;
  const recentRows = await db.raw<{ recent_completed: number; recent_failed: number }>(
    recentQuery,
    [],
  );
  return {
    recentCompleted:
      typeof recentRows[0]?.recent_completed === 'number' ? recentRows[0].recent_completed : 0,
    recentFailed:
      typeof recentRows[0]?.recent_failed === 'number' ? recentRows[0].recent_failed : 0,
  };
}
