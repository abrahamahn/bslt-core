// main/kernel/db/src/migrate/database.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runMigrations, resetSchema, close, createRawDb } = vi.hoisted(() => {
  const close = vi.fn(async () => undefined);
  return {
    runMigrations: vi.fn(),
    resetSchema: vi.fn(async () => undefined),
    close,
    createRawDb: vi.fn(() => ({ close })),
  };
});

vi.mock('./runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runner')>()),
  runMigrations,
  resetSchema,
}));

vi.mock('../client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client')>()),
  createRawDb,
}));

import {
  migrateDatabase,
  RESET_REQUIRED_EXIT_CODE,
  resetDatabase,
  runMigrateEntry,
} from './database';
import { MigrationResetRequiredError } from './runner';
import { loadLockedMigrationChecksums, migrationSources } from './sources';

const OWNER_URL = 'postgresql://bslt_owner:secret@db.internal:5432/bslt';
const silent = { log: (): void => undefined };

beforeEach(() => {
  vi.clearAllMocks();
  runMigrations.mockResolvedValue({ applied: [], skipped: [] });
});

describe('migrateDatabase', () => {
  it('runs the sources of this repository through the owner connection', async () => {
    await migrateDatabase({ env: { MIGRATION_DATABASE_URL: OWNER_URL }, logger: silent });

    const lockedChecksums = loadLockedMigrationChecksums();
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(runMigrations).toHaveBeenCalledWith({
      connectionString: OWNER_URL,
      sources: migrationSources(),
      logger: silent,
      ...(lockedChecksums !== undefined ? { lockedChecksums } : {}),
    });
  });

  it('refuses in production without the owner connection, before any connection is opened', async () => {
    await expect(
      migrateDatabase({ env: { NODE_ENV: 'production' }, logger: silent }),
    ).rejects.toThrow('MIGRATION_DATABASE_URL is required in production');

    expect(runMigrations).not.toHaveBeenCalled();
  });
});

describe('resetDatabase', () => {
  it('drops nothing with NODE_ENV=production', async () => {
    await expect(
      resetDatabase({
        env: { NODE_ENV: 'production', MIGRATION_DATABASE_URL: OWNER_URL },
        logger: silent,
      }),
    ).rejects.toThrow('does not run with NODE_ENV=production');

    expect(createRawDb).not.toHaveBeenCalled();
    expect(resetSchema).not.toHaveBeenCalled();
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('empties the database on one owner connection, closes it, then migrates', async () => {
    const order: string[] = [];
    resetSchema.mockImplementation(async () => {
      order.push('reset');
    });
    close.mockImplementation(async () => {
      order.push('close');
    });
    runMigrations.mockImplementation(async () => {
      order.push('migrate');
      return { applied: ['kernel/0001_sys.sql'], skipped: [] };
    });

    const result = await resetDatabase({
      env: { MIGRATION_DATABASE_URL: OWNER_URL },
      logger: silent,
    });

    expect(createRawDb).toHaveBeenCalledWith({ connectionString: OWNER_URL, maxConnections: 1 });
    expect(order).toEqual(['reset', 'close', 'migrate']);
    expect(result.applied).toEqual(['kernel/0001_sys.sql']);
  });

  it('closes its connection and does not migrate when the drop fails', async () => {
    resetSchema.mockRejectedValue(new Error('must be owner of schema public'));

    await expect(
      resetDatabase({ env: { MIGRATION_DATABASE_URL: OWNER_URL }, logger: silent }),
    ).rejects.toThrow('must be owner of schema public');

    expect(close).toHaveBeenCalledTimes(1);
    expect(runMigrations).not.toHaveBeenCalled();
  });
});

describe('runMigrateEntry', () => {
  const env = { MIGRATION_DATABASE_URL: OWNER_URL };

  it('exits 0 when the database is migrated or up to date', async () => {
    const error = vi.fn();

    expect(await runMigrateEntry({ env, logger: silent, error })).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it('exits 3 with the reasons when the database was built from other baselines', async () => {
    runMigrations.mockRejectedValue(
      new MigrationResetRequiredError(['identity/0001_identity.sql changed since it was applied']),
    );
    const error = vi.fn();

    expect(await runMigrateEntry({ env, logger: silent, error })).toBe(RESET_REQUIRED_EXIT_CODE);
    expect(RESET_REQUIRED_EXIT_CODE).toBe(3);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain(
      'identity/0001_identity.sql changed since it was applied',
    );
  });

  it('exits 1 and writes the message of a failure, never the error object', async () => {
    const failure = Object.assign(new Error('relation "users" already exists'), {
      connectionString: OWNER_URL,
    });
    runMigrations.mockRejectedValue(failure);
    const error = vi.fn();

    expect(await runMigrateEntry({ env, logger: silent, error })).toBe(1);
    expect(error.mock.calls).toEqual([['Migration failed: relation "users" already exists']]);
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
  });

  it('exits 1 without a message of its own for a failure that is not an Error', async () => {
    runMigrations.mockRejectedValue('boom');
    const error = vi.fn();

    expect(await runMigrateEntry({ env, logger: silent, error })).toBe(1);
    expect(error.mock.calls).toEqual([['Migration failed: unknown error']]);
  });
});
