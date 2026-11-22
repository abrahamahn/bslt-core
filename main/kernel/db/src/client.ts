// main/kernel/db/src/client.ts
/**
 * Raw PostgreSQL Client Wrapper
 *
 * Provides a type-safe interface over the postgres driver with support for:
 * - Parameterized queries (SQL injection safe)
 * - Transactions with automatic commit/rollback
 * - Query result typing
 * - Connection pooling
 *
 * @example
 * const db = createRawDb('postgres://localhost/mydb');
 * const users = await db.query<User>(select('users').where(eq('active', true)));
 */

import {
  createPgPool,
  type PgOptions,
  type PgSql,
  type PgTransactionSql,
} from '@bslt/protocols/pg';

import {
  applyDriverSettings,
  applyTransactionModes,
  batchDriverStatementWithSettings,
  sendDriverStatement,
} from './builder/wire';
import { DB_ROLES } from './roles';
import { buildPostgresDsn } from './utils/postgres-dsn';

const MS_PER_SECOND = 1000;

export interface QueryResult {
  readonly text: string;
  readonly values: readonly unknown[];
}

// ============================================================================
// Types
// ============================================================================

/**
 * Database client configuration
 */
export interface DbConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Maximum connections in pool (default: 10) */
  maxConnections?: number;
  /** Idle connection timeout in ms (default: 30000) */
  idleTimeout?: number;
  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number;
  /** Enable SSL (default: auto-detect from connection string) */
  ssl?: boolean | 'require' | 'prefer';
  /**
   * Retry policy of `transaction()` for serialization failures and deadlocks
   * (default: {@link DEFAULT_TRANSACTION_RETRY}); `false` turns retries off.
   */
  transactionRetry?: TransactionRetryOptions | false;
  /**
   * Server-side limits of every statement and transaction of this pool
   * (default: none). The runtime's app and worker pools set them from config;
   * the migration owner connection sets none, so a long DDL statement or
   * backfill is never cancelled.
   */
  timeouts?: DbTimeouts;
}

/**
 * Limits Postgres enforces on the statements and transactions of a pool, in
 * milliseconds. `0` means no limit, as in Postgres; a limit left out keeps
 * whatever the server or the login role sets.
 *
 * They are set local to the transaction a statement runs in (`set_config(...,
 * true)`), in the one statement that also binds the session
 * ({@link sessionSettingsQuery}): the transaction `transaction()` opens, or the
 * implicit one of a single statement, which is sent with its settings in one
 * round trip. Nothing is set on the connection, so the limits hold behind a
 * pooler in any mode and never reach another client of the same server
 * connection. A startup parameter would be simpler, and PgBouncer refuses those.
 *
 * On a pool with limits, and on any session client, a call is ONE statement:
 * a single statement and its settings travel in the extended protocol, which
 * takes no `a; b` strings. And because the statement shares that implicit
 * transaction with its settings, one
 * that refuses a transaction (`VACUUM`, `CREATE INDEX CONCURRENTLY`, `CREATE
 * DATABASE`) fails there: run those on a pool without limits, as the migration
 * runner and the tools do.
 */
export interface DbTimeouts {
  /**
   * `statement_timeout`: a statement that runs longer is cancelled and rejects
   * with SQLSTATE 57014. In a transaction, that aborts the transaction.
   */
  statementTimeoutMs?: number;
  /**
   * `lock_timeout`: a statement that waits longer for one lock is cancelled and
   * rejects with SQLSTATE 55P03.
   */
  lockTimeoutMs?: number;
  /**
   * `idle_in_transaction_session_timeout`: a transaction that sends nothing
   * for longer is ended with its session (SQLSTATE 25P03) and rolled back, so
   * it cannot hold locks and a connection for ever. The pool connects again.
   */
  idleInTransactionTimeoutMs?: number;
}

/** The Postgres setting behind each limit, in the order they are sent. */
const TIMEOUT_SETTINGS = [
  ['statementTimeoutMs', 'statement_timeout'],
  ['lockTimeoutMs', 'lock_timeout'],
  ['idleInTransactionTimeoutMs', 'idle_in_transaction_session_timeout'],
] as const satisfies ReadonlyArray<readonly [keyof DbTimeouts, string]>;

