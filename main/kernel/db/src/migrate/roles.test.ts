// main/kernel/db/src/migrate/roles.test.ts
import { describe, expect, it, vi } from 'vitest';

import { runLockedBootstrapStatements } from './roles';

import type { RawDb } from '../client';

describe('runLockedBootstrapStatements', () => {
  it('propagates advisory lock failure before running any DDL statement', async () => {
    const raw = vi.fn().mockRejectedValueOnce(new Error('lock denied'));
    const admin = {
      transaction: async <T>(cb: (tx: RawDb) => Promise<T>): Promise<T> =>
        cb({ raw } as unknown as RawDb),
    } as unknown as RawDb;

    await expect(
      runLockedBootstrapStatements(admin, 'bslt_roles', ['CREATE ROLE x']),
    ).rejects.toThrow('lock denied');
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('stops on the first failing DDL statement and surfaces the error', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce([]);
    const admin = {
      transaction: async <T>(cb: (tx: RawDb) => Promise<T>): Promise<T> =>
        cb({ raw } as unknown as RawDb),
    } as unknown as RawDb;

    await expect(
      runLockedBootstrapStatements(admin, 'bslt_roles', ['STMT_1', 'STMT_2']),
    ).rejects.toThrow('permission denied');
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('acquires transaction advisory lock then runs every DDL statement in order', async () => {
    const raw = vi.fn().mockResolvedValue([]);
    const admin = {
      transaction: async <T>(cb: (tx: RawDb) => Promise<T>): Promise<T> =>
        cb({ raw } as unknown as RawDb),
    } as unknown as RawDb;

    await runLockedBootstrapStatements(admin, 'bslt_roles', ['STMT_1', 'STMT_2']);
    expect(raw.mock.calls).toEqual([
      ['SELECT pg_advisory_xact_lock(hashtext($1))', ['bslt_roles']],
      ['STMT_1'],
      ['STMT_2'],
    ]);
  });
});
