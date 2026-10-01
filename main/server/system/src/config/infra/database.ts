// main/server/system/src/config/infra/database.ts
import { DB_DEFAULTS } from '@bslt/shared/constants';
import { buildPostgresDsn } from '@bslt/shared/helpers';

import type { DatabaseConfig, FullEnv, PostgresConfig } from '@bslt/shared/system/config';

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
    (dbUrl?.includes('postgresql') === true ? dbUrl : undefined) ?? env.POSTGRES_CONNECTION_STRING;

  const config: PostgresConfig = {
    provider: 'postgresql',
    host: env.POSTGRES_HOST ?? 'localhost',
    port: env.POSTGRES_PORT ?? DB_DEFAULTS.POSTGRES_PORT,
    database: env.POSTGRES_DB ?? DB_DEFAULTS.DEFAULT_DATABASE_NAME,
    user: env.POSTGRES_USER ?? 'postgres',
    password: env.POSTGRES_PASSWORD ?? '',
    maxConnections: env.DB_MAX_CONNECTIONS,
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

  return config;
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

  return errors;
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
 * Returns a connection string with the password redacted for logging.
 */
export function getSafeConnectionString(config: DatabaseConfig): string {
  const full = buildConnectionString(config);
  return full.replace(/:([^:@]+)@/, ':****@');
}