/** A setting and the value it gets for the current transaction. */
type LocalSetting = readonly [setting: string, value: string];

/**
 * ONE statement that sets every given setting for the current transaction.
 * The names are constants of this file and are written into the text; the
 * values are bound.
 */
function localSettingsQuery(settings: readonly LocalSetting[]): QueryResult | undefined {
  if (settings.length === 0) return undefined;
  const calls = settings.map(
    ([setting], index) => `set_config('${setting}', $${String(index + 1)}, true)`,
  );
  return { text: `SELECT ${calls.join(', ')}`, values: settings.map(([, value]) => value) };
}

function timeoutSettings(timeouts: DbTimeouts | undefined): LocalSetting[] {
  const settings: LocalSetting[] = [];
  for (const [key, setting] of TIMEOUT_SETTINGS) {
    const ms = timeouts?.[key];
    if (ms === undefined) continue;
    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error(`Database timeout ${key} must be a whole number of milliseconds, 0 or more`);
    }
    // A bare number is milliseconds for these settings.
    settings.push([setting, String(ms)]);
  }
  return settings;
}

/**
 * The one statement that sets a pool's limits for the current transaction, or
 * `undefined` when the pool sets none.
 *
 * @param timeouts - The pool's limits.
 * @returns `SELECT set_config(name, $n, true), ...` with the limits bound.
 * @throws {Error} When a limit is not a whole number of milliseconds, 0 or more.
 */
export function timeoutSettingsQuery(timeouts: DbTimeouts | undefined): QueryResult | undefined {
  return localSettingsQuery(timeoutSettings(timeouts));
}

/**
 * Query options
 */
export interface QueryOptions {
  /**
   * Cancel this statement when it has not finished after this many
   * milliseconds, the wait for a connection included. It rejects with SQLSTATE
   * 57014, as a statement over the pool's `statementTimeoutMs` does; in a
   * transaction that aborts the transaction.
   *
   * The deadline is kept by the client, which asks the server to cancel: use it
   * to give one statement less time than the pool's limit. It cannot give a
   * statement more.
   */
  timeout?: number;
}

/**
 * Transaction isolation levels
 */
export type IsolationLevel =
  'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

/**
 * Transaction options
 */
export interface TransactionOptions {
  /** Isolation level (default: read committed) */
  isolationLevel?: IsolationLevel;
  /** Read-only transaction */
  readOnly?: boolean;
  /** Deferrable (only with serializable) */
  deferrable?: boolean;
  /**
   * Retry policy for this transaction, over the pool's; `false` runs it once.
   * It only applies when this call opens the transaction: a nested call is a
   * savepoint of its caller's transaction and is never retried on its own.
   */
  retry?: TransactionRetryOptions | false;
}

/** What `onRetry` is told before a transaction is run again. */
export interface TransactionRetryEvent {
  /** The attempt that failed, from 1. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** The wait before the next attempt. */
  readonly delayMs: number;
  /** The failure: SQLSTATE 40001 or 40P01, possibly as a `cause`. */
  readonly error: unknown;
}

/**
 * How `transaction()` retries a transaction that Postgres rolled back for a
 * reason that goes away when it runs again: `serialization_failure` (40001)
 * and `deadlock_detected` (40P01).
 *
 * The callback is the whole transaction, so it runs again from the start, on a
 * fresh transaction. Everything it did in the database was rolled back; what it
 * did elsewhere was not. Keep I/O that must happen once (mail, HTTP calls,
 * queue pushes outside this database) out of the callback, or turn retries off
 * for that call.
 */
export interface TransactionRetryOptions {
  /** Runs in total, the first one included (default: 3). `1` never retries. */
  maxAttempts?: number;
  /** Wait before the first retry, in ms; it doubles per attempt (default: 20). */
  baseDelayMs?: number;
  /** Upper bound of one wait, in ms (default: 1000). */
  maxDelayMs?: number;
  /** Called before each wait, for logs and metrics. */
  onRetry?: (event: TransactionRetryEvent) => void;
}

/** The retry policy of a pool that sets none. */
export const DEFAULT_TRANSACTION_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 20,
  maxDelayMs: 1000,
} as const satisfies TransactionRetryOptions;

