// main/kernel/db/src/repositories/system/cron.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  advanceCronSchedule,
  claimDueCronRows,
  tryAcquireCronLeaderLock,
  upsertCronSchedule,
} from './cron';

import type { RawDb } from '../../client';

function createMockDb(): RawDb {
  return {
    query: vi.fn(),
    raw: vi.fn() as RawDb['raw'],
    transaction: vi.fn() as RawDb['transaction'],
    healthCheck: vi.fn(),
    close: vi.fn(),
    getClient: vi.fn() as RawDb['getClient'],
    queryOne: vi.fn(),
    execute: vi.fn(),
    withSession: vi.fn() as RawDb['withSession'],
  };
}

describe('sys_cron repository', () => {
  let db: RawDb;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it('upserts a cron schedule row into sys_cron', async () => {
    vi.mocked(db.execute).mockResolvedValue(1);
    const nextRunAt = new Date('2026-07-01T01:00:00.000Z');

    await upsertCronSchedule(db, {
      name: 'sys.outbox.retention',
      expression: '0 2 * * *',
      catchUp: false,
      nextRunAt,
    });

    const call = vi.mocked(db.execute).mock.calls[0]?.[0];
    expect(call?.text).toContain('INSERT INTO sys_cron');
    expect(call?.text).toContain('ON CONFLICT (name) DO UPDATE');
    expect(call?.values).toEqual([
      'sys.outbox.retention',
      '0 2 * * *',
      false,
      '2026-07-01T01:00:00.000Z',
    ]);
  });

  it('rejects empty name, empty expression, or invalid nextRunAt on upsertCronSchedule', async () => {
    await expect(
      upsertCronSchedule(db, {
        name: '   ',
        expression: '0 * * * *',
        catchUp: false,
        nextRunAt: new Date('2026-07-01T01:00:00.000Z'),
      }),
    ).rejects.toThrow(/cron name/i);

    await expect(
      upsertCronSchedule(db, {
        name: 'valid',
        expression: '',
        catchUp: false,
        nextRunAt: new Date('2026-07-01T01:00:00.000Z'),
      }),
    ).rejects.toThrow(/cron expression/i);

    await expect(
      upsertCronSchedule(db, {
        name: 'valid',
        expression: '0 * * * *',
        catchUp: false,
        nextRunAt: new Date('invalid'),
      }),
    ).rejects.toThrow(/nextRunAt/i);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('acquires or declines the transaction-scoped leader advisory lock', async () => {
    vi.mocked(db.raw)
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ locked: false }]);

    expect(await tryAcquireCronLeaderLock(db, 4242004242)).toBe(true);
    expect(await tryAcquireCronLeaderLock(db, 4242004242)).toBe(false);
    expect(db.raw).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_xact_lock($1) AS locked',
      [4242004242],
    );
  });

  it('rejects non-integer lock keys on tryAcquireCronLeaderLock', async () => {
    await expect(tryAcquireCronLeaderLock(db, Number.NaN)).rejects.toThrow(/lockKey/i);
    expect(db.raw).not.toHaveBeenCalled();
  });

  it('claims due enabled rows FOR UPDATE and rejects invalid timestamps', async () => {
    const dueRow = {
      name: 'hourly',
      expression: '0 * * * *',
      catch_up: false,
      last_run_at: null,
      next_run_at: new Date('2026-07-01T00:00:00.000Z'),
    };
    vi.mocked(db.raw).mockResolvedValueOnce([dueRow]);

    const rows = await claimDueCronRows(db, new Date('2026-07-01T00:00:00.000Z'));
    expect(rows).toEqual([dueRow]);
    expect(vi.mocked(db.raw).mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(vi.mocked(db.raw).mock.calls[0]?.[1]).toEqual(['2026-07-01T00:00:00.000Z']);

    await expect(claimDueCronRows(db, new Date('bad'))).rejects.toThrow(/now/i);
  });

  it('advances last_run_at and next_run_at and rejects invalid inputs or propagating DB errors', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(1);
    await advanceCronSchedule(db, {
      name: 'hourly',
      lastRunAt: new Date('2026-07-01T00:00:00.000Z'),
      nextRunAt: new Date('2026-07-01T01:00:00.000Z'),
    });

    const call = vi.mocked(db.execute).mock.calls[0]?.[0];
    expect(call?.text).toContain('UPDATE sys_cron');
    expect(call?.values).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T01:00:00.000Z',
      'hourly',
    ]);

    await expect(
      advanceCronSchedule(db, {
        name: '',
        lastRunAt: new Date('2026-07-01T00:00:00.000Z'),
        nextRunAt: new Date('2026-07-01T01:00:00.000Z'),
      }),
    ).rejects.toThrow(/cron name/i);

    vi.mocked(db.execute).mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(
      advanceCronSchedule(db, {
        name: 'hourly',
        lastRunAt: new Date('2026-07-01T00:00:00.000Z'),
        nextRunAt: new Date('2026-07-01T01:00:00.000Z'),
      }),
    ).rejects.toThrow('deadlock detected');
  });
});
