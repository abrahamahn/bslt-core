// main/kernel/server/src/config/env/env.database.ts
/**
 * Database Environment Configuration
 *
 * Database types, env interface, and validation schema.
 * PostgreSQL is the only supported provider.
 *
 * @module config/env.database
 */

import { defaulted, enumOf, number, object, optional, string } from '@bslt/schema';

import { DB_DEFAULTS } from '../constants';

import { trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Limits Postgres enforces on the statements and transactions of one pool, in
 * milliseconds; `0` turns a limit off.
 */
interface DatabasePoolTimeouts {
  /** `statement_timeout`: a statement that runs longer is cancelled. */
  statementTimeoutMs: number;
  /** `lock_timeout`: a statement that waits longer for one lock is cancelled. */
  lockTimeoutMs: number;
  /** `idle_in_transaction_session_timeout`: a transaction idle for longer is ended. */
  idleInTransactionTimeoutMs: number;
}

/** PostgreSQL database configuration. */
export interface PostgresConfig {
  provider: 'postgresql';
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionString?: string;
  maxConnections: number;
  /**
   * The limits of the two runtime pools: `app` runs user sessions, `worker`
   * sessionless and background work. The migration owner connection is not a
   * runtime pool and has none.
   */
  timeouts: { app: DatabasePoolTimeouts; worker: DatabasePoolTimeouts };
  portFallbacks: number[];
  ssl: boolean;
  readReplicaConnectionString?: string;
  /**
   * Worker-role connection (`WORKER_DATABASE_URL`) for sessionless and
   * background work. Required in production; outside production the app
   * connection is reused (legacy single-role fallback).
   */
  workerConnectionString?: string;
  /**
   * Pub/sub listener connection (`LISTEN_DATABASE_URL`): the worker role,
   * connected to Postgres directly, because PgBouncer's transaction pooling does not carry
   * `LISTEN`. Required in production; outside production the worker
   * connection is reused.
   */
  listenConnectionString?: string;
}

export type DatabaseConfig = PostgresConfig;

// ============================================================================
// Env Interface
// ============================================================================

/** Database environment variables */
export interface DatabaseEnv {
  DATABASE_PROVIDER?: 'postgresql' | undefined;
  POSTGRES_HOST?: string | undefined;
  POSTGRES_PORT?: number | undefined;
  POSTGRES_DB?: string | undefined;
  POSTGRES_USER?: string | undefined;
  POSTGRES_PASSWORD?: string | undefined;
  POSTGRES_CONNECTION_STRING?: string | undefined;
  DATABASE_URL?: string | undefined;
  DB_MAX_CONNECTIONS: number;
  /** `statement_timeout` of the app pool, in ms; 0 for none. */
  DB_STATEMENT_TIMEOUT_MS: number;
  /** `statement_timeout` of the worker pool, in ms; 0 for none. */
  DB_WORKER_STATEMENT_TIMEOUT_MS: number;
  /** `lock_timeout` of both runtime pools, in ms; 0 for none. */
  DB_LOCK_TIMEOUT_MS: number;
  /** `idle_in_transaction_session_timeout` of both runtime pools, in ms; 0 for none. */
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: number;
  DB_SSL?: 'true' | 'false' | undefined;
  DATABASE_READ_REPLICA_URL?: string | undefined;
  /** Owner role: migrations / DDL only. Read by the migration entry points, never kept in AppConfig. */
  MIGRATION_DATABASE_URL?: string | undefined;
  /** Worker role: sessionless and background work. */
  WORKER_DATABASE_URL?: string | undefined;
  /** Worker role, direct to Postgres (not through PgBouncer): the pub/sub `LISTEN` connection. */
  LISTEN_DATABASE_URL?: string | undefined;
  /** Superuser/admin connection used only by the db:bootstrap:roles command. */
  DATABASE_ADMIN_URL?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

function timeoutMsField(label: string, fallback: number): Schema<number> {
  return defaulted(number({ coerce: true, int: true, min: 0, label }), fallback);
}

export const DatabaseEnvSchema: Schema<DatabaseEnv> = object(
  {
    DATABASE_PROVIDER: optional(enumOf(['postgresql'] as const, 'DATABASE_PROVIDER')),
    POSTGRES_HOST: optional(string({ label: 'POSTGRES_HOST' })),
    POSTGRES_PORT: optional(number({ coerce: true, label: 'POSTGRES_PORT' })),
    POSTGRES_DB: optional(string({ label: 'POSTGRES_DB' })),
    POSTGRES_USER: optional(string({ label: 'POSTGRES_USER' })),
    POSTGRES_PASSWORD: optional(string({ label: 'POSTGRES_PASSWORD' })),
    POSTGRES_CONNECTION_STRING: optional(string({ label: 'POSTGRES_CONNECTION_STRING' })),
    DATABASE_URL: optional(string({ label: 'DATABASE_URL' })),
    DB_MAX_CONNECTIONS: defaulted(number({ coerce: true, label: 'DB_MAX_CONNECTIONS' }), 20),
    DB_STATEMENT_TIMEOUT_MS: timeoutMsField(
      'DB_STATEMENT_TIMEOUT_MS',
      DB_DEFAULTS.STATEMENT_TIMEOUT_MS,
    ),
    DB_WORKER_STATEMENT_TIMEOUT_MS: timeoutMsField(
      'DB_WORKER_STATEMENT_TIMEOUT_MS',
      DB_DEFAULTS.WORKER_STATEMENT_TIMEOUT_MS,
    ),
    DB_LOCK_TIMEOUT_MS: timeoutMsField('DB_LOCK_TIMEOUT_MS', DB_DEFAULTS.LOCK_TIMEOUT_MS),
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: timeoutMsField(
      'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
      DB_DEFAULTS.IDLE_IN_TRANSACTION_TIMEOUT_MS,
    ),
    DB_SSL: optional(trueFalseSchema),
    DATABASE_READ_REPLICA_URL: optional(string({ label: 'DATABASE_READ_REPLICA_URL' })),
    MIGRATION_DATABASE_URL: optional(string({ label: 'MIGRATION_DATABASE_URL' })),
    WORKER_DATABASE_URL: optional(string({ label: 'WORKER_DATABASE_URL' })),
    LISTEN_DATABASE_URL: optional(string({ label: 'LISTEN_DATABASE_URL' })),
    DATABASE_ADMIN_URL: optional(string({ label: 'DATABASE_ADMIN_URL' })),
  },
  { unknownKeys: 'strip' },
);
