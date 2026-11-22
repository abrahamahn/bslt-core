// tests/integration/database/client-bigint.real-db.test.ts
/**
 * 64-bit integers of the `@bslt/db` client (Real DB)
 *
 * Postgres `bigint` (int8) does not fit a JavaScript number above 2^53 - 1, and
 * the driver's default is to hand it over as a string. The client decodes it
 * as a JavaScript `bigint`, always: a column, an expression, an array element,
 * `count(*)`, `sum()` of integers. A count that is wanted as a number is cast
 * in SQL (`count(*)::int`, what `selectCount()` writes), where a value that
 * does not fit fails instead of being rounded.
 *
 * The values here are the ones a number gets wrong: 2^53 + 1 and the ends of
 * the int8 range.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { createRawDb, eq, insert, select, selectCount, toSafeNumber, type RawDb } from '@bslt/db';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

/** 2^53 + 1: the first integer a JavaScript number cannot hold. */
const ABOVE_SAFE = 9_007_199_254_740_993n;
const INT8_MAX = 9_223_372_036_854_775_807n;
const INT8_MIN = -9_223_372_036_854_775_808n;

const NUMERIC_VALUE_OUT_OF_RANGE = '22003';

describeRealDb(
  '64-bit integers of the @bslt/db client (Real DB)',
  (realDb) => {
    let db: RawDb;
    /** A pool with limits: single statements travel in a batch there. */
    let limited: RawDb;

    beforeAll(async () => {
      const connectionString = realDb.database.adminConnectionString;
      db = createRawDb({ connectionString, maxConnections: 2 });
      limited = createRawDb({
        connectionString,
        maxConnections: 2,
        timeouts: { statementTimeoutMs: 30_000 },
      });
      await db.raw(
        `CREATE TABLE big_values (
           id integer PRIMARY KEY,
           amount bigint NOT NULL,
           small integer NOT NULL DEFAULT 1,
           price numeric(20, 2) NOT NULL DEFAULT 1.50,
           history bigint[] NOT NULL DEFAULT '{}'
         )`,
      );
    }, TEST_TIMEOUT);

    beforeEach(async () => {
      await db.raw('TRUNCATE big_values');
    });

    afterAll(async () => {
      await Promise.all([db.close(), limited.close()]);
    });

    it(
      'reads a bigint above 2^53 exactly, as a bigint',
      async () => {
        const rows = await db.raw<{ above: bigint; max: bigint; min: bigint; small: bigint }>(
          `SELECT 9007199254740993::bigint AS above,
                  9223372036854775807::bigint AS max,
                  (-9223372036854775808)::bigint AS min,
                  7::bigint AS small`,
        );

        // A small value is a bigint too: the type does not depend on the value.
        expect(rows).toEqual([{ above: ABOVE_SAFE, max: INT8_MAX, min: INT8_MIN, small: 7n }]);
        // What a number would have made of it: the neighbour below.
        expect(BigInt(Number(ABOVE_SAFE))).toBe(ABOVE_SAFE - 1n);
      },
      TEST_TIMEOUT,
    );

    it(
      'writes and reads a bigint column without loss, through the builder',
      async () => {
        await db.execute(
          insert('big_values')
            .values({ id: 1, amount: ABOVE_SAFE, history: [ABOVE_SAFE, INT8_MAX, 1n] })
            .toSql(),
        );
        // A decimal string is accepted for the column as well.
        await db.execute(
          insert('big_values').values({ id: 2, amount: INT8_MIN.toString() }).toSql(),
        );

        const rows = await db.query<{ id: number; amount: bigint; history: bigint[] }>(
          select('big_values').columns('id', 'amount', 'history').orderBy('id').toSql(),
        );

        expect(rows).toEqual([
          { id: 1, amount: ABOVE_SAFE, history: [ABOVE_SAFE, INT8_MAX, 1n] },
          { id: 2, amount: INT8_MIN, history: [] },
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'a bigint parameter selects the exact row, not its rounded neighbour',
      async () => {
        await db.execute(insert('big_values').values({ id: 1, amount: ABOVE_SAFE }).toSql());
        await db.execute(
          insert('big_values')
            .values({ id: 2, amount: ABOVE_SAFE - 1n })
            .toSql(),
        );

        const exact = await db.query<{ id: number }>(
          select('big_values').columns('id').where(eq('amount', ABOVE_SAFE)).toSql(),
        );

        expect(exact).toEqual([{ id: 1 }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'count(*) and sum() of integers are bigints; a count cast to int is a number',
      async () => {
        await db.execute(insert('big_values').values({ id: 1, amount: 5n, small: 2 }).toSql());
        await db.execute(insert('big_values').values({ id: 2, amount: 6n, small: 3 }).toSql());

        const raw = await db.raw<{ n: bigint; total_small: bigint; n_int: number }>(
          'SELECT count(*) AS n, sum(small) AS total_small, count(*)::int AS n_int FROM big_values',
        );
        const counted = await db.queryOne<{ count: number }>(selectCount('big_values').toSql());

        expect(raw).toEqual([{ n: 2n, total_small: 5n, n_int: 2 }]);
        // selectCount() writes the cast, so its count is a number.
        expect(counted).toEqual({ count: 2 });
      },
      TEST_TIMEOUT,
    );

    it(
      'the other number types keep their types: integer a number, numeric a string',
      async () => {
        await db.execute(insert('big_values').values({ id: 1, amount: 1n, small: 42 }).toSql());

        const rows = await db.raw(
          'SELECT small, price, sum(amount) AS total_amount FROM big_values GROUP BY small, price',
        );

        // sum(bigint) is numeric in Postgres: arbitrary precision, so a string.
        expect(rows).toEqual([{ small: 42, price: '1.50', total_amount: '1' }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'decodes the same way in a transaction, in a session and on a pool with limits',
      async () => {
        await db.execute(insert('big_values').values({ id: 1, amount: ABOVE_SAFE }).toSql());
        const amount = select('big_values').columns('amount').where(eq('id', 1)).toSql();
        const expected = [{ amount: ABOVE_SAFE }];
        await db.raw('GRANT SELECT ON big_values TO authenticated');

        expect(await db.transaction((tx) => tx.query(amount))).toEqual(expected);
        expect(
          await db.withSession({ userId: '00000000-0000-4000-8000-000000000001' }).query(amount),
        ).toEqual(expected);
        expect(await limited.query(amount)).toEqual(expected);
        expect(await limited.transaction((tx) => tx.query(amount))).toEqual(expected);
      },
      TEST_TIMEOUT,
    );

    it(
      'toSafeNumber() turns a bigint into a number only when that is exact',
      async () => {
        await db.execute(insert('big_values').values({ id: 1, amount: 4096n }).toSql());
        await db.execute(insert('big_values').values({ id: 2, amount: ABOVE_SAFE }).toSql());
        const rows = await db.query<{ amount: bigint }>(
          select('big_values').columns('amount').orderBy('id').toSql(),
        );

        expect(toSafeNumber(rows[0]?.amount ?? 0n)).toBe(4096);
        expect(() => toSafeNumber(rows[1]?.amount ?? 0n)).toThrow(RangeError);
      },
      TEST_TIMEOUT,
    );

    it(
      'a count that does not fit the cast fails in Postgres instead of being rounded',
      async () => {
        const failure = await db.raw('SELECT 2147483648::bigint::int AS n').then(
          () => undefined,
          (error: unknown) => error,
        );

        expect((failure as { code?: string } | undefined)?.code).toBe(NUMERIC_VALUE_OUT_OF_RANGE);
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);
