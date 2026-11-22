// main/kernel/db/src/rls.unit.test.ts
import { describe, expect, it, vi, type Mock } from 'vitest';

import { createDbFromSql, sessionSettingsQuery } from './index';

/** What the driver is given for one statement, before it is sent. */
interface Pending {
  readonly text: string;
  readonly values: unknown[];
}

interface RecordingPool {
  readonly sql: unknown;
  /** Every round trip, in order: a batch is one, a statement in a transaction is one. */
  readonly trips: string[][];
  readonly batch: Mock;
  readonly begin: Mock;
  /** The statements of a transaction scope, with their values. */
  readonly txUnsafe: Mock;
}

/**
 * A pool as the client uses the driver: `unsafe()` makes a statement,
 * `batch()` sends several in one round trip, `begin()` opens a transaction
 * whose scope has `unsafe()` and `savepoint()`.
 */
function recordingPool(result: unknown = []): RecordingPool {
  const trips: string[][] = [];
  const unsafe = vi.fn().mockImplementation((text: string, values: unknown[]) => ({
    text,
    values,
  }));
  const batch = vi.fn().mockImplementation((queries: Pending[]) => {
    trips.push(queries.map((query) => query.text));
    return Promise.resolve([[], result]);
  });
  const txUnsafe = vi.fn().mockImplementation((text: string) => {
    trips.push([text]);
    return Promise.resolve(result);
  });
  const scope: Record<string, unknown> = { unsafe: txUnsafe };
  scope['savepoint'] = vi
    .fn()
    .mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(scope));
  type Callback = (tx: unknown) => Promise<unknown>;
  const begin = vi
    .fn()
    .mockImplementation((mode: string | Callback, cb?: Callback) =>
      typeof mode === 'string' ? cb?.(scope) : mode(scope),
    );
  return { sql: { unsafe, batch, begin }, trips, batch, begin, txUnsafe };
}

const USER_SESSION_SQL =
  "SELECT set_config('role', $1, true), set_config('app.user_id', $2, true), set_config('app.org_id', $3, true), set_config('app.role', $4, true)";

describe('sessionSettingsQuery', () => {
  it('binds the role and every setting of the session in ONE statement', () => {
    expect(sessionSettingsQuery({ userId: 'user-123', orgId: 'org-456', role: 'user' })).toEqual({
      text: USER_SESSION_SQL,
      values: ['authenticated', 'user-123', 'org-456', 'user'],
    });
  });

  it('binds the audience ceiling as app.max_audience', () => {
    expect(sessionSettingsQuery({ userId: 'u1', maxAudience: 2 })).toEqual({
      text: "SELECT set_config('role', $1, true), set_config('app.user_id', $2, true), set_config('app.max_audience', $3, true)",
      values: ['authenticated', 'u1', '2'],
    });
  });

  it("carries the pool's limits in the same statement, after the session", () => {
    expect(sessionSettingsQuery({ orgId: 'org-1' }, { statementTimeoutMs: 30_000 })).toEqual({
      text: "SELECT set_config('app.org_id', $1, true), set_config('statement_timeout', $2, true)",
      values: ['org-1', '30000'],
    });
  });

  it('never writes a value into the SQL text', () => {
    const hostile = "x', true), set_config('role', 'bslt_owner";

    const query = sessionSettingsQuery({ userId: hostile, orgId: hostile, role: hostile });

    expect(query?.text).toBe(USER_SESSION_SQL);
    expect(query?.values).toEqual(['authenticated', hostile, hostile, hostile]);
  });

  it('keeps the login role for a session that carries no user (system scope)', () => {
    const query = sessionSettingsQuery({ orgId: 'org-1', role: 'service' });

    expect(query?.text).not.toContain("'role'");
    expect(query?.values).toEqual(['org-1', 'service']);
  });

  it('treats an empty-string userId as a user session (never silently unscoped)', () => {
    expect(sessionSettingsQuery({ userId: '' })?.values).toEqual(['authenticated', '']);
  });

  it('is undefined when there is nothing to set', () => {
    expect(sessionSettingsQuery(undefined)).toBeUndefined();
    expect(sessionSettingsQuery({})).toBeUndefined();
  });

  it.each([-1, 1.5, 32_768, Number.NaN])('refuses an audience ceiling of %s', (maxAudience) => {
    expect(() => sessionSettingsQuery({ userId: 'u1', maxAudience })).toThrow(
      'Session maxAudience must be a whole number from 0 to 32767',
    );
    // Before any statement: the session client cannot be made.
    expect(() =>
      createDbFromSql(recordingPool().sql as never).withSession({ maxAudience }),
    ).toThrow('Session maxAudience');
  });
});

