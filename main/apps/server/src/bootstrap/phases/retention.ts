// main/apps/server/src/bootstrap/phases/retention.ts
/**
 * In-process retention sweeps for profiles without the workers capability.
 *
 * The starter profile ships without `@bslt/workers`, so nothing would ever
 * execute the retention promises the API makes (anonymization of deleted and
 * hard-banned accounts once their grace period ends, hard deletion 30 days
 * after deletion, unverified-user cleanup, expired-token cleanup). This
 * module runs `runUserRetention` from core (the same ordered step list the
 * workers service schedules) and the token cleanup on a
 * lightweight daily interval — mirroring the inline-fallback pattern used by
 * the data-export handler — without importing the optional workers package.
 */

import { MS_PER_DAY } from '@bslt/contract';
import {
  identityRepository,
  runUserRetention,
  type UserRetentionResult,
} from '@bslt/identity/server';

import type { DbClient } from '@bslt/db';
import type { Logger } from '@bslt/server-system/logger';

/** Dependencies the retention sweeps need from the bootstrap context. */
export interface RetentionSweepDeps {
  db: DbClient;
  repos?: {
    readonly authTokens?: {
      deleteExpired(): Promise<number>;
    };
  };
  log: Logger;
}

/** Delay before the first sweep after boot. */
const RETENTION_BOOT_DELAY_MS = 30_000;

/** Interval between sweeps (daily, matching the workers schedule). */
const RETENTION_SWEEP_INTERVAL_MS = MS_PER_DAY;

/** Rows changed by one account-retention run. */
function changedRows(result: UserRetentionResult): number {
  return result.anonymizedCount + result.purgedCount + result.unverifiedDeletedCount;
}

/**
 * Run every retention sweep step once. Each step is isolated: a failure is
 * logged and the remaining steps still run, so one broken sweep can never
 * take the others (or the app) down.
 */
export async function runRetentionSweep({ db, repos, log }: RetentionSweepDeps): Promise<void> {
  const steps: ReadonlyArray<readonly [name: string, run: () => Promise<number>]> = [
    // Anonymize, purge, unverified cleanup — in that order, in @bslt/identity.
    ['user-retention', async () => changedRows(await runUserRetention(db, log))],
    [
      'auth-tokens-cleanup',
      () =>
        repos?.authTokens !== undefined
          ? repos.authTokens.deleteExpired()
          : identityRepository(db).deleteExpiredAuthTokens(),
    ],
  ];

  for (const [name, run] of steps) {
    try {
      const affected = await run();
      if (affected > 0) {
        log.info({ sweep: name, affected }, 'Retention sweep step completed');
      }
    } catch (error) {
      log.error(
        { sweep: name, error: error instanceof Error ? error.message : String(error) },
        'Retention sweep step failed',
      );
    }
  }
}

/**
 * Schedule the in-process retention sweeps: one run shortly after boot, then
 * daily. Both timers are `unref`'d so they never keep the process alive.
 *
 * @returns Stop function that cancels both timers (wired into shutdown).
 */
export function startRetentionSweeps(
  deps: RetentionSweepDeps,
  options?: { bootDelayMs?: number; intervalMs?: number },
): () => void {
  const bootDelayMs = options?.bootDelayMs ?? RETENTION_BOOT_DELAY_MS;
  const intervalMs = options?.intervalMs ?? RETENTION_SWEEP_INTERVAL_MS;

  // First run shortly after boot so a freshly started instance honors
  // already-expired grace periods without waiting a full day.
  const bootTimer = setTimeout(() => {
    void runRetentionSweep(deps);
  }, bootDelayMs);
  bootTimer.unref();

  let stopped = false;
  let sweepTimer: NodeJS.Timeout | null = null;
  const scheduleNext = (): void => {
    if (stopped) return;
    sweepTimer = setTimeout(() => {
      void runRetentionSweep(deps);
      scheduleNext();
    }, intervalMs);
    sweepTimer.unref();
  };
  scheduleNext();

  deps.log.info(
    { intervalMs },
    'Workers capability disabled; in-process retention sweeps scheduled',
  );

  return () => {
    stopped = true;
    clearTimeout(bootTimer);
    if (sweepTimer !== null) {
      clearTimeout(sweepTimer);
      sweepTimer = null;
    }
  };
}
