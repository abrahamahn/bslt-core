// tests/integration/database/transaction-retry.real-db.test.ts
/**
 * Transaction retry of the `@bslt/db` client (Real DB)
 *
 * `transaction()` runs the whole transaction again when Postgres rolls it back
 * with `serialization_failure` (40001) or `deadlock_detected` (40P01). Each
 * failure is provoked here with two connections, on a real server: a mock
 * cannot show that the second run sees the other transaction's commit.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { createRawDb, type RawDb, type TransactionRetryEvent } from '@bslt/db';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

/** A promise and the function that settles it: one step of a two-connection script. */
function gate(): { readonly reached: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
}

const codeOf = (error: unknown): string | undefined => (error as { code?: string }).code;

describeRealDb(
  'Transaction retry of the @bslt/db client (Real DB)',
  (realDb) => {
    /** The client under test: short waits, and every retry recorded. */
    let db: RawDb;
    /** The other connection of each script; it never retries. */
    let other: RawDb;
    const retries: TransactionRetryEvent[] = [];

    const balances = async (): Promise<Record<number, number>> => {
      const rows = await other.raw<{ id: number; balance: number }>(
        'SELECT id, balance FROM retry_accounts ORDER BY id',
      );
      return Object.fromEntries(rows.map((row) => [row.id, row.balance]));
    };

    beforeAll(async () => {
      // The superuser: the deadlock script sets deadlock_timeout, a superuser setting.
      const connectionString = realDb.database.adminConnectionString;
      db = createRawDb({
        connectionString,
        maxConnections: 2,
        transactionRetry: {
          baseDelayMs: 5,
          maxDelayMs: 20,
          onRetry: (event) => retries.push(event),
        },
      });
      other = createRawDb({ connectionString, maxConnections: 2, transactionRetry: false });
      await other.raw(
        'CREATE TABLE retry_accounts (id integer PRIMARY KEY, balance integer NOT NULL)',
      );
    }, TEST_TIMEOUT);

    beforeEach(async () => {
      retries.length = 0;
      await other.raw('TRUNCATE retry_accounts');
      await other.raw('INSERT INTO retry_accounts (id, balance) VALUES (1, 100), (2, 200)');
    });

    afterAll(async () => {
      await Promise.all([db.close(), other.close()]);
    });

    /**
     * Read the balance, let another connection commit a change to the row, then
     * write: under REPEATABLE READ the write fails with 40001.
     */
    const depositAfterConcurrentUpdate = async (client: RawDb, runs: { count: number }) =>
      client.transaction(
        async (tx) => {
          runs.count += 1;
          const rows = await tx.raw<{ balance: number }>(
            'SELECT balance FROM retry_accounts WHERE id = 1',
          );
          const balance = rows[0]?.balance ?? 0;
          if (runs.count === 1) {
            await other.raw('UPDATE retry_accounts SET balance = balance + 10 WHERE id = 1');
          }
          await tx.raw('UPDATE retry_accounts SET balance = $1 WHERE id = 1', [balance + 1]);
          return balance + 1;
        },
        { isolationLevel: 'repeatable read' },
      );

    it(
      'runs the transaction again after a serialization failure (40001), on the committed state',
      async () => {
        const runs = { count: 0 };

        const result = await depositAfterConcurrentUpdate(db, runs);

        // The second run read the other connection's commit: nothing was lost.
        expect(runs.count).toBe(2);
        expect(result).toBe(111);
        expect((await balances())[1]).toBe(111);
        expect(retries.map((event) => [event.attempt, codeOf(event.error)])).toEqual([
          [1, SERIALIZATION_FAILURE],
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'the same script rejects with 40001 when retries are off',
      async () => {
        const runs = { count: 0 };

        const failure = await depositAfterConcurrentUpdate(other, runs).then(
          () => undefined,
          (error: unknown) => error,
        );

        expect(codeOf(failure)).toBe(SERIALIZATION_FAILURE);
        expect(runs.count).toBe(1);
        // Only the other connection's change is there: the failed write was rolled back.
        expect((await balances())[1]).toBe(110);
      },
      TEST_TIMEOUT,
    );

    /**
     * Two transactions that lock rows 1 and 2 in opposite orders. `first` gives
     * up after 100 ms of waiting and `second` after 10 s, so `first` is always
     * the one Postgres rolls back.
     */
    const transferAgainstOppositeLockOrder = async (
      first: RawDb,
      runs: { count: number },
    ): Promise<[PromiseSettledResult<void>, PromiseSettledResult<void>]> => {
      const firstHoldsRow1 = gate();
      const secondHoldsRow2 = gate();

      const firstTransfer = first.transaction(async (tx) => {
        runs.count += 1;
        await tx.raw(`SET LOCAL deadlock_timeout = '100ms'`);
        await tx.raw('UPDATE retry_accounts SET balance = balance - 5 WHERE id = 1');
        firstHoldsRow1.open();
        await secondHoldsRow2.reached;
        await tx.raw('UPDATE retry_accounts SET balance = balance + 5 WHERE id = 2');
      });

      const secondTransfer = other.transaction(async (tx) => {
        await tx.raw(`SET LOCAL deadlock_timeout = '10s'`);
        await tx.raw('UPDATE retry_accounts SET balance = balance - 7 WHERE id = 2');
        secondHoldsRow2.open();
        await firstHoldsRow1.reached;
        await tx.raw('UPDATE retry_accounts SET balance = balance + 7 WHERE id = 1');
      });

      return Promise.allSettled([firstTransfer, secondTransfer]);
    };

    it(
      'runs the transaction again after a deadlock (40P01), and both transfers are applied',
      async () => {
        const runs = { count: 0 };

        const [first, second] = await transferAgainstOppositeLockOrder(db, runs);

        expect([first.status, second.status]).toEqual(['fulfilled', 'fulfilled']);
        expect(runs.count).toBe(2);
        expect(await balances()).toEqual({ 1: 100 - 5 + 7, 2: 200 + 5 - 7 });
        expect(retries.map((event) => [event.attempt, codeOf(event.error)])).toEqual([
          [1, DEADLOCK_DETECTED],
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'the same script rejects with 40P01 when retries are off',
      async () => {
        const runs = { count: 0 };
        const single = createRawDb({
          connectionString: realDb.database.adminConnectionString,
          maxConnections: 1,
          transactionRetry: false,
        });

        try {
          const [first, second] = await transferAgainstOppositeLockOrder(single, runs);

          expect(first.status).toBe('rejected');
          expect(codeOf((first as PromiseRejectedResult).reason)).toBe(DEADLOCK_DETECTED);
          expect(second.status).toBe('fulfilled');
          expect(runs.count).toBe(1);
          // Only the surviving transfer is there.
          expect(await balances()).toEqual({ 1: 100 + 7, 2: 200 - 7 });
        } finally {
          await single.close();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'a nested transaction is not retried on its own: the outer one runs again',
      async () => {
        const outerRuns = { count: 0 };
        const innerRuns = { count: 0 };

        await db.transaction(
          async (tx) => {
            outerRuns.count += 1;
            const rows = await tx.raw<{ balance: number }>(
              'SELECT balance FROM retry_accounts WHERE id = 1',
            );
            const balance = rows[0]?.balance ?? 0;
            if (outerRuns.count === 1) {
              await other.raw('UPDATE retry_accounts SET balance = balance + 10 WHERE id = 1');
            }
            await tx.transaction(async (inner) => {
              innerRuns.count += 1;
              await inner.raw('UPDATE retry_accounts SET balance = $1 WHERE id = 1', [balance + 1]);
            });
          },
          { isolationLevel: 'repeatable read' },
        );

        // The savepoint failed once and was not run again inside the aborted
        // transaction; the outer callback ran twice, and so did the inner one.
        expect([outerRuns.count, innerRuns.count]).toEqual([2, 2]);
        expect((await balances())[1]).toBe(111);
        expect(retries).toHaveLength(1);
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);
