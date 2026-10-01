// main/shared/src/modules/system/config/env.database.ts
/**
 * Database Environment Configuration
 *
 * Database types, env interface, and validation schema.
 * PostgreSQL is the only supported provider.
 *
 * @module config/env.database
 */

import {
  coerceNumber,
  createEnumSchema,
  createSchema,
  parseObject,
  parseOptional,
  parseString,
  withDefault,
} from '../../../schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '../../../schema';

// ============================================================================
// Types
// ============================================================================

export type DatabaseProvider = 'postgresql';

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
  portFallbacks: number[];
  ssl: boolean;
  readReplicaConnectionString?: string;
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
  DB_SSL?: 'true' | 'false' | undefined;
  DATABASE_READ_REPLICA_URL?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const DatabaseEnvSchema: Schema<DatabaseEnv> = createSchema<DatabaseEnv>((data: unknown) => {
  const obj = parseObject(data, 'DatabaseEnv');
  return {
    DATABASE_PROVIDER: parseOptional(obj['DATABASE_PROVIDER'], (v: unknown) =>
      createEnumSchema(['postgresql'] as const, 'DATABASE_PROVIDER').parse(v),
    ),
    POSTGRES_HOST: parseOptional(obj['POSTGRES_HOST'], (v: unknown) =>
      parseString(v, 'POSTGRES_HOST'),
    ),
    POSTGRES_PORT: parseOptional(obj['POSTGRES_PORT'], (v: unknown) =>
      coerceNumber(v, 'POSTGRES_PORT'),
    ),
    POSTGRES_DB: parseOptional(obj['POSTGRES_DB'], (v: unknown) => parseString(v, 'POSTGRES_DB')),
    POSTGRES_USER: parseOptional(obj['POSTGRES_USER'], (v: unknown) =>
      parseString(v, 'POSTGRES_USER'),
    ),
    POSTGRES_PASSWORD: parseOptional(obj['POSTGRES_PASSWORD'], (v: unknown) =>
      parseString(v, 'POSTGRES_PASSWORD'),
    ),
    POSTGRES_CONNECTION_STRING: parseOptional(obj['POSTGRES_CONNECTION_STRING'], (v: unknown) =>
      parseString(v, 'POSTGRES_CONNECTION_STRING'),
    ),
    DATABASE_URL: parseOptional(obj['DATABASE_URL'], (v: unknown) =>
      parseString(v, 'DATABASE_URL'),
    ),
    DB_MAX_CONNECTIONS: coerceNumber(
      withDefault(obj['DB_MAX_CONNECTIONS'], 20),
      'DB_MAX_CONNECTIONS',
    ),
    DB_SSL: parseOptional(obj['DB_SSL'], (v: unknown) => trueFalseSchema.parse(v)),
    DATABASE_READ_REPLICA_URL: parseOptional(obj['DATABASE_READ_REPLICA_URL'], (v: unknown) =>
      parseString(v, 'DATABASE_READ_REPLICA_URL'),
    ),
  };
});
