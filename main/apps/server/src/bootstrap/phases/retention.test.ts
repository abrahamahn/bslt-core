// main/apps/server/src/bootstrap/phases/retention.test.ts
/**
 * Unit tests for the in-process retention sweeps (workers-off fallback):
 * - Account retention is the core step list (`runUserRetention`), the same one
 *   the workers service runs; the sweep writes no users row itself.
 * - A failing step is logged and never blocks the remaining steps.
 * - Scheduling: boot run + daily interval, both cancelled by the stop fn.
 */

import { runUserRetention } from '@bslt/identity/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runRetentionSweep, startRetentionSweeps, type RetentionSweepDeps } from './retention';

vi.mock('@bslt/identity/server', () => ({ runUserRetention: vi.fn() }));

const runUserRetentionMock = vi.mocked(runUserRetention);

interface TestDeps {
  deps: RetentionSweepDeps;
  users: { update: ReturnType<typeof vi.fn> };
  authTokens: { deleteExpired: ReturnType<typeof vi.fn> };
  log: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function makeDeps(): TestDeps {
  const users = { update: vi.fn().mockResolvedValue(null) };
  const authTokens = { deleteExpired: vi.fn().mockResolvedValue(0) };
  const log = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  const deps = {
    db: {},
    repos: { users, authTokens },
    log,
  } as unknown as RetentionSweepDeps;
  return { deps, users, authTokens, log };
}

beforeEach(() => {
  vi.clearAllMocks();
  runUserRetentionMock.mockResolvedValue({
    anonymizedCount: 0,
    purgedCount: 0,
    blockedCount: 0,
    failedCount: 0,
    unverifiedDeletedCount: 0,
  });
});

describe('runRetentionSweep', () => {
  it('runs account retention through the core step list, then token cleanup', async () => {
    const { deps, authTokens } = makeDeps();

    await runRetentionSweep(deps);

    expect(runUserRetentionMock).toHaveBeenCalledWith(deps.db, deps.log);
    expect(authTokens.deleteExpired).toHaveBeenCalledTimes(1);
  });

  it('writes no users row itself: anonymization lives in core alone', async () => {
    const { deps, users } = makeDeps();

    await runRetentionSweep(deps);

    expect(users.update).not.toHaveBeenCalled();
  });

  it('reports what account retention changed', async () => {
    const { deps, log } = makeDeps();
    runUserRetentionMock.mockResolvedValue({
      anonymizedCount: 2,
      purgedCount: 1,
      blockedCount: 1,
      failedCount: 0,
      unverifiedDeletedCount: 3,
    });

    await runRetentionSweep(deps);

    expect(log.info).toHaveBeenCalledWith(
      { sweep: 'user-retention', affected: 6 },
      'Retention sweep step completed',
    );
  });

  it('isolates a failing account retention step and still runs the rest', async () => {
    const { deps, authTokens, log } = makeDeps();
    runUserRetentionMock.mockRejectedValue(new Error('db timeout'));

    await runRetentionSweep(deps);

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ sweep: 'user-retention', error: 'db timeout' }),
      'Retention sweep step failed',
    );
    expect(authTokens.deleteExpired).toHaveBeenCalledTimes(1);
  });

  it('never throws even when every step fails', async () => {
    const { deps, authTokens, log } = makeDeps();
    runUserRetentionMock.mockRejectedValue(new Error('a'));
    authTokens.deleteExpired.mockRejectedValue(new Error('b'));

    await expect(runRetentionSweep(deps)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});

describe('startRetentionSweeps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one sweep shortly after boot and then daily', async () => {
    const { deps, authTokens } = makeDeps();

    const stop = startRetentionSweeps(deps, { bootDelayMs: 1_000, intervalMs: 10_000 });

    expect(authTokens.deleteExpired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(authTokens.deleteExpired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(authTokens.deleteExpired).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stop cancels both the boot run and the interval', async () => {
    const { deps, authTokens } = makeDeps();

    const stop = startRetentionSweeps(deps, { bootDelayMs: 1_000, intervalMs: 10_000 });
    stop();

    await vi.advanceTimersByTimeAsync(50_000);
    expect(authTokens.deleteExpired).not.toHaveBeenCalled();
  });

  it('a sweep failure inside the interval is contained and does not crash', async () => {
    const { deps, authTokens, log } = makeDeps();
    authTokens.deleteExpired.mockRejectedValue(new Error('boom'));

    const stop = startRetentionSweeps(deps, { bootDelayMs: 1_000, intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ sweep: 'auth-tokens-cleanup', error: 'boom' }),
      'Retention sweep step failed',
    );
    stop();
  });
});
