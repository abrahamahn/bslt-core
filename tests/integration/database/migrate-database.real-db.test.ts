// tests/integration/database/migrate-database.real-db.test.ts
/**
 * `bslt db migrate`, `bslt db reset` and the image's migrate entry (Real DB)
 *
 * All three are `migrateDatabase` / `resetDatabase` of `@bslt/db` on the
 * repository's own sources: the kernel baseline and one legacy baseline per
 * owner. These tests run them against a database the harness built with the
 * same runner, as the owner role, the way a deploy does
 * (`MIGRATION_DATABASE_URL`).
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import {
  migrateDatabase,
  migrationSources,
  readSourceFiles,
  resetDatabase,
  RESET_REQUIRED_EXIT_CODE,
  runMigrateEntry,
} from '@bslt/db';
import { describeRealDb } from '@bslt/testing/real-db';
import { expect, it } from 'vitest';

const TEST_TIMEOUT = 120_000;
const quiet = { log: (): void => undefined };

describeRealDb('bslt db migrate, bslt db reset and the migrate entry (Real DB)', (realDb) => {
  const ownerEnv = (): Record<string, string> => ({
    NODE_ENV: 'production',
    MIGRATION_DATABASE_URL: realDb.database.ownerConnectionString,
  });

  const allFiles = async (): Promise<string[]> => {
    const files: string[] = [];
    for (const source of migrationSources()) {
      const { migrations, seeds } = await readSourceFiles(source);
      files.push(...[...migrations, ...seeds].map((file) => `${file.source}/${file.name}`));
    }
    return files.sort();
  };

  const count = async (table: string): Promise<number> =>
    Number(
      (
        await realDb.database.adminDb.raw<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${table}`,
        )
      )[0]?.count,
    );

  it(
    'migrate on an up-to-date database applies nothing',
    async () => {
      const result = await migrateDatabase({
        env: ownerEnv(),
        logger: quiet,
      });

      expect(result.applied).toEqual([]);
      expect([...result.skipped].sort()).toEqual(await allFiles());
    },
    TEST_TIMEOUT,
  );

  it(
    'migrate needs the owner connection in production',
    async () => {
      await expect(
        migrateDatabase({ env: { NODE_ENV: 'production' }, logger: quiet }),
      ).rejects.toThrow('MIGRATION_DATABASE_URL is required in production');
    },
    TEST_TIMEOUT,
  );

  it(
    'the entry exits 0 when the database is up to date',
    async () => {
      const errors: string[] = [];

      const code = await runMigrateEntry({
        env: ownerEnv(),
        logger: quiet,
        error: (message) => errors.push(message),
      });

      expect({ code, errors }).toEqual({ code: 0, errors: [] });
    },
    TEST_TIMEOUT,
  );

  it(
    'the entry exits 1 with the message, and no connection string, when the database cannot be reached',
    async () => {
      const errors: string[] = [];
      const url = new URL(realDb.database.ownerConnectionString);
      url.password = 'not-the-password-0123456789';

      const code = await runMigrateEntry({
        env: {
          NODE_ENV: 'production',
          MIGRATION_DATABASE_URL: url.toString(),
        },
        logger: quiet,
        error: (message) => errors.push(message),
      });

      expect(code).toBe(1);
      expect(errors.join('\n')).toMatch(/^Migration failed: .*password authentication failed/su);
      expect(errors.join('\n')).not.toContain('not-the-password-0123456789');
    },
    TEST_TIMEOUT,
  );

  it(
    'reset refuses to run in production',
    async () => {
      await expect(resetDatabase({ env: ownerEnv(), logger: quiet })).rejects.toThrow(
        'bslt db reset drops every table: it does not run with NODE_ENV=production',
      );
      expect(await count('compliance_legal_documents')).toBe(5);
    },
    TEST_TIMEOUT,
  );

  // Last: these change the suite's database.
  it(
    'a database built from an edited baseline: the entry exits with the reset code, reset rebuilds it',
    async () => {
      const users = await count('identity_users');
      await realDb.database.adminDb.raw(
        `INSERT INTO identity_users (email, canonical_email) VALUES ('kept@example.com', 'kept@example.com')`,
      );
      // What editing the kernel baseline after it was applied looks like.
      await realDb.database.ownerDb.raw(
        `UPDATE sys_migrations SET checksum = 'stale' WHERE source = 'kernel' AND name = '0001_sys.sql'`,
      );
      const errors: string[] = [];

      const code = await runMigrateEntry({
        env: ownerEnv(),
        logger: quiet,
        error: (message) => errors.push(message),
      });

      expect(code).toBe(RESET_REQUIRED_EXIT_CODE);
      expect(RESET_REQUIRED_EXIT_CODE).toBe(3);
      expect(errors.join('\n')).toContain('kernel/0001_sys.sql changed after it was applied');
      expect(errors.join('\n')).toContain('run: pnpm bslt db reset');
      // Nothing was touched.
      expect(await count('identity_users')).toBe(users + 1);

      const devEnv = { ...ownerEnv(), NODE_ENV: 'development' };
      const rebuilt = await resetDatabase({ env: devEnv, logger: quiet });

      expect([...rebuilt.applied].sort()).toEqual(await allFiles());
      expect(await count('identity_users')).toBe(0);
      // The required seeds are back with the schema.
      expect(await count('compliance_legal_documents')).toBe(5);
      expect((await migrateDatabase({ env: devEnv, logger: quiet })).applied).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
