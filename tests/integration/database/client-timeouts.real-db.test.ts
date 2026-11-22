// tests/integration/database/client-timeouts.real-db.test.ts
/**
 * Statement and transaction timeouts of the `@bslt/db` client (Real DB)
 *
 * A pool created with `timeouts` runs every statement under `statement_timeout`
 * and `lock_timeout`, and every transaction under
 * `idle_in_transaction_session_timeout`. The limits are set local to the
 * transaction the statement runs in (its own implicit one for a single
 * statement), never on the session, so they hold behind a pooler in any mode
 * and never leak to another client of the same server connection.
 *
 * Only a real server can show that the statement is cancelled there and that
 * the connection serves the next statement.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { createRawDb, type DbTimeouts, type RawDb } from '@bslt/db';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

const QUERY_CANCELED = '57014';
const LOCK_NOT_AVAILABLE = '55P03';
const IDLE_IN_TRANSACTION_SESSION_TIMEOUT = '25P03';

/** Far below the 10 s the slow statements ask for, far above a quick statement. */
const LIMITS = {
  statementTimeoutMs: 400,
  lockTimeoutMs: 150,
  idleInTransactionTimeoutMs: 300,
} as const satisfies DbTimeouts;

/** A statement that was cancelled returns long before its 10 s are over. */
const CANCELLED_WITHIN_MS = 5_000;

const SETTINGS_SQL = `SELECT current_setting('statement_timeout') AS statement,
       current_setting('lock_timeout') AS lock,
       current_setting('idle_in_transaction_session_timeout') AS idle`;

interface Settings {
  statement: string;
  lock: string;
  idle: string;
}

const NO_LIMITS: Settings = { statement: '0', lock: '0', idle: '0' };
const SET_LIMITS: Settings = { statement: '400ms', lock: '150ms', idle: '300ms' };

const codeOf = (error: unknown): string | undefined => (error as { code?: string }).code;

