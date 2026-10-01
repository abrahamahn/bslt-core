// main/apps/server/src/bootstrap/phases/retention.ts
/**
 * In-process retention sweeps for profiles without the workers capability.
 *
 * The starter profile ships without `@bslt/workers`, so nothing would ever
 * execute the retention promises the API makes (hard-ban grace-period
 * anonymization, GDPR PII anonymization of soft-deleted users, hard-deletion
 * of anonymized users, expired-token cleanup, unverified-user cleanup). This
 * module runs those core-side sweeps on a
 * lightweight daily interval — mirroring the inline-fallback pattern used by
 * the data-export handler — without importing the optional workers package.
 */

import { createHash } from 'node:crypto';

import {
  anonymizeExpiredUsers,
  cleanupUnverifiedUsers,
  hardDeleteAnonymizedUsers,
} from '@bslt/core/users';
import { RETENTION_PERIODS } from '@bslt/shared/constants/core';
import { MS_PER_DAY } from '@bslt/shared/constants/time';

import type { DbClient, Repositories } from '@bslt/db';
import type { Logger } from '@bslt/shared/system';

/** Dependencies the retention sweeps need from the bootstrap context. */
export interface RetentionSweepDeps {
  db: DbClient;
  repos: Repositories;
  log: Logger;
}

/** Sentinel lock date used by hard ban to mark permanent bans. */
const PERMANENT_LOCK_THRESHOLD = new Date('2090-01-01');

/** Upper bound on hard-ban anonymizations per sweep run. */
const ANONYMIZATION_BATCH_SIZE = 500;

/** Delay before the first sweep after boot. */
export const RETENTION_BOOT_DELAY_MS = 30_000;

/** Interval between sweeps (daily, matching the workers schedule). */
export const RETENTION_SWEEP_INTERVAL_MS = MS_PER_DAY;

/**
 * Anonymize PII for hard-banned users whose grace period has expired.
 *
 * Minimal in-process counterpart of the workers' hard-ban anonymization job:
 * same candidate selection and same anonymized-field writes, sized for
 * starter-profile volumes (one batch per sweep; the daily cadence drains any
 * remainder).
 */
async function anonymizeExpiredHardBans(repos: Repositories): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_PERIODS.HARD_BAN_GRACE_DAYS * MS_PER_DAY);
  const candidates = await repos.users.listAnonymizationCandidates({
    deletedBefore: cutoff,
    lockedAtOrAfter: PERMANENT_LOCK_THRESHOLD,
    limit: ANONYMIZATION_BATCH_SIZE,
  });

  for (const user of candidates) {
    // Deterministic inert address (same scheme as the workers job) so audit
    // events can still reference the user ID without exposing PII.
    const emailHash = createHash('sha256').update(user.id).digest('hex').substring(0, 16);
    await repos.users.update(user.id, {
      email: `deleted-${emailHash}@anonymized.local`,
      firstName: '',
      lastName: '',
      bio: null,
      phone: null,
      avatarUrl: null,
      city: null,
      state: null,
      country: null,
      gender: null,
      dateOfBirth: null,
      website: null,
      language: null,
      lockReason: null,
    });
  }

  return candidates.length;
}

/**
 * Run every retention sweep step once. Each step is isolated: a failure is
 * logged and the remaining steps still run, so one broken sweep can never
 * take the others (or the app) down.
 */
export async function runRetentionSweep({ db, repos, log }: RetentionSweepDeps): Promise<void> {
  const steps: ReadonlyArray<readonly [name: string, run: () => Promise<number>]> = [
    ['hard-ban-anonymization', () => anonymizeExpiredHardBans(repos)],
    // GDPR PII anonymization for soft-deleted users past their grace period.
    // This is the only producer of the 64-hex@anonymized.local addresses that
    // hard-delete-anonymized purges, so it MUST run first — otherwise deleted
    // PII is retained forever and hard-delete is a permanent no-op. Grace
    // period mirrors the workers `pii-anonymization` job.
    [
      'pii-anonymization',
      async () =>
        (await anonymizeExpiredUsers(db, log, RETENTION_PERIODS.PII_GRACE_DAYS)).anonymizedCount,
    ],
    ['hard-delete-anonymized', async () => (await hardDeleteAnonymizedUsers(db, log)).deletedCount],
    ['auth-tokens-cleanup', () => repos.authTokens.deleteExpired()],
    [
      'unverified-user-cleanup',
      async () => (await cleanupUnverifiedUsers(db, repos, log)).deletedCount,
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

  const interval = setInterval(() => {
    void runRetentionSweep(deps);
  }, intervalMs);
  interval.unref();

  deps.log.info(
    { intervalMs },
    'Workers capability disabled; in-process retention sweeps scheduled',
  );

  return () => {
    clearTimeout(bootTimer);
    clearInterval(interval);
  };
}