/** SQLSTATEs of a rollback that a second run of the transaction can avoid. */
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

/** Deepest `cause` chain inspected for a retryable SQLSTATE. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether a failed transaction can be run again: the error, or an error in its
 * `cause` chain, carries SQLSTATE 40001 or 40P01.
 *
 * @param error - What the transaction rejected with.
 * @returns `true` for a serialization failure or a deadlock.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) return false;
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && RETRYABLE_SQLSTATES.has(code)) return true;
    current = cause;
  }
  return false;
}

/**
 * The wait before the retry that follows failed attempt `attempt`: exponential
 * (`baseDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`) with jitter over the
 * upper half of the step, so two transactions that collided do not collide
 * again on the same beat.
 *
 * @param attempt - The attempt that failed, from 1.
 * @param policy - Base and cap, in ms.
 * @param random - A number in [0, 1]; `Math.random` by default.
 * @returns The wait in ms, an integer.
 */
export function transactionRetryDelay(
  attempt: number,
  policy: { readonly baseDelayMs: number; readonly maxDelayMs: number },
  random: () => number = Math.random,
): number {
  // The exponent is bounded so the product stays finite for any attempt number.
  const step = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(attempt - 1, 30));
  return Math.round(step / 2 + (step / 2) * random());
}

type ResolvedTransactionRetry = Required<Omit<TransactionRetryOptions, 'onRetry'>> &
  Pick<TransactionRetryOptions, 'onRetry'>;

/** One attempt, no hook: what `false` means. */
const NO_TRANSACTION_RETRY: ResolvedTransactionRetry = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
};

