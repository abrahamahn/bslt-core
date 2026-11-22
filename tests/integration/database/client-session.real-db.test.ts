// tests/integration/database/client-session.real-db.test.ts
/**
 * The session of the `@bslt/db` client, statement by statement (Real DB)
 *
 * A session client binds what the row-level security policies read: the role
 * `authenticated`, `app.user_id`, the org of the request (`app.org_id`),
 * `app.role` and the audience ceiling (`app.max_audience`). It binds all of it,
 * and the pool's timeouts, with ONE `SELECT set_config(...)` statement, local to
 * the transaction:
 *
 * - a single statement travels with its settings in one batch, which is one
 *   round trip and one implicit transaction;
 * - a transaction sets them once, before the first statement of its callback.
 *
 * The statements are counted where they leave the process: the driver's `debug`
 * hook is called with every query it sends, `BEGIN` and `COMMIT` included.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { randomUUID } from 'node:crypto';

import { createDbFromSql, type DbTimeouts, type RawDb } from '@bslt/db';
import { createPgPool, type PgSql } from '@bslt/protocols/pg';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

const INSUFFICIENT_PRIVILEGE = '42501';

const LIMITS = {
  statementTimeoutMs: 30_000,
  lockTimeoutMs: 10_000,
  idleInTransactionTimeoutMs: 60_000,
} as const satisfies DbTimeouts;

/** What a statement sees of its session. */
const WHO = `SELECT current_user::text AS db_user,
       sys_current_user_id()::text AS user_id,
       sys_current_org_id()::text AS org_id,
       NULLIF(current_setting('app.role', true), '') AS app_role,
       sys_max_audience()::int AS audience,
       current_setting('statement_timeout') AS statement_timeout`;

interface Who {
  db_user: string;
  user_id: string | null;
  org_id: string | null;
  app_role: string | null;
  audience: number;
  statement_timeout: string;
}

const isSettings = (statement: string): boolean => statement.includes('set_config(');
const isTransactionControl = (statement: string): boolean =>
  /^\s*(begin|commit|rollback|savepoint|release)\b/i.test(statement);

