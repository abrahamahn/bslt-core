// main/kernel/server/src/cron/scheduler.ts
/**
 * Leader-elected cron scheduler (`sys_cron`, Plan §9.1–§9.2).
 *
 * Every replica runs the same tick loop, but each tick claims due occurrences
 * inside a transaction-scoped advisory lock (`tryAcquireCronLeaderLock`) so
 * only one replica dispatches per cycle — no external coordinator, and
 * automatic failover when the current leader dies.
 *
 * Each tick has two phases:
 *   1. Under the advisory lock, scan due jobs (`claimDueCronRows`), compute the
 *      occurrences to run, and advance `next_run_at` / `last_run_at`
 *      (`advanceCronSchedule`) — all in one transaction.
 *   2. After the transaction commits (lock released), invoke the registered
 *      handlers off the lock. In production all cron handlers ONLY enqueue a
 *      job onto `QueueServer` (`sys_jobs`) with deterministic idempotencyKey.
 *
 * @module cron/scheduler
 */

import {
  advanceCronSchedule,
  claimDueCronRows,
  tryAcquireCronLeaderLock,
  upsertCronSchedule,
  type DueCronRow,
} from '@bslt/db';

import { nextRun, occurrencesBetween, parseCron, type ParsedCron } from './cron-parser';

import type {
  CronHandler,
  CronRegisterOptions,
  CronSchedulerOptions,
  CronTickResult,
} from './types';

/** Default advisory-lock key electing the single ticking replica. */
const DEFAULT_LOCK_KEY = 4242004242;
const DEFAULT_TICK_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CATCH_UP = 100;

interface CronDefinition {
  name: string;
  expression: string;
  parsed: ParsedCron;
  handler: CronHandler;
  catchUp: boolean;
}

/** One claimed occurrence to execute after the lock is released. */
interface ClaimedRun {
  def: CronDefinition;
  occurrence: Date;
}

export interface CronScheduler {
  /** Register a cron job. Throws if the expression is invalid or the name is taken. */
  register(
    name: string,
    expression: string,
    handler: CronHandler,
    options?: CronRegisterOptions,
  ): void;
  /** Seed the sys_cron table and begin ticking. */
  start(): Promise<void>;
  /** Stop ticking (in-flight handlers are allowed to finish). */
  stop(): void;
  /** Run a single tick now. Exposed for tests and manual triggering. */
  runDueOnce(now?: Date): Promise<CronTickResult>;
}

export function createCronScheduler(options: CronSchedulerOptions): CronScheduler {
  const { db, log } = options;
  const lockKey = options.lockKey ?? DEFAULT_LOCK_KEY;
  const tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const maxCatchUp = options.maxCatchUp ?? DEFAULT_MAX_CATCH_UP;

  const registry = new Map<string, CronDefinition>();
  let timer: NodeJS.Timeout | null = null;

  function register(
    name: string,
    expression: string,
    handler: CronHandler,
    opts: CronRegisterOptions = {},
  ): void {
    if (registry.has(name)) {
      throw new Error(`Cron job already registered: "${name}"`);
    }
    const parsed = parseCron(expression); // throws on invalid expression
    registry.set(name, {
      name,
      expression: parsed.expression,
      parsed,
      handler,
      catchUp: opts.catchUp ?? false,
    });
  }

  /** Upsert each registered cron into sys_cron, seeding next_run_at for new rows. */
  async function seed(now: Date): Promise<void> {
    for (const def of registry.values()) {
      const seededNext = nextRun(def.parsed, now);
      await upsertCronSchedule(db, {
        name: def.name,
        expression: def.expression,
        catchUp: def.catchUp,
        nextRunAt: seededNext,
      });
    }
  }

  /** Compute the occurrences a due row should run, and how many were skipped. */
  function planRow(
    def: CronDefinition,
    row: DueCronRow,
    now: Date,
  ): { runs: Date[]; skipped: number } {
    if (def.catchUp && row.last_run_at !== null) {
      const missed = occurrencesBetween(def.parsed, row.last_run_at, now, maxCatchUp);
      return { runs: missed.length > 0 ? missed : [row.next_run_at], skipped: 0 };
    }

    const skipped =
      row.last_run_at !== null
        ? Math.max(0, occurrencesBetween(def.parsed, row.last_run_at, now, maxCatchUp).length - 1)
        : 0;
    return { runs: [row.next_run_at <= now ? row.next_run_at : now], skipped };
  }

  /**
   * Phase 1: under the advisory lock, claim due occurrences and advance the
   * schedule atomically. Returns the runs to execute after commit.
   */
  async function claimDue(
    now: Date,
  ): Promise<{ leader: boolean; runs: ClaimedRun[]; skipped: number }> {
    return db.transaction(async (tx) => {
      const acquired = await tryAcquireCronLeaderLock(tx, lockKey);
      if (!acquired) {
        return { leader: false, runs: [], skipped: 0 };
      }

      const dueRows = await claimDueCronRows(tx, now);

      const runs: ClaimedRun[] = [];
      let skipped = 0;
      for (const row of dueRows) {
        const def = registry.get(row.name);
        // Registered in the DB but no handler in this process — leave it for a
        // replica that has the handler; don't advance its schedule.
        if (def === undefined) {
          continue;
        }

        const plan = planRow(def, row, now);
        skipped += plan.skipped;
        for (const occurrence of plan.runs) {
          runs.push({ def, occurrence });
        }

        const lastOccurrence = plan.runs[plan.runs.length - 1] ?? now;
        const upcoming = nextRun(def.parsed, now);
        await advanceCronSchedule(tx, {
          name: def.name,
          lastRunAt: lastOccurrence,
          nextRunAt: upcoming,
        });
      }

      return { leader: true, runs, skipped };
    });
  }

  async function runDueOnce(nowArg?: Date): Promise<CronTickResult> {
    const now = nowArg ?? new Date();
    const claim = await claimDue(now);
    if (!claim.leader) {
      return { leader: false, dispatched: 0, failed: 0, skipped: 0 };
    }

    // Phase 2: execute claimed handlers off the lock.
    let dispatched = 0;
    let failed = 0;
    for (const { def, occurrence } of claim.runs) {
      try {
        await def.handler({ cron: def.name, scheduledFor: occurrence.toISOString() });
        dispatched += 1;
      } catch (err) {
        failed += 1;
        log.error({ err, cron: def.name }, 'Cron handler failed');
      }
    }

    if (dispatched > 0 || failed > 0 || claim.skipped > 0) {
      log.info({ dispatched, failed, skipped: claim.skipped }, 'Cron scheduler tick completed');
    }
    return { leader: true, dispatched, failed, skipped: claim.skipped };
  }

  async function start(): Promise<void> {
    if (timer !== null) {
      return;
    }
    if (registry.size === 0) {
      log.info('Cron scheduler: no jobs registered, not starting');
      return;
    }
    await seed(new Date());
    // Tick immediately, then on the interval. unref() so the scheduler never
    // keeps the process alive on its own.
    void runDueOnce().catch((err: unknown) => {
      log.error({ err }, 'Cron tick failed');
    });
    timer = setInterval(() => {
      void runDueOnce().catch((err: unknown) => {
        log.error({ err }, 'Cron tick failed');
      });
    }, tickIntervalMs);
    timer.unref();
    log.info({ jobs: registry.size, tickIntervalMs }, 'Cron scheduler started');
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { register, start, stop, runDueOnce };
}