/** The call's policy over the pool's over the defaults; `false` wins where it is set. */
function resolveTransactionRetry(
  pool: TransactionRetryOptions | false | undefined,
  call: TransactionRetryOptions | false | undefined,
): ResolvedTransactionRetry {
  const chosen = call ?? pool;
  if (chosen === false) return NO_TRANSACTION_RETRY;
  // A call that sets a policy on a pool with retries off starts from the defaults.
  const inherited = call !== undefined && pool !== undefined && pool !== false ? pool : {};
  const merged = { ...DEFAULT_TRANSACTION_RETRY, ...inherited, ...chosen };
  return {
    maxAttempts: Math.max(1, Math.floor(merged.maxAttempts)),
    baseDelayMs: Math.max(0, merged.baseDelayMs),
    maxDelayMs: Math.max(0, merged.maxDelayMs),
    ...(merged.onRetry === undefined ? {} : { onRetry: merged.onRetry }),
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * What a client carries besides its connection and session: the pool-level
 * settings a transaction or session client inherits from the pool it came from.
 */
export interface DbRuntimeOptions {
  transactionRetry?: TransactionRetryOptions | false;
  timeouts?: DbTimeouts;
  /**
   * Set by `transaction()` on the client it hands to its callback: the mode of
   * the transaction that client runs in.
   * @internal
   */
  transaction?: TransactionMode;
}

/** The mode a transaction was opened with. */
export interface TransactionMode {
  readonly isolationLevel: IsolationLevel;
  readonly readOnly?: boolean;
  readonly deferrable?: boolean;
}

/**
 * A nested transaction is a savepoint: it runs in the mode of the transaction
 * around it. Asking it for another isolation level, or to be read-only, would
 * be silently ignored, so it is refused. Without a known enclosing mode (a
 * client built by hand on a transaction) any mode option is refused.
 */
function assertNestedTransactionMode(
  options: TransactionOptions | undefined,
  enclosing: TransactionMode | undefined,
): void {
  const changed = (['isolationLevel', 'readOnly', 'deferrable'] as const).filter(
    (key) => options?.[key] !== undefined && options[key] !== enclosing?.[key],
  );
  if (changed.length > 0) {
    throw new Error(
      `A nested transaction is a savepoint of the transaction around it and cannot change its ${changed.join(', ')}`,
    );
  }
}

/**
 * Session context for Row-Level Security: what the policies of a transaction
 * read. The client binds it with ONE statement ({@link sessionSettingsQuery}).
 *
 * A session with a `userId` is a user session: its transaction runs as the
 * role `authenticated`, so the RLS policies (written `TO authenticated`) apply
 * whatever role the pool logged in as, and a pool whose login role is not
 * allowed to act as `authenticated` fails closed. A session without a `userId`
 * keeps the login role (system scope).
 */
export interface SessionContext {
  /** `app.user_id`, read by `sys_current_user_id()`. */
  userId?: string;
  /** The org of the request: `app.org_id`, read by `sys_current_org_id()`. */
  orgId?: string;
  /** `app.role`: the role claim of the token. No policy trusts it. */
  role?: string;
  /**
   * `app.max_audience`, read by `sys_max_audience()`: the highest audience
   * rating this session may read on a table with `sys_apply_audience`. A whole
   * number from 0 to 32767; a session that sets none has ceiling 0.
   */
  maxAudience?: number;
}

/** The largest `smallint`, which is what `sys_max_audience()` returns. */
const MAX_AUDIENCE_CEILING = 32767;

function sessionSettings(session: SessionContext | undefined): LocalSetting[] {
  const settings: LocalSetting[] = [];
  if (session === undefined) return settings;
  if (session.userId !== undefined) {
    // First, so nothing of a user session is evaluated as the login role. The
    // `role` setting is what `SET LOCAL ROLE` sets, membership check included.
    settings.push(['role', DB_ROLES.authenticated], ['app.user_id', session.userId]);
  }
  if (session.orgId !== undefined) settings.push(['app.org_id', session.orgId]);
  if (session.role !== undefined) settings.push(['app.role', session.role]);
  if (session.maxAudience !== undefined) {
    const ceiling = session.maxAudience;
    if (!Number.isInteger(ceiling) || ceiling < 0 || ceiling > MAX_AUDIENCE_CEILING) {
      throw new Error(
        `Session maxAudience must be a whole number from 0 to ${String(MAX_AUDIENCE_CEILING)}`,
      );
    }
    settings.push(['app.max_audience', String(ceiling)]);
  }
  return settings;
}

/**
 * The ONE statement that binds a session, and the pool's limits with it, for
 * the current transaction: `SELECT set_config('role', $1, true),
 * set_config('app.user_id', $2, true), ...`. Everything it sets ends with the
 * transaction, so nothing reaches the next client of the connection.
 *
 * Only what the session carries is set; a setting it leaves out keeps the
 * value the transaction already has. Every value is bound.
 *
 * @param session - What the policies read; `undefined` binds no session.
 * @param timeouts - The pool's limits, when this statement opens the transaction.
 * @returns The statement, or `undefined` when there is nothing to set.
 * @throws {Error} When `maxAudience` or a limit is not a number in its range.
 */
export function sessionSettingsQuery(
  session: SessionContext | undefined,
  timeouts?: DbTimeouts,
): QueryResult | undefined {
  return localSettingsQuery([...sessionSettings(session), ...timeoutSettings(timeouts)]);
}

/**
 * Raw database client interface
 */
export interface RawDb {
  /**
   * Execute a query and return all rows
   * @example const users = await db.query<User>(select('users').toSql());
   */
  query<T = Record<string, unknown>>(query: QueryResult, options?: QueryOptions): Promise<T[]>;

  /**
   * Execute a query and return the first row or null
   * @example const user = await db.queryOne<User>(select('users').where(eq('id', id)).toSql());
   */
  queryOne<T = Record<string, unknown>>(
    query: QueryResult,
    options?: QueryOptions,
  ): Promise<T | null>;

  /**
   * Execute a query without returning rows (INSERT/UPDATE/DELETE)
   * Returns the number of affected rows
   * @example const count = await db.execute(deleteFrom('sessions').where(lt('expires_at', now)).toSql());
   */
  execute(query: QueryResult, options?: QueryOptions): Promise<number>;

  /**
   * Execute a raw SQL string (use with caution)
   * @example await db.raw('VACUUM ANALYZE users');
   */
  raw<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]>;

  /**
   * Execute a callback within a transaction
   * Automatically commits on success, rolls back on error
   * @example
   * await db.transaction(async (tx) => {
   *   const user = await tx.queryOne<User>(select('users').where(eq('id', id)).forUpdate().toSql());
   *   await tx.execute(update('users').set({ balance: user.balance - 100 }).where(eq('id', id)).toSql());
   * });
   */
  transaction<T>(callback: (tx: RawDb) => Promise<T>, options?: TransactionOptions): Promise<T>;

  /**
   * Create a session-scoped database client for Row-Level Security.
   * Scoped clients execute queries within a local task that sets session variables.
   */
  withSession(session: SessionContext): RawDb;

  /**
   * Check if the database connection is healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close all connections in the pool
   */
  close(): Promise<void>;

  /**
   * Get the underlying postgres client (for advanced use cases)
   */
  getClient(): PgSql;
}

// Internal type for the postgres client (either main or transaction)
type PostgresClient = PgSql | PgTransactionSql;

// ============================================================================
// 64-bit integers
// ============================================================================

/**
 * Postgres `bigint` (int8, OID 20) as a JavaScript `bigint`, for every pool.
 *
 * A JavaScript number is exact only up to 2^53 - 1, so the driver hands int8
 * over as a string unless told otherwise, and each reader then guessed:
 * `Number(...)`, `parseInt(...)`, or nothing at all under a type that said
 * `number`. The client decodes it once: every int8 is a `bigint`, whatever its
 * value, so the type of a result never depends on how large it happens to be.
 * That covers a `bigint` column, an `int8[]` element, `count(*)`, and `sum()`
 * of an `integer` or `smallint` column (`sum(bigint)` is `numeric`, a string).
 *
 * Where a number is wanted:
 * - a count: cast it in SQL (`count(*)::int`, which `selectCount()` writes); a
 *   count over 2^31 - 1 then fails in Postgres (22003) instead of being rounded;
 * - a column known to stay small (a byte size, a few flag bits):
 *   {@link toSafeNumber}, which throws instead of rounding.
 *
 * A `bigint` is not JSON: convert before a value reaches `JSON.stringify`.
 */
const INT8_AS_BIGINT = {
  to: 20,
  from: [20],
  serialize: (value: bigint): string => value.toString(),
  parse: (text: string): bigint => BigInt(text),
};

/**
 * The JavaScript number of a 64-bit integer, when it has one.
 *
 * @param value - An int8 as the client returns it (`bigint`), a number, or a decimal string.
 * @returns The same integer as a number.
 * @throws {RangeError} When the value is not an integer or lies outside
 *   +/-(2^53 - 1), where a number would silently round it.
 */
export function toSafeNumber(value: bigint | number | string): number {
  const exact = typeof value === 'string' ? (/^-?\d+$/.test(value) ? BigInt(value) : null) : value;
  const result = exact === null ? Number.NaN : Number(exact);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${String(value)} does not fit a JavaScript number exactly`);
  }
  return result;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a raw database client
 * @example const db = createRawDb({ connectionString: 'postgres://localhost/mydb' });
 */
export function createRawDb(config: DbConfig | string): RawDb {
  const dbConfig: DbConfig = typeof config === 'string' ? { connectionString: config } : config;

  const postgresOptions: PgOptions = {
    max: dbConfig.maxConnections ?? 10,
    // DbConfig is in milliseconds; the driver's two options are in seconds.
    idle_timeout: (dbConfig.idleTimeout ?? 30000) / MS_PER_SECOND,
    connect_timeout: (dbConfig.connectTimeout ?? 10000) / MS_PER_SECOND,
    ssl: dbConfig.ssl,
    types: { bigint: INT8_AS_BIGINT },
  };

  // Before the pool exists: a limit that is not a number of milliseconds is a
  // configuration error, not something to find out on the first statement.
  timeoutSettingsQuery(dbConfig.timeouts);

  const sql = createPgPool(dbConfig.connectionString, postgresOptions);

  // The postgres client exposes begin() on the main Sql instance only.
  return createDbFromSql(sql, undefined, {
    ...(dbConfig.transactionRetry === undefined
      ? {}
      : { transactionRetry: dbConfig.transactionRetry }),
    ...(dbConfig.timeouts === undefined ? {} : { timeouts: dbConfig.timeouts }),
  });
}

/**
 * Create a RawDb interface from an existing postgres client.
 * Exported for testing the RLS session mechanism.
 * @internal - use createRawDb for production code
 */
export function createDbFromSql(
  sql: PostgresClient,
  session?: SessionContext,
  runtime: DbRuntimeOptions = {},
): RawDb {
  // Only a transaction scope has savepoint(): the driver gives it begin() as
  // well (a savepoint under another name), so begin() alone tells nothing.
  const inTransaction = typeof (sql as unknown as { savepoint?: unknown }).savepoint === 'function';

  // Built once per client: a value out of range is refused before any statement.
  /** The session alone: for a savepoint, whose transaction has its limits. */
  const sessionOnly = sessionSettingsQuery(session);
  /** The session and the pool's limits: for a transaction this client opens. */
  const sessionAndLimits = sessionSettingsQuery(session, runtime.timeouts);
  const hasSession = sessionOnly !== undefined;

  /** Send `settings`, when there are any, as the one settings statement of a transaction. */
  const applySettings = async (
    client: PostgresClient,
    settings: QueryResult | undefined,
  ): Promise<void> => {
    await applyDriverSettings(client, settings);
  };

  /** What the driver resolves a statement with: its rows, and how many it affected. */
  type StatementResult<T> = T[] & { readonly count: number };

  /** One statement on `client`, with the caller's own deadline when it set one. */
  const send = <T>(
    client: PostgresClient,
    text: string,
    values: readonly unknown[],
    options: QueryOptions | undefined,
  ): PromiseLike<StatementResult<T>> => {
    return sendDriverStatement<T>(client, text, values, options?.timeout);
  };

  const run = async <T>(
    text: string,
    values: readonly unknown[],
    options?: QueryOptions,
  ): Promise<StatementResult<T>> => {
    if (inTransaction) {
      if (!hasSession) return await send<T>(sql, text, values, options);
      // A session client made inside a transaction: a savepoint of it, under
      // its limits, so a refused statement does not abort the transaction.
      return await (
        sql as unknown as {
          savepoint: (
            cb: (tx: PgTransactionSql) => Promise<StatementResult<T>>,
          ) => Promise<StatementResult<T>>;
        }
      ).savepoint(async (tx) => {
        await applySettings(tx, sessionOnly);
        return await send<T>(tx, text, values, options);
      });
    }

    if (sessionAndLimits !== undefined) {
      // A single statement is its own transaction. Sent in one batch with its
      // settings, both run in that one implicit transaction, in one round trip:
      // the settings end with it, and when they are refused (a login role that
      // may not act as `authenticated`) the statement is not run.
      return await batchDriverStatementWithSettings<T>(
        sql as PgSql,
        sessionAndLimits,
        text,
        values,
        options?.timeout,
      );
    }

    return await send<T>(sql, text, values, options);
  };

  return {
    async query<T = Record<string, unknown>>(
      query: QueryResult,
      options?: QueryOptions,
    ): Promise<T[]> {
      return run<T>(query.text, query.values, options);
    },

    async queryOne<T = Record<string, unknown>>(
      query: QueryResult,
      options?: QueryOptions,
    ): Promise<T | null> {
      const result = await run<T>(query.text, query.values, options);
      return result[0] ?? null;
    },

    async execute(query: QueryResult, options?: QueryOptions): Promise<number> {
      return (await run(query.text, query.values, options)).count;
    },

    async raw<T = Record<string, unknown>>(sqlText: string, values: unknown[] = []): Promise<T[]> {
      return run<T>(sqlText, values);
    },

    async transaction<T>(
      callback: (tx: RawDb) => Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> {
      const isolationLevel = options?.isolationLevel ?? 'read committed';
      const readOnly = options?.readOnly;
      const deferrable = options?.deferrable;

      const isolationClause = `isolation level ${isolationLevel}`;
      const client = sql as PgSql;
      const beginFn = (client as unknown as { begin?: unknown }).begin;
      if (inTransaction) {
        // Nested: a savepoint of the caller's transaction, which keeps its mode
        // and its limits.
        // Never retried here: a serialization failure or a deadlock aborts the
        // enclosing transaction, so only the call that opened it can run again.
        assertNestedTransactionMode(options, runtime.transaction);
        const result = (
          client as unknown as {
            savepoint: (cb: (tx: PgTransactionSql) => Promise<T>) => Promise<T>;
          }
        ).savepoint(async (tx) => {
          await applySettings(tx, sessionOnly);
          const txDb = createDbFromSql(tx, undefined, runtime);
          return callback(txDb);
        });
        return await result;
      }

      const mode: TransactionMode = {
        isolationLevel,
        ...(readOnly === undefined ? {} : { readOnly }),
        ...(deferrable === undefined ? {} : { deferrable }),
      };

      const runCallback = async (tx: PgTransactionSql | PgSql): Promise<T> => {
        const txOptions: string[] = [];
        if (readOnly === true) {
          txOptions.push('READ ONLY');
        } else if (readOnly === false) {
          txOptions.push('READ WRITE');
        }
        if (deferrable === true) {
          txOptions.push('DEFERRABLE');
        } else if (deferrable === false) {
          txOptions.push('NOT DEFERRABLE');
        }
        if (txOptions.length > 0) {
          await applyTransactionModes(tx, txOptions);
        }

        // After SET TRANSACTION, which must come before the first query: the
        // session and the limits of the whole transaction, in one statement.
        await applySettings(tx, sessionAndLimits);
        const txDb = createDbFromSql(tx, undefined, { ...runtime, transaction: mode });
        return callback(txDb);
      };

      if (typeof beginFn === 'function') {
        // This call opens the transaction, so the callback is all of it and can
        // run again from the start after a serialization failure or a deadlock.
        const retry = resolveTransactionRetry(runtime.transactionRetry, options?.retry);
        for (let attempt = 1; ; attempt++) {
          try {
            return await client.begin(isolationClause, runCallback);
          } catch (error) {
            if (attempt >= retry.maxAttempts || !isRetryableTransactionError(error)) {
              throw error;
            }
            const delayMs = transactionRetryDelay(attempt, retry);
            retry.onRetry?.({ attempt, maxAttempts: retry.maxAttempts, delayMs, error });
            await sleep(delayMs);
          }
        }
      }

      throw new Error('Database client does not support transactions');
    },

    withSession(s: SessionContext): RawDb {
      // Return a new client with the session merged (if already in one) or set
      return createDbFromSql(sql, { ...session, ...s }, runtime);
    },

    async healthCheck(): Promise<boolean> {
      try {
        const mainSql = sql as PgSql;
        await mainSql`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      const mainSql = sql as PgSql;
      await mainSql.end();
    },

    getClient(): PgSql {
      return sql as PgSql;
    },
  };
}

