// main/kernel/db/src/repositories/system/cron.ts
import type { RawDb } from '../../client';

export interface DueCronRow {
  readonly name: string;
  readonly expression: string;
  readonly catch_up: boolean;
  readonly last_run_at: Date | null;
  readonly next_run_at: Date;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim() === '') {
    throw new Error(`Invalid ${label}: must be non-empty`);
  }
}

function assertValidDate(date: Date, label: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: expected valid Date`);
  }
  return date.toISOString();
}

export async function upsertCronSchedule(
  db: RawDb,
  params: {
    readonly name: string;
    readonly expression: string;
    readonly catchUp: boolean;
    readonly nextRunAt: Date;
  },
): Promise<void> {
  assertNonEmpty(params.name, 'cron name');
  assertNonEmpty(params.expression, 'cron expression');
  const nextRunIso = assertValidDate(params.nextRunAt, 'nextRunAt');

  await db.execute({
    text: `
      INSERT INTO sys_cron (name, expression, catch_up, enabled, next_run_at)
      VALUES ($1, $2, $3, true, $4::timestamptz)
      ON CONFLICT (name) DO UPDATE SET
        catch_up = EXCLUDED.catch_up,
        next_run_at = CASE
          WHEN sys_cron.expression <> EXCLUDED.expression THEN EXCLUDED.next_run_at
          ELSE sys_cron.next_run_at
        END,
        expression = EXCLUDED.expression,
        updated_at = now()
    `,
    values: [params.name, params.expression, params.catchUp, nextRunIso],
  });
}

export async function tryAcquireCronLeaderLock(db: RawDb, lockKey: number): Promise<boolean> {
  if (!Number.isSafeInteger(lockKey)) {
    throw new Error(`Invalid lockKey: expected safe integer, got ${String(lockKey)}`);
  }
  const rows = await db.raw<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [
    lockKey,
  ]);
  return rows[0]?.locked === true;
}

export async function claimDueCronRows(db: RawDb, now: Date): Promise<DueCronRow[]> {
  const nowIso = assertValidDate(now, 'now');
  return db.raw<DueCronRow>(
    `SELECT name, expression, catch_up, last_run_at, next_run_at
       FROM sys_cron
      WHERE enabled = true AND next_run_at <= $1::timestamptz
      FOR UPDATE`,
    [nowIso],
  );
}

export async function advanceCronSchedule(
  db: RawDb,
  params: {
    readonly name: string;
    readonly lastRunAt: Date;
    readonly nextRunAt: Date;
  },
): Promise<void> {
  assertNonEmpty(params.name, 'cron name');
  const lastRunIso = assertValidDate(params.lastRunAt, 'lastRunAt');
  const nextRunIso = assertValidDate(params.nextRunAt, 'nextRunAt');

  await db.execute({
    text: `UPDATE sys_cron SET last_run_at = $1::timestamptz, next_run_at = $2::timestamptz, updated_at = now() WHERE name = $3`,
    values: [lastRunIso, nextRunIso, params.name],
  });
}