describe('RLS Session Client', () => {
  it('sends a session statement in ONE round trip: its settings, then the statement', async () => {
    const { sql, trips, batch, begin } = recordingPool();
    const sessionClient = createDbFromSql(sql as never, {
      userId: 'user-123',
      orgId: 'org-456',
      role: 'user',
    });

    await sessionClient.query({ text: 'SELECT * FROM users', values: [] });

    // One settings statement, and it comes first: nothing of the statement is
    // evaluated before the role and the settings the policies read are in place.
    expect(trips).toEqual([[USER_SESSION_SQL, 'SELECT * FROM users']]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(begin).not.toHaveBeenCalled();
    expect((sql as { unsafe: Mock }).unsafe).toHaveBeenNthCalledWith(1, USER_SESSION_SQL, [
      'authenticated',
      'user-123',
      'org-456',
      'user',
    ]);
  });

  it('resolves with the result of the statement, not of the settings', async () => {
    const rows = Object.assign([{ id: 't1' }], { count: 1 });
    const { sql } = recordingPool(rows);
    const client = createDbFromSql(sql as never, { userId: 'u1' });
    const query = { text: 'DELETE FROM tasks WHERE id = $1 RETURNING id', values: ['t1'] };

    expect(await client.query(query)).toBe(rows);
    expect(await client.queryOne(query)).toEqual({ id: 't1' });
    expect(await client.execute(query)).toBe(1);
    expect(await client.raw('SELECT id FROM tasks')).toBe(rows);
  });

  it('sets the session ONCE in an explicit transaction, before its first statement', async () => {
    const { sql, trips, batch, txUnsafe } = recordingPool();
    const client = createDbFromSql(sql as never, { userId: 'user-123' });

    await client.transaction(async (tx) => {
      await tx.query({ text: 'UPDATE tasks SET title = $1', values: ['x'] });
      await tx.query({ text: 'SELECT 1', values: [] });
    });

    const settings = "SELECT set_config('role', $1, true), set_config('app.user_id', $2, true)";
    expect(trips).toEqual([[settings], ['UPDATE tasks SET title = $1'], ['SELECT 1']]);
    expect(txUnsafe).toHaveBeenNthCalledWith(1, settings, ['authenticated', 'user-123']);
    // Nothing ran on the pooled connection outside the transaction.
    expect(batch).not.toHaveBeenCalled();
    expect((sql as { unsafe: Mock }).unsafe).not.toHaveBeenCalled();
  });

  it('sets the session and the limits of a transaction in the same ONE statement', async () => {
    const { sql, trips } = recordingPool();
    const client = createDbFromSql(
      sql as never,
      { userId: 'u1' },
      { timeouts: { statementTimeoutMs: 30_000, lockTimeoutMs: 10_000 } },
    );

    await client.transaction((tx) => tx.raw('SELECT 1'), { readOnly: true });

    expect(trips).toEqual([
      ['SET TRANSACTION READ ONLY'],
      [
        "SELECT set_config('role', $1, true), set_config('app.user_id', $2, true), set_config('statement_timeout', $3, true), set_config('lock_timeout', $4, true)",
      ],
      ['SELECT 1'],
    ]);
  });

  it('does not run the statement of a transaction when the role switch is refused', async () => {
    const refused = new Error('permission denied to set role "authenticated"');
    const { sql, txUnsafe } = recordingPool();
    txUnsafe.mockRejectedValueOnce(refused);
    const callback = vi.fn();

    await expect(
      createDbFromSql(sql as never, { userId: 'u1' }).transaction(callback, { retry: false }),
    ).rejects.toBe(refused);

    // Fail closed: the callback, and so every protected statement, never ran.
    expect(callback).not.toHaveBeenCalled();
    expect(txUnsafe).toHaveBeenCalledTimes(1);
  });

  it('rejects a session statement whose batch is refused', async () => {
    const refused = new Error('permission denied to set role "authenticated"');
    const { sql, batch } = recordingPool();
    batch.mockRejectedValueOnce(refused);

    await expect(
      createDbFromSql(sql as never, { userId: 'u1' }).query({
        text: 'SELECT * FROM notifications',
        values: [],
      }),
    ).rejects.toBe(refused);
  });

  it('a session client made inside a transaction is a savepoint with ONE settings statement', async () => {
    const { sql, trips, batch } = recordingPool();
    const client = createDbFromSql(sql as never, undefined, {
      timeouts: { statementTimeoutMs: 30_000 },
    });

    await client.transaction(async (tx) => {
      await tx.withSession({ userId: 'u1', orgId: 'org-1' }).raw('SELECT 1');
    });

    expect(batch).not.toHaveBeenCalled();
    expect(trips).toEqual([
      // The transaction's own statement: the limits of the pool.
      ["SELECT set_config('statement_timeout', $1, true)"],
      // The savepoint: the session alone, under the limits the transaction has.
      [
        "SELECT set_config('role', $1, true), set_config('app.user_id', $2, true), set_config('app.org_id', $3, true)",
      ],
      ['SELECT 1'],
    ]);
  });

  it('sends a statement without a session and without limits alone', async () => {
    const { sql, trips, batch, begin } = recordingPool();
    const unsafe = (sql as { unsafe: Mock }).unsafe;
    unsafe.mockImplementation((text: string) => {
      trips.push([text]);
      return Promise.resolve([]);
    });

    await createDbFromSql(sql as never).query({ text: 'SELECT * FROM users', values: [] });

    expect(trips).toEqual([['SELECT * FROM users']]);
    expect(unsafe).toHaveBeenCalledWith('SELECT * FROM users', []);
    expect(batch).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });
});

describe('A session and the search_path', () => {
  it('a session never changes the search_path: one schema, row-level security in it', async () => {
    const { sql, trips } = recordingPool();
    const client = createDbFromSql(sql as never, {
      userId: 'user-123',
      orgId: 'org-456',
      role: 'user',
    });

    await client.query({ text: 'SELECT 1', values: [] });

    expect(trips.flat().some((statement) => statement.includes('search_path'))).toBe(false);
    // The role switch that makes the policies apply and the settings they read.
    expect(trips).toEqual([[USER_SESSION_SQL, 'SELECT 1']]);
  });

  it('ignores a schema an untyped caller still passes', async () => {
    const { sql, trips } = recordingPool();
    const client = createDbFromSql(
      sql as never,
      {
        userId: 'user-123',
        schema: 'tenant_demo',
      } as never,
    );

    await client.query({ text: 'SELECT 1', values: [] });

    expect(trips.flat().some((statement) => statement.includes('search_path'))).toBe(false);
    expect((sql as { unsafe: Mock }).unsafe.mock.calls.flat(2)).not.toContain('tenant_demo');
  });
});