// ============================================================================
// Connection String Utilities
// ============================================================================

/**
 * Build a connection string from environment variables
 */
export function buildConnectionString(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env['DATABASE_URL'] !== undefined && env['DATABASE_URL'] !== '') {
    return env['DATABASE_URL'];
  }

  // Credentials are percent-encoded by `buildPostgresDsn`. Interpolating them
  // raw meant a generated password containing `/` terminated the authority —
  // `postgres://u:pa/ss@host/db` parses with host `pa` — and the deploy failed
  // with an authentication error against a host nobody had typed.
  return buildPostgresDsn({
    user: env['POSTGRES_USER'] ?? env['DB_USER'] ?? 'postgres',
    password: env['POSTGRES_PASSWORD'] ?? env['DB_PASSWORD'] ?? '',
    host: env['POSTGRES_HOST'] ?? env['DB_HOST'] ?? 'localhost',
    port: env['POSTGRES_PORT'] ?? env['DB_PORT'] ?? '5432',
    database: env['POSTGRES_DB'] ?? env['DB_NAME'] ?? 'app_dev',
  });
}

/**
 * Use `key` when set; otherwise fall back to the single legacy connection —
 * outside production only. Production must never silently run migrations or
 * system work through the unprivileged app connection (or, worse, run the app
 * through the owner/superuser one).
 */