/** The rejection of a promise that must reject, and how long it took. */
async function rejectionOf(
  promise: Promise<unknown>,
): Promise<{ error: unknown; elapsedMs: number }> {
  const started = Date.now();
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection, and the promise resolved');
    },
    (reason: unknown) => reason,
  );
  return { error, elapsedMs: Date.now() - started };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describeRealDb(
  'Statement and transaction timeouts of the @bslt/db client (Real DB)',
  (realDb) => {
    /** The client under test: one connection, so "the pool" is that connection. */
    let db: RawDb;
    /** A pool that sets no limits: the other side of a lock, and the control. */
    let unlimited: RawDb;

    /** The server process of the one connection of `db`. */
    const backendPid = async (): Promise<number> => {
      const rows = await db.raw<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      return rows[0]?.pid ?? -1;
    };

    /** The session's own settings of `db`, read past the wrapper. */
    const sessionSettings = async (): Promise<Settings> => {
      const rows = await db.getClient().unsafe<Settings[]>(SETTINGS_SQL);
      return { ...(rows[0] ?? NO_LIMITS) };
    };

    beforeAll(async () => {
      const connectionString = realDb.database.adminConnectionString;
      db = createRawDb({
        connectionString,
        maxConnections: 1,
        timeouts: LIMITS,
        transactionRetry: false,
      });
      unlimited = createRawDb({ connectionString, maxConnections: 2, transactionRetry: false });
      await unlimited.raw(
        'CREATE TABLE timeout_rows (id integer PRIMARY KEY, hits integer NOT NULL)',
      );
      await unlimited.raw('GRANT SELECT, UPDATE ON timeout_rows TO authenticated');
    }, TEST_TIMEOUT);

    beforeEach(async () => {
      await unlimited.raw('TRUNCATE timeout_rows');
      await unlimited.raw('INSERT INTO timeout_rows (id, hits) VALUES (1, 0), (2, 0)');
    });

    afterAll(async () => {
      await Promise.all([db.close(), unlimited.close()]);
    });

    it(
      'cancels a statement over the limit, and the same connection serves the next one',
      async () => {
        const pid = await backendPid();

        const { error, elapsedMs } = await rejectionOf(db.raw('SELECT pg_sleep(10)'));

        expect(codeOf(error)).toBe(QUERY_CANCELED);
        expect(elapsedMs).toBeLessThan(CANCELLED_WITHIN_MS);
        expect(await db.raw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
        // Not a new connection: the statement was cancelled, the session lives.
        expect(await backendPid()).toBe(pid);
      },
      TEST_TIMEOUT,
    );

    it(
      'cancels a statement with bound parameters the same way',
      async () => {
        const { error, elapsedMs } = await rejectionOf(
          db.query({ text: 'SELECT pg_sleep($1::int)', values: [10] }),
        );

        expect(codeOf(error)).toBe(QUERY_CANCELED);
        expect(elapsedMs).toBeLessThan(CANCELLED_WITHIN_MS);
      },
      TEST_TIMEOUT,
    );

    it(
      'a statement under the limit returns what it returned without limits',
      async () => {
        const select = { text: 'SELECT id, hits FROM timeout_rows WHERE id = $1', values: [1] };
        const bump = { text: 'UPDATE timeout_rows SET hits = hits + 1 WHERE id < $1', values: [3] };

        expect(await db.query(select)).toEqual(await unlimited.query(select));
        expect(await db.queryOne(select)).toEqual({ id: 1, hits: 0 });
        expect(await db.execute(bump)).toBe(2);
        expect(await db.raw('SELECT hits FROM timeout_rows ORDER BY id')).toEqual([
          { hits: 1 },
          { hits: 1 },
        ]);
        expect(await db.raw('SELECT hits FROM timeout_rows WHERE id = $1', [2])).toEqual([
          { hits: 1 },
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'sets the limits for the statement only: nothing stays on the session',
      async () => {
        await db.raw('SELECT 1');
        await rejectionOf(db.raw('SELECT pg_sleep(10)'));

        expect(await sessionSettings()).toEqual(NO_LIMITS);
      },
      TEST_TIMEOUT,
    );

    it(
      'a transaction runs under the limits, and they end with it',
      async () => {
        let inside: Settings | undefined;

        const { error, elapsedMs } = await rejectionOf(
          db.transaction(async (tx) => {
            inside = (await tx.raw<Settings>(SETTINGS_SQL))[0];
            await tx.raw('UPDATE timeout_rows SET hits = 99 WHERE id = 1');
            await tx.raw('SELECT pg_sleep(10)');
          }),
        );

        expect(inside).toEqual(SET_LIMITS);
        expect(codeOf(error)).toBe(QUERY_CANCELED);
        expect(elapsedMs).toBeLessThan(CANCELLED_WITHIN_MS);
        // Rolled back, and the connection is back in the pool without the limits.
        expect(await db.raw('SELECT hits FROM timeout_rows WHERE id = 1')).toEqual([{ hits: 0 }]);
        expect(await sessionSettings()).toEqual(NO_LIMITS);
      },
      TEST_TIMEOUT,
    );

    it(
      'a nested transaction (savepoint) keeps the limits of the one around it',
      async () => {
        const inside = await db.transaction((tx) =>
          tx.transaction(async (inner) => (await inner.raw<Settings>(SETTINGS_SQL))[0]),
        );

        expect(inside).toEqual(SET_LIMITS);
      },
      TEST_TIMEOUT,
    );

    it(
      'a user session runs under the limits too',
      async () => {
        const session = db.withSession({ userId: '00000000-0000-4000-8000-000000000001' });

        expect(await session.raw<Settings>(SETTINGS_SQL)).toEqual([SET_LIMITS]);
        expect(await session.raw('SELECT current_user AS role')).toEqual([
          { role: 'authenticated' },
        ]);

        const { error, elapsedMs } = await rejectionOf(session.raw('SELECT pg_sleep(10)'));

        expect(codeOf(error)).toBe(QUERY_CANCELED);
        expect(elapsedMs).toBeLessThan(CANCELLED_WITHIN_MS);
        expect(await session.raw('SELECT hits FROM timeout_rows WHERE id = 1')).toEqual([
          { hits: 0 },
        ]);
        expect(await sessionSettings()).toEqual(NO_LIMITS);
      },
      TEST_TIMEOUT,
    );

    /** Run `attempt` while another connection holds the lock of row 1. */
    const whileRowOneIsLocked = async <T>(attempt: () => Promise<T>): Promise<T> => {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });

      const holder = unlimited.transaction(async (tx) => {
        await tx.raw('SELECT id FROM timeout_rows WHERE id = 1 FOR UPDATE');
        locked();
        await released;
      });

      try {
        await isLocked;
        return await attempt();
      } finally {
        release();
        await holder;
      }
    };

    it(
      'gives up waiting for a lock after lock_timeout, before statement_timeout',
      async () => {
        const single = await whileRowOneIsLocked(() =>
          rejectionOf(
            db.execute({ text: 'UPDATE timeout_rows SET hits = 1 WHERE id = $1', values: [1] }),
          ),
        );
        const inTransaction = await whileRowOneIsLocked(() =>
          rejectionOf(
            db.transaction((tx) => tx.raw('UPDATE timeout_rows SET hits = 2 WHERE id = 1')),
          ),
        );

        expect(codeOf(single.error)).toBe(LOCK_NOT_AVAILABLE);
        expect(codeOf(inTransaction.error)).toBe(LOCK_NOT_AVAILABLE);
        expect(await db.raw('SELECT hits FROM timeout_rows WHERE id = 1')).toEqual([{ hits: 0 }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'ends a transaction that sits idle over the limit, and the pool connects again',
      async () => {
        const { error } = await rejectionOf(
          db.transaction(async (tx) => {
            await tx.raw('UPDATE timeout_rows SET hits = 7 WHERE id = 2');
            await sleep(LIMITS.idleInTransactionTimeoutMs * 4);
            await tx.raw('UPDATE timeout_rows SET hits = 8 WHERE id = 2');
          }),
        );

        expect(codeOf(error)).toBe(IDLE_IN_TRANSACTION_SESSION_TIMEOUT);
        // The server ended that session and rolled its work back; the pool opens another.
        expect(await db.raw('SELECT hits FROM timeout_rows WHERE id = 2')).toEqual([{ hits: 0 }]);
      },
      TEST_TIMEOUT,
    );

    it(
      'a pool created without timeouts sets none (the migration owner connection)',
      async () => {
        const inside = await unlimited.transaction(
          async (tx) => (await tx.raw<Settings>(SETTINGS_SQL))[0],
        );

        expect(inside).toEqual(NO_LIMITS);
        // Longer than the limits of the other pool, and it completes.
        expect(await unlimited.raw('SELECT pg_sleep(0.6) IS NOT NULL AS done')).toEqual([
          { done: true },
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'QueryOptions.timeout cancels one statement, on a pool with or without limits',
      async () => {
        const slow = { text: 'SELECT pg_sleep($1::int)', values: [10] };

        const onUnlimited = await rejectionOf(unlimited.query(slow, { timeout: 200 }));
        const shorter = await rejectionOf(db.query(slow, { timeout: 100 }));
        const inTransaction = await rejectionOf(
          unlimited.transaction((tx) => tx.execute(slow, { timeout: 200 })),
        );

        expect(codeOf(onUnlimited.error)).toBe(QUERY_CANCELED);
        expect(onUnlimited.elapsedMs).toBeLessThan(CANCELLED_WITHIN_MS);
        expect(codeOf(shorter.error)).toBe(QUERY_CANCELED);
        // The caller's deadline came first, not the pool's statement_timeout.
        expect((shorter.error as Error).message).toMatch(/user request/);
        expect(codeOf(inTransaction.error)).toBe(QUERY_CANCELED);
        expect(await unlimited.queryOne({ text: 'SELECT 1 AS ok', values: [] })).toEqual({ ok: 1 });
        expect(await db.queryOne({ text: 'SELECT 1 AS ok', values: [] })).toEqual({ ok: 1 });
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);
