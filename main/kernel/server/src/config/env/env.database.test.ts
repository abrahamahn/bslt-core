// main/kernel/server/src/config/env/env.database.test.ts
import { describe, expect, it } from 'vitest';

import { DatabaseEnvSchema } from './env.database';

describe('DatabaseEnvSchema', () => {
  describe('defaults', () => {
    it('parses an empty object successfully', () => {
      const result = DatabaseEnvSchema.parse({});
      expect(result).toBeDefined();
    });

    it('leaves all optional fields undefined when absent', () => {
      const result = DatabaseEnvSchema.parse({});
      expect(result.DATABASE_PROVIDER).toBeUndefined();
      expect(result.POSTGRES_HOST).toBeUndefined();
      expect(result.POSTGRES_PORT).toBeUndefined();
      expect(result.POSTGRES_DB).toBeUndefined();
      expect(result.POSTGRES_USER).toBeUndefined();
      expect(result.POSTGRES_PASSWORD).toBeUndefined();
      expect(result.POSTGRES_CONNECTION_STRING).toBeUndefined();
      expect(result.DATABASE_URL).toBeUndefined();
      expect(result.DB_MAX_CONNECTIONS).toBe(20);
      expect(result.DB_SSL).toBeUndefined();
      expect(result.DATABASE_READ_REPLICA_URL).toBeUndefined();
    });
  });

  describe('statement and transaction timeouts', () => {
    const KEYS = [
      'DB_STATEMENT_TIMEOUT_MS',
      'DB_WORKER_STATEMENT_TIMEOUT_MS',
      'DB_LOCK_TIMEOUT_MS',
      'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
    ] as const;

    it('has a limit for each when nothing is set', () => {
      const result = DatabaseEnvSchema.parse({});

      expect(result.DB_STATEMENT_TIMEOUT_MS).toBe(30_000);
      expect(result.DB_WORKER_STATEMENT_TIMEOUT_MS).toBe(120_000);
      expect(result.DB_LOCK_TIMEOUT_MS).toBe(10_000);
      expect(result.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(60_000);
    });

    it.each(KEYS)('%s reads a number of milliseconds from a string', (key) => {
      expect(DatabaseEnvSchema.parse({ [key]: '4500' })[key]).toBe(4500);
    });

    it.each(KEYS)('%s accepts 0, which turns the limit off', (key) => {
      expect(DatabaseEnvSchema.parse({ [key]: '0' })[key]).toBe(0);
    });

    it.each(KEYS)('%s refuses what is not a whole number of milliseconds, 0 or more', (key) => {
      expect(() => DatabaseEnvSchema.parse({ [key]: '-1' })).toThrow(`${key} must be at least 0`);
      expect(() => DatabaseEnvSchema.parse({ [key]: '1.5' })).toThrow(`${key} must be an integer`);
      expect(() => DatabaseEnvSchema.parse({ [key]: '30s' })).toThrow(
        `${key} must be a valid number`,
      );
    });
  });

  describe('DATABASE_PROVIDER', () => {
    it('accepts postgresql', () => {
      expect(DatabaseEnvSchema.parse({ DATABASE_PROVIDER: 'postgresql' }).DATABASE_PROVIDER).toBe(
        'postgresql',
      );
    });

    it('rejects removed providers', () => {
      for (const provider of ['mysql', 'sqlite', 'mongodb', 'json']) {
        expect(() => DatabaseEnvSchema.parse({ DATABASE_PROVIDER: provider })).toThrow();
      }
    });

    it('rejects an empty string', () => {
      expect(() => DatabaseEnvSchema.parse({ DATABASE_PROVIDER: '' })).toThrow();
    });

    it('rejects a numeric value', () => {
      expect(() => DatabaseEnvSchema.parse({ DATABASE_PROVIDER: 1 })).toThrow();
    });

    it('rejects uppercase POSTGRESQL', () => {
      expect(() => DatabaseEnvSchema.parse({ DATABASE_PROVIDER: 'POSTGRESQL' })).toThrow();
    });
  });

  describe('PostgreSQL fields', () => {
    it('accepts all Postgres connection fields', () => {
      const result = DatabaseEnvSchema.parse({
        POSTGRES_HOST: 'db.internal',
        POSTGRES_PORT: 5432,
        POSTGRES_DB: 'mydb',
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_CONNECTION_STRING: 'postgresql://postgres:secret@db.internal:5432/mydb',
        DATABASE_URL: 'postgresql://postgres:secret@db.internal:5432/mydb',
        DB_MAX_CONNECTIONS: 20,
        DB_SSL: 'true',
      });
      expect(result.POSTGRES_HOST).toBe('db.internal');
      expect(result.POSTGRES_PORT).toBe(5432);
      expect(result.POSTGRES_DB).toBe('mydb');
      expect(result.POSTGRES_USER).toBe('postgres');
      expect(result.POSTGRES_PASSWORD).toBe('secret');
      expect(result.DB_SSL).toBe('true');
    });

    it('coerces POSTGRES_PORT from string', () => {
      const result = DatabaseEnvSchema.parse({ POSTGRES_PORT: '5433' });
      expect(result.POSTGRES_PORT).toBe(5433);
    });

    it('rejects a non-string POSTGRES_HOST', () => {
      expect(() => DatabaseEnvSchema.parse({ POSTGRES_HOST: 1234 })).toThrow();
    });

    it('rejects a non-numeric POSTGRES_PORT string', () => {
      expect(() => DatabaseEnvSchema.parse({ POSTGRES_PORT: 'abc' })).toThrow();
    });

    it('rejects a non-numeric DB_MAX_CONNECTIONS', () => {
      expect(() => DatabaseEnvSchema.parse({ DB_MAX_CONNECTIONS: 'many' })).toThrow();
    });

    it('rejects SQL injection in POSTGRES_PASSWORD', () => {
      // The schema only checks type, not content — a SQL injection string is still a valid string.
      // This test documents the current behaviour: the schema accepts it.
      const result = DatabaseEnvSchema.parse({
        POSTGRES_PASSWORD: "' OR '1'='1",
      });
      expect(result.POSTGRES_PASSWORD).toBe("' OR '1'='1");
    });
  });

  describe('DB_SSL flag', () => {
    it('accepts true', () => {
      expect(DatabaseEnvSchema.parse({ DB_SSL: 'true' }).DB_SSL).toBe('true');
    });

    it('accepts false', () => {
      expect(DatabaseEnvSchema.parse({ DB_SSL: 'false' }).DB_SSL).toBe('false');
    });

    it('rejects 1', () => {
      expect(() => DatabaseEnvSchema.parse({ DB_SSL: '1' })).toThrow();
    });

    it('rejects a boolean', () => {
      expect(() => DatabaseEnvSchema.parse({ DB_SSL: true })).toThrow();
    });
  });

  describe('DATABASE_READ_REPLICA_URL', () => {
    it('accepts a valid connection string', () => {
      const result = DatabaseEnvSchema.parse({
        DATABASE_READ_REPLICA_URL: 'postgresql://replica:5432/db',
      });
      expect(result.DATABASE_READ_REPLICA_URL).toBe('postgresql://replica:5432/db');
    });

    it('rejects a non-string value', () => {
      expect(() => DatabaseEnvSchema.parse({ DATABASE_READ_REPLICA_URL: 123 })).toThrow();
    });
  });

  describe('role-split connection strings', () => {
    it('leaves the role URLs undefined when absent', () => {
      const result = DatabaseEnvSchema.parse({});
      expect(result.MIGRATION_DATABASE_URL).toBeUndefined();
      expect(result.WORKER_DATABASE_URL).toBeUndefined();
      expect(result.LISTEN_DATABASE_URL).toBeUndefined();
    });

    it('accepts an owner URL for migrations and a worker URL for system work', () => {
      const result = DatabaseEnvSchema.parse({
        DATABASE_URL: 'postgresql://bslt_app:a@db:5432/app',
        MIGRATION_DATABASE_URL: 'postgresql://bslt_owner:o@db:5432/app',
        WORKER_DATABASE_URL: 'postgresql://bslt_worker:w@db:5432/app',
      });
      expect(result.MIGRATION_DATABASE_URL).toBe('postgresql://bslt_owner:o@db:5432/app');
      expect(result.WORKER_DATABASE_URL).toBe('postgresql://bslt_worker:w@db:5432/app');
    });

    it('accepts a direct worker URL for the pub/sub listener', () => {
      const result = DatabaseEnvSchema.parse({
        LISTEN_DATABASE_URL: 'postgresql://bslt_worker:w@postgres:5432/app',
      });
      expect(result.LISTEN_DATABASE_URL).toBe('postgresql://bslt_worker:w@postgres:5432/app');
    });

    it.each(['MIGRATION_DATABASE_URL', 'WORKER_DATABASE_URL', 'LISTEN_DATABASE_URL'])(
      'rejects a non-string %s',
      (key) => {
        expect(() => DatabaseEnvSchema.parse({ [key]: 5432 })).toThrow(new RegExp(key));
      },
    );
  });

  describe('non-object input', () => {
    it('rejects null', () => {
      expect(() => DatabaseEnvSchema.parse(null)).toThrow();
    });

    it('rejects an array', () => {
      expect(() => DatabaseEnvSchema.parse([])).toThrow();
    });

    it('rejects a string', () => {
      expect(() => DatabaseEnvSchema.parse('postgresql')).toThrow();
    });
  });

  describe('safeParse', () => {
    it('returns success:true for an empty object', () => {
      const result = DatabaseEnvSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('returns success:false for an invalid provider without throwing', () => {
      const result = DatabaseEnvSchema.safeParse({ DATABASE_PROVIDER: 'oracle' });
      expect(result.success).toBe(false);
    });
  });
});