function roleConnectionString(
  env: Record<string, string | undefined>,
  key: 'MIGRATION_DATABASE_URL' | 'WORKER_DATABASE_URL',
  purpose: string,
): string {
  const configured = env[key];
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error(`${key} is required in production (${purpose})`);
  }
  return buildConnectionString(env);
}

/**
 * Connection string for migrations and other DDL: the owner role
 * (`MIGRATION_DATABASE_URL`). Outside production it falls back to the legacy
 * single connection so an un-split dev setup keeps working.
 *
 * @param env - Environment variables.
 * @returns The owner-role connection string.
 * @throws {Error} In production when `MIGRATION_DATABASE_URL` is unset.
 */
export function buildMigrationConnectionString(
  env: Record<string, string | undefined> = process.env,
): string {
  return roleConnectionString(env, 'MIGRATION_DATABASE_URL', 'migrations run as the owner role');
}

/**
 * Connection string for sessionless system work — seeds, backfills, jobs —
 * the worker role (`WORKER_DATABASE_URL`). Outside production it falls back to
 * the legacy single connection.
 *
 * @param env - Environment variables.
 * @returns The worker-role connection string.
 * @throws {Error} In production when `WORKER_DATABASE_URL` is unset.
 */
export function buildWorkerConnectionString(
  env: Record<string, string | undefined> = process.env,
): string {
  return roleConnectionString(env, 'WORKER_DATABASE_URL', 'system work runs as the worker role');
}

