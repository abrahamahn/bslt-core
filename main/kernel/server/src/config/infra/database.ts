// main/kernel/server/src/config/infra/database.ts
import { buildPostgresDsn } from '@bslt/db';

import { DB_DEFAULTS } from '../constants';

import type { DatabaseConfig, PostgresConfig } from '../env/env.database';
import type { FullEnv } from '../env/env.validation';

/**
 * A Postgres connection URL, in either spelling of the scheme. The role
 * bootstrap, `@bslt/db` and the driver accept both, so this must too: a URL it
 * does not recognise is dropped in favour of the `POSTGRES_*` parts.
 */
const POSTGRES_URL_PATTERN = /^postgres(?:ql)?:\/\//;

/**
 * Load Database Configuration.
 *
 * PostgreSQL is the only supported provider; migrations are the single
 * schema source of truth.
 *
 * @param env - Environment variables.
 * @returns PostgreSQL configuration.
 */
export function loadDatabaseConfig(env: FullEnv): DatabaseConfig {
  const isPgProd = env.NODE_ENV === 'production';
  const dbUrl = env.DATABASE_URL;
  const connectionString =
    (dbUrl !== undefined && POSTGRES_URL_PATTERN.test(dbUrl) ? dbUrl : undefined) ??
    env.POSTGRES_CONNECTION_STRING;

  const config: PostgresConfig = {
    provider: 'postgresql',
    host: env.POSTGRES_HOST ?? 'localhost',
    port: env.POSTGRES_PORT ?? DB_DEFAULTS.POSTGRES_PORT,
    database: env.POSTGRES_DB ?? DB_DEFAULTS.DEFAULT_DATABASE_NAME,
    user: env.POSTGRES_USER ?? 'postgres',
    password: env.POSTGRES_PASSWORD ?? '',
    maxConnections: env.DB_MAX_CONNECTIONS,
    timeouts: {
      app: {
        statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
        lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
        idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      },
      worker: {
        statementTimeoutMs: env.DB_WORKER_STATEMENT_TIMEOUT_MS,
        lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
        idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      },
    },
    portFallbacks: [...DB_DEFAULTS.POSTGRES_PORT_FALLBACKS],
    // ssl is usually required for cloud providers in production
    ssl: env.DB_SSL !== undefined ? env.DB_SSL === 'true' : isPgProd,
  };

  if (connectionString !== undefined) {
    config.connectionString = connectionString;
  }

  const replicaUrl = env.DATABASE_READ_REPLICA_URL;
  if (replicaUrl !== undefined && replicaUrl !== '') {
    config.readReplicaConnectionString = replicaUrl;
  }

  // MIGRATION_DATABASE_URL is deliberately not mapped: the runtime never holds
  // the owner credential; only the migration entry points read it.
  const workerUrl = env.WORKER_DATABASE_URL;
  if (workerUrl !== undefined && workerUrl !== '') {
    config.workerConnectionString = workerUrl;
  }

  const listenUrl = env.LISTEN_DATABASE_URL;
  if (listenUrl !== undefined && listenUrl !== '') {
    config.listenConnectionString = listenUrl;
  }

  return config;
}

/** The login user a connection URL names, or `undefined` when it does not parse. */
function connectionUser(connectionString: string): string | undefined {
  if (!URL.canParse(connectionString)) return undefined;
  return decodeURIComponent(new URL(connectionString).username);
}

export function validateDatabaseConfig(config: DatabaseConfig, isProd: boolean): string[] {
  if (!isProd) return [];

  const errors: string[] = [];

  if (
    (config.connectionString === undefined || config.connectionString === '') &&
    config.password === ''
  ) {
    errors.push(
      'Database: POSTGRES_PASSWORD is required in production when DATABASE_URL is not set.',
    );
  }

  const worker = config.workerConnectionString;
  errors.push(...validateListenConnection(config.listenConnectionString, worker));
  if (worker === undefined) {
    errors.push(
      'Database: WORKER_DATABASE_URL is required in production (sessionless and background work runs as the worker role; see docs/deploy/env.md#database-roles).',
    );
  } else {
    const workerUser = connectionUser(worker);
    const appUser =
      config.connectionString !== undefined && config.connectionString !== ''
        ? connectionUser(config.connectionString)
        : config.user;
    if (workerUser === undefined) {
      errors.push('Database: WORKER_DATABASE_URL is not a valid connection URL.');
    } else if (workerUser === appUser) {
      // Names only the env keys — never the URL, which carries the password.
      errors.push(
        'Database: WORKER_DATABASE_URL must use a different role than DATABASE_URL (bslt_worker vs bslt_app).',
      );
    }
  }

  return errors;
}

/**
 * Production rules for the pub/sub listener connection (`LISTEN_DATABASE_URL`).
 *
 * It is required: the fallback to the worker URL is for development only,
 * because in production that URL points at PgBouncer, whose pooling does not
 * carry a `LISTEN` session. It must log in as the worker role, so the listener
 * never holds the app role's, the owner's or the superuser's credentials.
 * Messages name the env keys only, never a URL (it carries a password).
 */
function validateListenConnection(
  listen: string | undefined,
  worker: string | undefined,
): string[] {
  if (listen === undefined) {
    return [
      'Database: LISTEN_DATABASE_URL is required in production (the pub/sub listener connects to Postgres directly as the worker role; see docs/deploy/env.md#database-roles).',
    ];
  }
  const listenUser = connectionUser(listen);
  if (listenUser === undefined || !POSTGRES_URL_PATTERN.test(listen)) {
    return ['Database: LISTEN_DATABASE_URL is not a valid connection URL.'];
  }
  if (worker !== undefined && listenUser !== connectionUser(worker)) {
    return [
      'Database: LISTEN_DATABASE_URL must use the worker role (the user of WORKER_DATABASE_URL).',
    ];
  }
  return [];
}

/**
 * Builds a standardized connection string from discrete config parts.
 *
 * Constructs `postgresql://user:pass@host:port/db` unless an explicit
 * connection string is configured.
 */
export function buildConnectionString(config: DatabaseConfig): string {
  const connStr = config.connectionString;
  if (connStr !== undefined && connStr !== '') return connStr;
  const { user, password, host, port, database } = config;

  // This encoded the password and left the USER raw, while @bslt/db's copy
  // encoded neither. Two hand-rolled URL builders, two different bugs — hence
  // one shared one.
  return buildPostgresDsn({ user, password, host, port, database, protocol: 'postgresql' });
}

/**
 * Connection string for sessionless and background work (the worker role).
 *
 * Falls back to the app connection when `WORKER_DATABASE_URL` is unset —
 * production config validation refuses that, so the fallback only ever applies
 * to an un-split development setup.
 *
 * @param config - Database configuration.
 * @returns The worker-role connection string.
 */
export function buildWorkerConnectionString(config: DatabaseConfig): string {
  return config.workerConnectionString ?? buildConnectionString(config);
}

/**
 * Connection string for the Postgres pub/sub listener (`LISTEN`/`NOTIFY`).
 *
 * `LISTEN_DATABASE_URL`: the worker role, direct to Postgres. Falls back to the
 * worker connection when unset; production config validation refuses that, so
 * the fallback only applies outside production.
 *
 * @param config - Database configuration.
 * @returns The listener connection string.
 */
export function buildListenConnectionString(config: DatabaseConfig): string {
  return config.listenConnectionString ?? buildWorkerConnectionString(config);
}

/**
 * Returns a connection string with the password redacted for logging.
 */
export function getSafeConnectionString(config: DatabaseConfig): string {
  const full = buildConnectionString(config);
  return full.replace(/:([^:@]+)@/, ':****@');
}