describeRealDb('The session of the @bslt/db client, statement by statement (Real DB)', (realDb) => {
  /** Every statement the driver sent, in order. */
  const wire: string[] = [];
  /** bslt_app over one connection, so "the session" is that connection. */
  let sql: PgSql;
  let app: RawDb;
  /** The same connection with the limits a runtime pool has. */
  let limited: RawDb;
  /** bslt_worker: not a member of `authenticated`. */
  let workerSql: PgSql;
  let worker: RawDb;

  const alice = randomUUID();
  const org = randomUUID();

  const who = async (db: RawDb): Promise<Who> => {
    const [row] = await db.raw<Who>(WHO);
    if (row === undefined) throw new Error('the session probe returned no row');
    return { ...row };
  };

  beforeAll(async () => {
    const debug = (_connection: number, query: string): void => {
      wire.push(query);
    };
    sql = createPgPool(realDb.database.appConnectionString, { max: 1, debug });
    app = createDbFromSql(sql);
    limited = createDbFromSql(sql, undefined, { timeouts: LIMITS });
    workerSql = createPgPool(realDb.database.connectionString, { max: 1 });
    worker = createDbFromSql(workerSql);
    // nextval() is never rolled back: the sequence tells whether a statement ran.
    await realDb.database.adminDb.raw('CREATE SEQUENCE session_probe_seq');
    await realDb.database.adminDb.raw('GRANT USAGE, SELECT ON session_probe_seq TO PUBLIC');
    // Connect before anything is counted.
    await app.raw('SELECT 1');
  }, TEST_TIMEOUT);

  beforeEach(() => {
    wire.length = 0;
  });

  afterAll(async () => {
    await Promise.all([sql.end(), workerSql.end()]);
  });

  it(
    'a session statement is ONE settings statement and the statement, with no BEGIN and no COMMIT',
    async () => {
      const session = app.withSession({ userId: alice, orgId: org, role: 'user' });

      const row = await who(session);

      expect(row).toMatchObject({ db_user: 'authenticated', user_id: alice, org_id: org });
      expect(wire).toHaveLength(2);
      expect(wire.filter(isSettings)).toHaveLength(1);
      expect(wire.filter(isTransactionControl)).toEqual([]);
      expect(wire[0]).toMatch(/^SELECT set_config\(/);
      expect(wire[1]).toBe(WHO);
    },
    TEST_TIMEOUT,
  );

  it(
    'binds the role, the user, the org, the role claim and the audience ceiling',
    async () => {
      const session = app.withSession({
        userId: alice,
        orgId: org,
        role: 'admin',
        maxAudience: 2,
      });

      expect(await who(session)).toEqual({
        db_user: 'authenticated',
        user_id: alice,
        org_id: org,
        app_role: 'admin',
        audience: 2,
        statement_timeout: '0',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'the settings end with the statement: the connection keeps none of them',
    async () => {
      await who(app.withSession({ userId: alice, orgId: org, role: 'user', maxAudience: 3 }));

      // The same connection (the pool has one), without a session.
      expect(await who(app)).toEqual({
        db_user: 'bslt_app',
        user_id: null,
        org_id: null,
        app_role: null,
        audience: 0,
        statement_timeout: '0',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'a transaction sets its settings once, whatever the number of statements',
    async () => {
      const session = app.withSession({ userId: alice, orgId: org, role: 'user' });

      const rows = await session.transaction(async (tx) => [
        await who(tx),
        await who(tx),
        await who(tx),
      ]);

      expect(rows.map((row) => row.user_id)).toEqual([alice, alice, alice]);
      expect(rows.map((row) => row.db_user)).toEqual([
        'authenticated',
        'authenticated',
        'authenticated',
      ]);
      expect(wire.filter(isSettings)).toHaveLength(1);
      // BEGIN, the settings, three statements, COMMIT.
      expect(wire).toHaveLength(6);
      expect(wire.findIndex(isSettings)).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "the pool's timeouts travel in the same statement as the session",
    async () => {
      const session = limited.withSession({ userId: alice, orgId: org, role: 'user' });

      expect(await who(session)).toMatchObject({
        db_user: 'authenticated',
        user_id: alice,
        statement_timeout: '30s',
      });
      expect(wire).toHaveLength(2);
      expect(wire.filter(isSettings)).toHaveLength(1);

      wire.length = 0;
      const inTransaction = await session.transaction((tx) => who(tx));

      expect(inTransaction).toMatchObject({ user_id: alice, statement_timeout: '30s' });
      expect(wire.filter(isSettings)).toHaveLength(1);
      // BEGIN, the settings, the statement, COMMIT.
      expect(wire).toHaveLength(4);
    },
    TEST_TIMEOUT,
  );

  it(
    'a session value is bound, never part of the SQL text',
    async () => {
      const hostile = `x', true), set_config('role', 'bslt_owner`;
      const session = app.withSession({ orgId: hostile, role: `o'brien` });

      const [row] = await session.raw<{ org: string; role: string; db_user: string }>(
        `SELECT current_setting('app.org_id') AS org, current_setting('app.role') AS role,
                current_user::text AS db_user`,
      );

      expect(row).toEqual({ org: hostile, role: `o'brien`, db_user: 'bslt_app' });
      expect(wire[0]).not.toContain('brien');
      expect(wire[0]).not.toContain('bslt_owner');
    },
    TEST_TIMEOUT,
  );

  it(
    'a login role that may not act as authenticated runs nothing of the statement',
    async () => {
      const refused = await worker
        .withSession({ userId: alice, role: 'user' })
        .raw(`SELECT nextval('session_probe_seq')`)
        .then(
          () => {
            throw new Error('expected a rejection, and the statement ran');
          },
          (error: unknown) => error as { code?: string; message?: string },
        );

      expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(refused.message).toMatch(/permission denied to set role/);
      const [probe] = await realDb.database.adminDb.raw<{ is_called: boolean }>(
        'SELECT is_called FROM session_probe_seq',
      );
      expect(probe).toEqual({ is_called: false });
      // The connection is in order and has no user: the next statement is the worker's.
      expect(await who(worker)).toMatchObject({ db_user: 'bslt_worker', user_id: null });
    },
    TEST_TIMEOUT,
  );

  it(
    'a session without a user keeps the login role and binds what it carries',
    async () => {
      const row = await who(worker.withSession({ orgId: org }));

      expect(row).toMatchObject({ db_user: 'bslt_worker', user_id: null, org_id: org });
    },
    TEST_TIMEOUT,
  );
});