/**
 * Test if a database is reachable
 */
export async function canReachDatabase(connectionString: string): Promise<boolean> {
  const testClient = createPgPool(connectionString, {
    max: 1,
    // Seconds, the driver's unit: one second to connect, or the answer is no.
    idle_timeout: 1,
    connect_timeout: 1,
  });

  try {
    await testClient`SELECT 1`;
    await testClient.end({ timeout: 1 });
    return true;
  } catch {
    await testClient.end({ timeout: 1 }).catch(() => false);
    return false;
  }
}

/**
 * Find a reachable database from a list of ports
 */
export async function resolveConnectionStringWithFallback(
  env: Record<string, string | undefined> = process.env,
  fallbackPorts: number[] = [5432, 5433, 5434],
): Promise<string> {
  if (env['DATABASE_URL'] !== undefined && env['DATABASE_URL'] !== '') {
    return env['DATABASE_URL'];
  }

  const tryPorts = [Number(env['POSTGRES_PORT'] ?? env['DB_PORT'] ?? NaN), ...fallbackPorts].filter(
    (p) => !isNaN(p),
  );

  const uniquePorts = [...new Set(tryPorts)];

  for (const port of uniquePorts) {
    const envCopy: Record<string, string | undefined> = { ...env };
    envCopy['POSTGRES_PORT'] = String(port);
    envCopy['DB_PORT'] = String(port);
    const connectionString = buildConnectionString(envCopy);

    if (await canReachDatabase(connectionString)) {
      return connectionString;
    }
  }

  throw new Error(`Unable to connect to Postgres on ports: ${uniquePorts.join(', ')}`);
}

