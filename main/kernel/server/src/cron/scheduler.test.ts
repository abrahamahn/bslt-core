// main/kernel/server/src/cron/scheduler.test.ts
/**
 * Unit tests for the cron scheduler.
 *
 * Drives the tick logic against a mock DB so leader election, dispatch,
 * next_run_at advancement, and catch-up replay are all verified without a
 * live Postgres. Handlers run after the lock is released.
 */

import { describe, expect, it, vi } from 'vitest';

import { createCronScheduler } from './scheduler';

import type { CronLogger } from './types';
import type { DbClient } from '@bslt/db';

interface ExecuteCall {
  text: string;
  values: unknown[];
}

interface MockDbState {
  /** Result of pg_try_advisory_xact_lock. */
  locked: boolean;
  /** Rows returned by the due-jobs SELECT. */
  dueRows: Array<{
    name: string;
    expression: string;
    catch_up: boolean;
    last_run_at: Date | null;
    next_run_at: Date;
  }>;
  /** Every execute() the scheduler issued (seed + schedule advance). */
  executes: ExecuteCall[];
  /** Count of advisory-lock attempts (one per tick); used to observe ticking. */
  lockAttempts?: number;
}

function createMockDb(state: MockDbState): DbClient {
  const handleRaw = (text: string): unknown[] => {
    if (text.includes('pg_try_advisory_xact_lock')) {
      state.lockAttempts = (state.lockAttempts ?? 0) + 1;
      return [{ locked: state.locked }];
    }
    if (text.includes('FROM sys_cron')) {
      return state.dueRows;
    }
    return [];
  };

  const tx = {
    raw: vi.fn((text: string) => Promise.resolve(handleRaw(text))),
    execute: vi.fn((q: ExecuteCall) => {
      state.executes.push(q);
      return Promise.resolve(1);
    }),
  } as unknown as DbClient;

  return {
    execute: vi.fn((q: ExecuteCall) => {
      state.executes.push(q);
      return Promise.resolve(1);
    }),
    transaction: vi.fn((cb: (t: DbClient) => Promise<unknown>) => cb(tx)),
  } as unknown as DbClient;
}

function mockLogger(): CronLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as CronLogger;
}

const noop = async (): Promise<void> => {
  /* handler body irrelevant to scheduling */
};

function advanceUpdates(state: MockDbState): ExecuteCall[] {
  return state.executes.filter((e) => e.text.includes('UPDATE sys_cron'));
}

describe('createCronScheduler — registration', () => {
  it('rejects an invalid expression at registration time', () => {
    const state: MockDbState = { locked: true, dueRows: [], executes: [] };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    expect(() => scheduler.register('bad', '99 * * * *', noop)).toThrow();
  });

  it('rejects a duplicate name', () => {
    const state: MockDbState = { locked: true, dueRows: [], executes: [] };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    scheduler.register('dupe', '0 * * * *', noop);
    expect(() => scheduler.register('dupe', '0 0 * * *', noop)).toThrow(/already registered/i);
  });
});

describe('createCronScheduler — tick / leader election', () => {
  it('does nothing when another replica holds the advisory lock', async () => {
    const state: MockDbState = { locked: false, dueRows: [], executes: [] };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    const handler = vi.fn(noop);
    scheduler.register('job-a', '* * * * *', handler);

    const result = await scheduler.runDueOnce(new Date('2026-06-12T10:00:00.000Z'));

    expect(result.leader).toBe(false);
    expect(result.dispatched).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs a due handler once and advances next_run_at', async () => {
    const now = new Date('2026-06-12T10:00:00.000Z');
    const state: MockDbState = {
      locked: true,
      dueRows: [
        {
          name: 'hourly-job',
          expression: '0 * * * *',
          catch_up: false,
          last_run_at: new Date('2026-06-12T09:00:00.000Z'),
          next_run_at: new Date('2026-06-12T10:00:00.000Z'),
        },
      ],
      executes: [],
    };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    const handler = vi.fn(noop);
    scheduler.register('hourly-job', '0 * * * *', handler);

    const result = await scheduler.runDueOnce(now);

    expect(result).toMatchObject({ leader: true, dispatched: 1, failed: 0 });
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      cron: 'hourly-job',
      scheduledFor: '2026-06-12T10:00:00.000Z',
    });

    // next_run_at advanced to the next future occurrence (11:00).
    const update = advanceUpdates(state)[0];
    expect(update?.values[1]).toBe('2026-06-12T11:00:00.000Z');
    expect(update?.values[2]).toBe('hourly-job');
  });

  it('counts a throwing handler as failed but still advances the schedule', async () => {
    const now = new Date('2026-06-12T10:00:00.000Z');
    const state: MockDbState = {
      locked: true,
      dueRows: [
        {
          name: 'flaky-job',
          expression: '0 * * * *',
          catch_up: false,
          last_run_at: new Date('2026-06-12T09:00:00.000Z'),
          next_run_at: new Date('2026-06-12T10:00:00.000Z'),
        },
      ],
      executes: [],
    };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    scheduler.register('flaky-job', '0 * * * *', async () => {
      throw new Error('boom');
    });

    const result = await scheduler.runDueOnce(now);

    expect(result).toMatchObject({ leader: true, dispatched: 0, failed: 1 });
    expect(advanceUpdates(state)).toHaveLength(1);
  });

  it('skips a due row that has no handler registered in this process', async () => {
    const state: MockDbState = {
      locked: true,
      dueRows: [
        {
          name: 'foreign-job',
          expression: '0 * * * *',
          catch_up: false,
          last_run_at: null,
          next_run_at: new Date('2026-06-12T10:00:00.000Z'),
        },
      ],
      executes: [],
    };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    // Intentionally do NOT register 'foreign-job'.

    const result = await scheduler.runDueOnce(new Date('2026-06-12T10:00:00.000Z'));

    expect(result.dispatched).toBe(0);
    expect(advanceUpdates(state)).toHaveLength(0);
  });
});

