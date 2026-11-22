// main/kernel/server/src/cron/types.ts
/**
 * Cron scheduler types.
 *
 * @module cron/types
 */

import type { Logger } from '../logger/types';
import type { DbClient } from '@bslt/db';

/** Arguments handed to a cron handler when its occurrence is dispatched. */
interface CronRunArgs {
  /** The cron job name. */
  cron: string;
  /** ISO timestamp of the scheduled occurrence being run. */
  scheduledFor: string;
}

/** A cron handler runs when an occurrence is dispatched by the leader tick. */
export type CronHandler = (args: CronRunArgs) => Promise<void>;

export interface CronRegisterOptions {
  /**
   * Replay occurrences missed while every replica was down. When false
   * (default), an overdue job fires once and skipped occurrences are
   * recorded but not replayed.
   */
  catchUp?: boolean;
}

/** Minimal logger surface required by the cron scheduler. */
export type CronLogger = Pick<Logger, 'info' | 'error'>;

export interface CronSchedulerOptions {
  db: DbClient;
  log: CronLogger;
  /**
   * Advisory-lock key used to elect a single ticking replica. Override only
   * to isolate test runs from a shared database.
   */
  lockKey?: number;
  /** Tick interval in ms (default: 30_000). */
  tickIntervalMs?: number;
  /** Maximum occurrences replayed in one tick for a catch-up job (default: 100). */
  maxCatchUp?: number;
}

/** Per-tick dispatch summary (returned by runDueOnce for tests/observability). */
export interface CronTickResult {
  /** False when another replica held the advisory lock this tick. */
  leader: boolean;
  /** Number of occurrences whose handler ran this tick. */
  dispatched: number;
  /** Number of handler invocations that threw. */
  failed: number;
  /** Number of overdue occurrences skipped (catchUp disabled). */
  skipped: number;
}
