// main/kernel/db/src/testing/mocks.test.ts
import { describe, expect, it } from 'vitest';

import { asMockDb, createMockDb, createMockDbWithData } from './mocks';

describe('database mock helpers', () => {
  it('provides safe default resolutions for every RawDb method in createMockDb', async () => {
    const mock = createMockDb();
    const db = asMockDb(mock);

    expect(await db.query({ text: 'SELECT 1', values: [] })).toEqual([]);
    expect(await db.queryOne({ text: 'SELECT 1', values: [] })).toBeNull();
    expect(await db.execute({ text: 'DELETE FROM t', values: [] })).toBe(0);
    expect(await db.raw('SELECT 1')).toEqual([]);
    expect(await db.healthCheck()).toBe(true);
    expect(await db.close()).toBeUndefined();
    expect(mock.getClient()).toEqual({});
    expect(db.withSession({ userId: 'u-1', role: 'user' })).toBe(db);
  });

  it('executes transactions with the same mock and propagates errors', async () => {
    const mock = createMockDb();
    const db = asMockDb(mock);

    const value = await db.transaction(async (tx) => {
      expect(tx).toBe(db);
      return await Promise.resolve(42);
    });
    expect(value).toBe(42);

    await expect(
      db.transaction(async () => {
        await Promise.resolve();
        throw new Error('rollback requested');
      }),
    ).rejects.toThrow('rollback requested');
  });

  it('populates custom query, queryOne, execute, and raw results via createMockDbWithData', async () => {
    const mock = createMockDbWithData({
      queryResult: [{ id: 'a' }, { id: 'b' }],
      queryOneResult: { id: 'a' },
      executeResult: 3,
      rawResult: [{ ok: 1 }],
    });
    const db = asMockDb(mock);

    expect(await db.query({ text: 'SELECT *', values: [] })).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(await db.queryOne({ text: 'SELECT 1', values: [] })).toEqual({ id: 'a' });
    expect(await db.execute({ text: 'UPDATE t', values: [] })).toBe(3);
    expect(await db.raw('SELECT 1')).toEqual([{ ok: 1 }]);
    expect(db.withSession({ userId: 'u-2', role: 'admin' })).toBe(db);
  });

  it('falls back to empty defaults when createMockDbWithData receives an empty options object', async () => {
    const mock = createMockDbWithData({});

    expect(await mock.query({ text: 'SELECT 1', values: [] })).toEqual([]);
    expect(await mock.queryOne({ text: 'SELECT 1', values: [] })).toBeNull();
    expect(await mock.execute({ text: 'UPDATE t', values: [] })).toBe(0);
    expect(await mock.raw('SELECT 1')).toEqual([]);

    await expect(
      mock.transaction(async () => {
        await Promise.resolve();
        throw new Error('tx failed');
      }),
    ).rejects.toThrow('tx failed');
  });
});