describe('createCronScheduler — catch-up', () => {
  it('replays every missed occurrence when catchUp is enabled', async () => {
    const now = new Date('2026-06-12T12:00:00.000Z');
    const state: MockDbState = {
      locked: true,
      dueRows: [
        {
          name: 'catchup-job',
          expression: '0 * * * *',
          catch_up: true,
          // Last ran at 09:00; missed 10:00, 11:00, 12:00 while down.
          last_run_at: new Date('2026-06-12T09:00:00.000Z'),
          next_run_at: new Date('2026-06-12T10:00:00.000Z'),
        },
      ],
      executes: [],
    };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    const handler = vi.fn(noop);
    scheduler.register('catchup-job', '0 * * * *', handler, { catchUp: true });

    const result = await scheduler.runDueOnce(now);

    expect(result.dispatched).toBe(3);
    expect(
      handler.mock.calls.map((c) => (c as unknown as [{ scheduledFor: string }])[0].scheduledFor),
    ).toEqual(['2026-06-12T10:00:00.000Z', '2026-06-12T11:00:00.000Z', '2026-06-12T12:00:00.000Z']);
  });

  it('fires once and records skipped occurrences when catchUp is disabled', async () => {
    const now = new Date('2026-06-12T12:00:00.000Z');
    const state: MockDbState = {
      locked: true,
      dueRows: [
        {
          name: 'no-catchup',
          expression: '0 * * * *',
          catch_up: false,
          last_run_at: new Date('2026-06-12T09:00:00.000Z'),
          next_run_at: new Date('2026-06-12T10:00:00.000Z'),
        },
      ],
      executes: [],
    };
    const scheduler = createCronScheduler({ db: createMockDb(state), log: mockLogger() });
    const handler = vi.fn(noop);
    scheduler.register('no-catchup', '0 * * * *', handler, { catchUp: false });

    const result = await scheduler.runDueOnce(now);

    // One run dispatched; 10:00 and 11:00 counted as skipped (12:00 is the run).
    expect(result.dispatched).toBe(1);
    expect(result.skipped).toBe(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('createCronScheduler — start / stop / seed', () => {
  it('does not seed or start when no jobs are registered', async () => {
    const state: MockDbState = { locked: true, dueRows: [], executes: [] };
    const log = mockLogger();
    const scheduler = createCronScheduler({ db: createMockDb(state), log });

    await scheduler.start();

    expect(state.executes).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith('Cron scheduler: no jobs registered, not starting');
    // stop() before start is a safe no-op.
    expect(() => scheduler.stop()).not.toThrow();
  });

  it('seeds each registered job into sys_cron on start', async () => {
    vi.useFakeTimers();
    try {
      const state: MockDbState = { locked: true, dueRows: [], executes: [] };
      const scheduler = createCronScheduler({
        db: createMockDb(state),
        log: mockLogger(),
        tickIntervalMs: 1000,
      });
      scheduler.register('seed-job', '0 * * * *', noop, { catchUp: true });

      await scheduler.start();

      const seedInsert = state.executes.find((e) => e.text.includes('INSERT INTO sys_cron'));
      expect(seedInsert).toBeDefined();
      expect(seedInsert?.values[0]).toBe('seed-job');
      expect(seedInsert?.values[1]).toBe('0 * * * *');
      expect(seedInsert?.values[2]).toBe(true); // catch_up

      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent — a second start() does not seed again', async () => {
    vi.useFakeTimers();
    try {
      const state: MockDbState = { locked: true, dueRows: [], executes: [] };
      const scheduler = createCronScheduler({
        db: createMockDb(state),
        log: mockLogger(),
        tickIntervalMs: 1000,
      });
      scheduler.register('once', '0 * * * *', noop);

      await scheduler.start();
      const seedsAfterFirst = state.executes.filter((e) =>
        e.text.includes('INSERT INTO sys_cron'),
      ).length;

      await scheduler.start();
      const seedsAfterSecond = state.executes.filter((e) =>
        e.text.includes('INSERT INTO sys_cron'),
      ).length;

      expect(seedsAfterFirst).toBe(1);
      expect(seedsAfterSecond).toBe(1);

      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks on the interval until stopped', async () => {
    vi.useFakeTimers();
    try {
      // Not the leader, so each tick is a cheap lock attempt we can count.
      const state: MockDbState = { locked: false, dueRows: [], executes: [], lockAttempts: 0 };
      const scheduler = createCronScheduler({
        db: createMockDb(state),
        log: mockLogger(),
        tickIntervalMs: 1000,
      });
      scheduler.register('tick-job', '* * * * *', noop);

      await scheduler.start();
      // Immediate tick + two interval ticks.
      await vi.advanceTimersByTimeAsync(2500);
      const attemptsBeforeStop = state.lockAttempts ?? 0;
      expect(attemptsBeforeStop).toBeGreaterThan(0);

      scheduler.stop();
      await vi.advanceTimersByTimeAsync(5000);

      // No further ticks after stop().
      expect(state.lockAttempts).toBe(attemptsBeforeStop);
    } finally {
      vi.useRealTimers();
    }
  });
});
