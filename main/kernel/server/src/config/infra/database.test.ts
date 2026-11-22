// main/kernel/server/src/config/infra/database.test.ts
import { describe, expect, test } from 'vitest';

import { DatabaseEnvSchema } from '../env/env.database';
import { type FullEnv } from '../env/env.validation';

import {
  buildConnectionString,
  buildListenConnectionString,
  buildWorkerConnectionString,
  getSafeConnectionString,
  loadDatabaseConfig,
  validateDatabaseConfig,
} from './database';

describe('Database Configuration', () => {
  describe('loadDatabaseConfig', () => {
    test('should load default values when no env vars set', () => {
      const config = loadDatabaseConfig({} as unknown as FullEnv);

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(5432);
      expect(config.ssl).toBe(false);
    });

    test('should enable SSL by default in production', () => {
      const config = loadDatabaseConfig({ NODE_ENV: 'production' } as unknown as FullEnv);

      expect(config.ssl).toBe(true);
    });

    test('should prioritize DATABASE_URL for postgresql', () => {
      const config = loadDatabaseConfig({
        DATABASE_URL: 'postgresql://remote-host:5432/remote-db',
        POSTGRES_HOST: 'localhost',
      } as unknown as FullEnv);

      expect(config.connectionString).toBe('postgresql://remote-host:5432/remote-db');
    });

    test('uses a DATABASE_URL written with the postgres:// scheme', () => {
      // Both spellings are valid, and the role bootstrap and the driver accept
      // both. Ignoring this one fell back, silently, to the POSTGRES_* parts,
      // which in a deployed stack are the superuser's.
      const url = 'postgres://bslt_app:app-password@pgbouncer:5432/app';
      const config = loadDatabaseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: url,
        WORKER_DATABASE_URL: 'postgres://bslt_worker:worker-password@pgbouncer:5432/app',
        LISTEN_DATABASE_URL: 'postgres://bslt_worker:worker-password@postgres:5432/app',
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'superuser-password',
      } as unknown as FullEnv);

      expect(config.connectionString).toBe(url);
      expect(buildConnectionString(config)).toBe(url);
      expect(validateDatabaseConfig(config, true)).toEqual([]);
    });

    test('does not treat a non-Postgres DATABASE_URL as the connection string', () => {
      const config = loadDatabaseConfig({
        DATABASE_URL: 'mysql://user:pw@postgresql.internal:3306/app',
        POSTGRES_HOST: 'db.internal',
      } as unknown as FullEnv);

      expect(config.connectionString).toBeUndefined();
    });

    test('should set readReplicaConnectionString when DATABASE_READ_REPLICA_URL is provided', () => {
      const config = loadDatabaseConfig({
        DATABASE_READ_REPLICA_URL: 'postgresql://replica-host:5432/db',
      } as unknown as FullEnv);

      expect(config.readReplicaConnectionString).toBe('postgresql://replica-host:5432/db');
    });

    test('should not set readReplicaConnectionString when DATABASE_READ_REPLICA_URL is empty', () => {
      const config = loadDatabaseConfig({
        DATABASE_READ_REPLICA_URL: '',
      } as unknown as FullEnv);

      expect(config.readReplicaConnectionString).toBeUndefined();
    });

    test('should not set readReplicaConnectionString when DATABASE_READ_REPLICA_URL is undefined', () => {
      const config = loadDatabaseConfig({} as unknown as FullEnv);

      expect(config.readReplicaConnectionString).toBeUndefined();
    });
  });

  describe('Connection String Utilities', () => {
    test('should redact password for logging', () => {
      const config = loadDatabaseConfig({
        POSTGRES_USER: 'abe',
        POSTGRES_PASSWORD: 'super-secret-password',
        POSTGRES_HOST: 'localhost',
      } as unknown as FullEnv);

      const safe = getSafeConnectionString(config);
      expect(safe).toContain('abe:****@localhost');
      expect(safe).not.toContain('super-secret-password');
    });

    test('should build postgres connection string from parts', () => {
      const config = loadDatabaseConfig({
        POSTGRES_USER: 'user',
        POSTGRES_PASSWORD: 'pass',
        POSTGRES_HOST: 'host',
        POSTGRES_PORT: 5432,
        POSTGRES_DB: 'db',
      } as unknown as FullEnv);

      const result = buildConnectionString(config);
      expect(result).toBe('postgresql://user:pass@host:5432/db');
    });
  });

  describe('validateDatabaseConfig', () => {
    test('requires a Postgres password for discrete production config', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'production',
        POSTGRES_HOST: 'db.internal',
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: '',
      } as unknown as FullEnv);

      expect(validateDatabaseConfig(config, true)).toContain(
        'Database: POSTGRES_PASSWORD is required in production when DATABASE_URL is not set.',
      );
    });

    test('allows explicit non-SSL Postgres for internal production poolers', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'production',
        POSTGRES_HOST: 'pgbouncer',
        POSTGRES_USER: 'bslt_app',
        POSTGRES_PASSWORD: 'production-password',
        WORKER_DATABASE_URL: 'postgresql://bslt_worker:w@pgbouncer:5432/app',
        LISTEN_DATABASE_URL: 'postgresql://bslt_worker:w@postgres:5432/app',
        DB_SSL: 'false',
      } as unknown as FullEnv);

      expect(validateDatabaseConfig(config, true)).toEqual([]);
    });

    test('requires a separate worker connection in production', () => {
      const config = loadDatabaseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://bslt_app:a@db:5432/app',
      } as unknown as FullEnv);

      expect(validateDatabaseConfig(config, true)).toContain(
        'Database: WORKER_DATABASE_URL is required in production (sessionless and background work runs as the worker role; see docs/deploy/env.md#database-roles).',
      );
    });

    test('rejects a worker connection that is just the app connection again', () => {
      const url = 'postgresql://bslt_app:a@db:5432/app';
      const config = loadDatabaseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: url,
        WORKER_DATABASE_URL: url,
      } as unknown as FullEnv);

      const errors = validateDatabaseConfig(config, true);
      expect(errors.some((e) => e.includes('WORKER_DATABASE_URL must use a different role'))).toBe(
        true,
      );
      // The connection string (with its password) is never echoed.
      expect(errors.join('\n')).not.toContain('bslt_app:a@');
    });

    test('does not require the worker connection outside production', () => {
      const config = loadDatabaseConfig({
        DATABASE_URL: 'postgresql://postgres:pw@localhost:5432/app',
      } as unknown as FullEnv);

      expect(validateDatabaseConfig(config, false)).toEqual([]);
    });
  });

  describe('worker connection', () => {
    test('maps WORKER_DATABASE_URL onto the config', () => {
      const config = loadDatabaseConfig({
        WORKER_DATABASE_URL: 'postgresql://bslt_worker:w@db:5432/app',
      } as unknown as FullEnv);

      expect(config.workerConnectionString).toBe('postgresql://bslt_worker:w@db:5432/app');
      expect(buildWorkerConnectionString(config)).toBe('postgresql://bslt_worker:w@db:5432/app');
    });

    test('treats an empty WORKER_DATABASE_URL as unset', () => {
      const config = loadDatabaseConfig({ WORKER_DATABASE_URL: '' } as unknown as FullEnv);
      expect(config.workerConnectionString).toBeUndefined();
    });

    test('falls back to the app connection when no worker URL is configured (dev only)', () => {
      const config = loadDatabaseConfig({
        DATABASE_URL: 'postgresql://postgres:pw@localhost:5432/app',
      } as unknown as FullEnv);

      expect(buildWorkerConnectionString(config)).toBe(buildConnectionString(config));
    });

    test('never keeps the migration (owner) URL in the runtime config', () => {
      const config = loadDatabaseConfig({
        MIGRATION_DATABASE_URL: 'postgresql://bslt_owner:o@db:5432/app',
      } as unknown as FullEnv);

      expect(JSON.stringify(config)).not.toContain('bslt_owner');
    });
  });
  describe('statement and transaction timeouts', () => {
    test('the defaults of the env schema become the limits of the two runtime pools', () => {
      const config = loadDatabaseConfig(DatabaseEnvSchema.parse({}) as unknown as FullEnv);

      expect(config.timeouts).toEqual({
        app: {
          statementTimeoutMs: 30_000,
          lockTimeoutMs: 10_000,
          idleInTransactionTimeoutMs: 60_000,
        },
        // Jobs and backfills run statements a request never should.
        worker: {
          statementTimeoutMs: 120_000,
          lockTimeoutMs: 10_000,
          idleInTransactionTimeoutMs: 60_000,
        },
      });
    });

    test('each env key sets its limit, and 0 turns one off', () => {
      const config = loadDatabaseConfig(
        DatabaseEnvSchema.parse({
          DB_STATEMENT_TIMEOUT_MS: '5000',
          DB_WORKER_STATEMENT_TIMEOUT_MS: '0',
          DB_LOCK_TIMEOUT_MS: '2000',
          DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '15000',
        }) as unknown as FullEnv,
      );

      expect(config.timeouts).toEqual({
        app: { statementTimeoutMs: 5000, lockTimeoutMs: 2000, idleInTransactionTimeoutMs: 15_000 },
        worker: { statementTimeoutMs: 0, lockTimeoutMs: 2000, idleInTransactionTimeoutMs: 15_000 },
      });
    });
  });

  describe('pub/sub (LISTEN) connection', () => {
    const APP = 'postgresql://bslt_app:a@pgbouncer:5432/app';
    const WORKER = 'postgresql://bslt_worker:w@pgbouncer:5432/app';
    const LISTEN = 'postgresql://bslt_worker:w@postgres:5432/app';

    function production(extra: Record<string, string>): ReturnType<typeof loadDatabaseConfig> {
      return loadDatabaseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: APP,
        WORKER_DATABASE_URL: WORKER,
        ...extra,
      } as unknown as FullEnv);
    }

    test('maps LISTEN_DATABASE_URL onto the config', () => {
      const config = loadDatabaseConfig({ LISTEN_DATABASE_URL: LISTEN } as unknown as FullEnv);

      expect(config.listenConnectionString).toBe(LISTEN);
      expect(buildListenConnectionString(config)).toBe(LISTEN);
    });

    test('treats an empty LISTEN_DATABASE_URL as unset', () => {
      const config = loadDatabaseConfig({ LISTEN_DATABASE_URL: '' } as unknown as FullEnv);
      expect(config.listenConnectionString).toBeUndefined();
    });

    test('falls back to the worker connection when unset (outside production)', () => {
      const config = loadDatabaseConfig({
        DATABASE_URL: APP,
        WORKER_DATABASE_URL: WORKER,
      } as unknown as FullEnv);

      expect(buildListenConnectionString(config)).toBe(WORKER);
    });

    test('falls back to the app connection when neither is set (single-role development)', () => {
      const config = loadDatabaseConfig({ DATABASE_URL: APP } as unknown as FullEnv);

      expect(buildListenConnectionString(config)).toBe(APP);
    });

    test('is required in production', () => {
      // A pooled worker URL would pass through PgBouncer, whose pooling does
      // not carry LISTEN, so production does not fall back to it.
      expect(validateDatabaseConfig(production({}), true)).toContain(
        'Database: LISTEN_DATABASE_URL is required in production (the pub/sub listener connects to Postgres directly as the worker role; see docs/deploy/env.md#database-roles).',
      );
      expect(validateDatabaseConfig(production({ LISTEN_DATABASE_URL: LISTEN }), true)).toEqual([]);
    });

    test('must be a connection URL', () => {
      const errors = validateDatabaseConfig(
        production({ LISTEN_DATABASE_URL: 'bslt_worker:w@postgres' }),
        true,
      );

      expect(errors).toContain('Database: LISTEN_DATABASE_URL is not a valid connection URL.');
    });

    test.each([
      ['the app role', 'postgresql://bslt_app:a@postgres:5432/app'],
      ['the superuser', 'postgresql://postgres:superuser-password@postgres:5432/app'],
    ])('must use the worker role, not %s', (_label, url) => {
      const errors = validateDatabaseConfig(production({ LISTEN_DATABASE_URL: url }), true);

      expect(errors).toContain(
        'Database: LISTEN_DATABASE_URL must use the worker role (the user of WORKER_DATABASE_URL).',
      );
      // The connection string (with its password) is never echoed.
      expect(errors.join('\n')).not.toContain(url);
    });
  });
});
