// main/kernel/db/src/utils/transaction.test.ts
import { describe, expect, it, vi } from 'vitest';

import { asMockDb, createMockDb } from '../testing/mocks';

import { isInTransaction, withTransaction } from './transaction';

describe('transaction utilities', () => {
  it('delegates callback and options to db.transaction and returns the callback value', async () => {
    const mock = createMockDb();
    const db = asMockDb(mock);
    const options = { isolationLevel: 'serializable' as const };

    const result = await withTransaction(
      db,
      async (tx) => {
        expect(tx).toBe(db);
        return await Promise.resolve('committed');
      },
      options,
    );

    expect(result).toBe('committed');
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.transaction).toHaveBeenCalledWith(expect.any(Function), options);
  });

  it('propagates callback rejections without swallowing transaction errors', async () => {
    const mock = createMockDb();
    const db = asMockDb(mock);
    const boom = new Error('serialization failure');

    await expect(
      withTransaction(db, async () => {
        await Promise.resolve();
        throw boom;
      }),
    ).rejects.toThrow('serialization failure');
  });

  it('propagates underlying db.transaction failures before callback runs', async () => {
    const mock = createMockDb();
    mock.transaction = vi.fn().mockRejectedValue(new Error('pool exhausted'));
    const callback = vi.fn();

    await expect(withTransaction(asMockDb(mock), callback)).rejects.toThrow('pool exhausted');
    expect(callback).not.toHaveBeenCalled();
  });

  it('reports transaction context via isInTransaction', () => {
    const db = asMockDb(createMockDb());
    expect(isInTransaction(db)).toBe(true);
  });
});
