// main/tools/scripts/db/migrate.test.ts
/**
 * `bslt db migrate` and `bslt db reset` delegate to the runner of `@bslt/db`
 * (the same code the image's migrate entry runs), after the env files are
 * loaded. What the runner does is proven against a real database in
 * tests/integration/database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initEnv, migrateDatabase, resetDatabase, seed, order } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    order: calls,
    initEnv: vi.fn(async () => {
      calls.push('initEnv');
    }),
    migrateDatabase: vi.fn(async () => {
      calls.push('migrateDatabase');
      return { applied: ['kernel/0001_sys.sql'], skipped: [] };
    }),
    resetDatabase: vi.fn(async () => {
      calls.push('resetDatabase');
      return { applied: ['kernel/0001_sys.sql'], skipped: [] };
    }),
    seed: vi.fn(async () => {
      calls.push('seed');
    }),
  };
});

vi.mock('@bslt/db', () => ({ migrateDatabase, resetDatabase }));
vi.mock('@bslt/server-system/config', () => ({ initEnv }));
vi.mock('./seed', () => ({ seed }));

import { migrate } from './migrate';
import { reset } from './reset';

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
});

describe('bslt db migrate', () => {
  it('loads the env files, then runs the runner of @bslt/db on its own sources', async () => {
    await migrate();

    expect(order).toEqual(['initEnv', 'migrateDatabase']);
    expect(migrateDatabase).toHaveBeenCalledWith();
  });

  it('lets a failure through, so the command exits non-zero with its message', async () => {
    migrateDatabase.mockRejectedValueOnce(new Error('run: pnpm bslt db reset'));

    await expect(migrate()).rejects.toThrow('run: pnpm bslt db reset');
  });
});

describe('bslt db reset', () => {
  it('rebuilds the database from the baselines, then seeds the development users', async () => {
    await reset({ force: true });

    expect(order).toEqual(['initEnv', 'resetDatabase', 'seed']);
    expect(resetDatabase).toHaveBeenCalledWith();
    expect(seed).toHaveBeenCalledWith({ closeConnection: true });
  });

  it('does not seed when the rebuild failed', async () => {
    resetDatabase.mockRejectedValueOnce(new Error('does not run with NODE_ENV=production'));

    await expect(reset({ force: true })).rejects.toThrow('does not run with NODE_ENV=production');
    expect(seed).not.toHaveBeenCalled();
  });

  it('asks before it drops anything, and stops on any answer but y', async () => {
    const confirm = vi.fn(async () => false);

    await reset({ confirm });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('DROP every table'));
    expect(order).toEqual(['initEnv']);
  });
});