// ============================================================================
// DbClient type alias and singleton factory
// ============================================================================

/** Database client type alias for RawDb */
export type DbClient = RawDb;

type GlobalWithDb = typeof globalThis & { rawDbs?: Map<string, RawDb> };

/**
 * Create a raw SQL database client (one pool per connection string, reused in
 * development for HMR). Keyed by connection string so the app-role and
 * worker-role pools are never collapsed into one.
 */
export function createDbClient(config: DbConfig | string): RawDb {
  const dbConfig: DbConfig = typeof config === 'string' ? { connectionString: config } : config;
  const runtimeConfig: DbConfig = {
    ...dbConfig,
    maxConnections: dbConfig.maxConnections ?? Number(process.env['DB_MAX_CONNECTIONS'] ?? 10),
    idleTimeout: dbConfig.idleTimeout ?? Number(process.env['DB_IDLE_TIMEOUT'] ?? 30000),
    connectTimeout: dbConfig.connectTimeout ?? Number(process.env['DB_CONNECT_TIMEOUT'] ?? 10000),
  };

  if (process.env['NODE_ENV'] !== 'production') {
    const globalWithDb = globalThis as GlobalWithDb;
    const pools = (globalWithDb.rawDbs ??= new Map<string, RawDb>());
    const key = runtimeConfig.connectionString;
    const existing = pools.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const raw = createRawDb(runtimeConfig);
    const created: RawDb = {
      ...raw,
      async close(): Promise<void> {
        if (pools.get(key) === created) {
          pools.delete(key);
        }
        await raw.close();
      },
    };
    pools.set(key, created);
    return created;
  }

  return createRawDb(runtimeConfig);
}
