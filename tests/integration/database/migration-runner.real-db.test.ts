// tests/integration/database/migration-runner.real-db.test.ts
/**
 * The migration runner (Real DB)
 *
 * `runMigrations` of `@bslt/db` is the one way a database gets its schema
 * (`pnpm bslt db migrate`, the image's migrate entry, this harness). These
 * tests run it on fixture sources against an empty database, as the owner
 * role, and prove what the unit tests cannot: the order on a real catalog, the
 * transaction per file, the `-- bslt:no-transaction` marker, the advisory lock
 * between two runners, the `sys_migrations` record and the pre-v1 policy (a
 * changed baseline stops the run and names `pnpm bslt db reset`).
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MigrationResetRequiredError,
  resetSchema,
  runMigrations,
  type MigrationSource,
} from '@bslt/db';
import { describeRealDb } from '@bslt/testing/real-db';
import { afterAll, beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;
const quiet = { log: (): void => undefined };

const tempDirs: string[] = [];

/** Write a fixture source: a directory of migration files (and `seeds/`). */
async function fixture(
  id: string,
  dependsOn: readonly string[],
  files: Record<string, string>,
): Promise<MigrationSource> {
  const dir = await mkdtemp(path.join(tmpdir(), `bslt-runner-${id}-`));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return { id, dir, dependsOn };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describeRealDb(
  'The migration runner (Real DB)',
  (realDb) => {
    const run = (sources: readonly MigrationSource[]): ReturnType<typeof runMigrations> =>
      runMigrations({
        connectionString: realDb.database.ownerConnectionString,
        sources,
        logger: quiet,
      });

    const recorded = (): Promise<Array<{ source: string; name: string; checksum: string }>> =>
      realDb.database.ownerDb.raw(
        'SELECT source, name, checksum FROM sys_migrations ORDER BY applied_at, source, name',
      );

    const tables = async (): Promise<string[]> =>
      (
        await realDb.database.adminDb.raw<{ name: string }>(
          `SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
        )
      ).map((row) => row.name);

    // Every test starts on an empty schema.
    beforeEach(async () => {
      await resetSchema(realDb.database.ownerDb);
    }, TEST_TIMEOUT);

    it(
      'applies the kernel first, then the sources in dependency order, then by file number',
      async () => {
        // Each file appends its name, so the table holds the order they ran in.
        const mark = (label: string): string =>
          `INSERT INTO run_order (label) VALUES ('${label}');`;
        const sources = [
          await fixture('tasks', ['identity'], {
            '0001_tasks.sql': mark('tasks/0001'),
          }),
          await fixture('identity', [], {
            '0002_more.sql': mark('identity/0002'),
            '0001_identity.sql': mark('identity/0001'),
          }),
          await fixture('kernel', [], {
            '0001_sys.sql': `CREATE TABLE run_order (id serial PRIMARY KEY, label text NOT NULL); ${mark('kernel/0001')}`,
          }),
          await fixture('audit', ['identity'], {
            '0001_audit.sql': mark('audit/0001'),
          }),
        ];

        const result = await run(sources);

        const order = await realDb.database.ownerDb.raw<{ label: string }>(
          'SELECT label FROM run_order ORDER BY id',
        );
        const expected = [
          'kernel/0001',
          'identity/0001',
          'identity/0002',
          'audit/0001',
          'tasks/0001',
        ];
        expect(order.map((row) => row.label)).toEqual(expected);
        expect(result.applied).toEqual([
          'kernel/0001_sys.sql',
          'identity/0001_identity.sql',
          'identity/0002_more.sql',
          'audit/0001_audit.sql',
          'tasks/0001_tasks.sql',
        ]);
        expect(result.skipped).toEqual([]);
      },
      TEST_TIMEOUT,
    );

    it(
      'records source, name and checksum, and applies nothing the second time',
      async () => {
        const sources = [
          await fixture('kernel', [], {
            '0001_sys.sql': 'CREATE TABLE sys_a (id int);\n',
          }),
          await fixture('tasks', [], {
            '0001_tasks.sql': 'CREATE TABLE tasks_a (id int);\n',
          }),
        ];

        await run(sources);
        const second = await run(sources);

        expect(second.applied).toEqual([]);
        expect(second.skipped).toEqual(['kernel/0001_sys.sql', 'tasks/0001_tasks.sql']);
        const rows = await recorded();
        expect(rows.map((row) => `${row.source}/${row.name}`)).toEqual([
          'kernel/0001_sys.sql',
          'tasks/0001_tasks.sql',
        ]);
        expect(rows.every((row) => /^[0-9a-f]{64}$/u.test(row.checksum))).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      'keeps its record to the migrator: classified internal, no runtime privilege',
      async () => {
        await run([await fixture('kernel', [], { '0001_sys.sql': 'SELECT 1;' })]);

        const [table] = await realDb.database.adminDb.raw<{
          owner: string;
          comment: string | null;
          grantees: string | null;
        }>(
          `SELECT pg_get_userbyid(c.relowner)::text AS owner, obj_description(c.oid, 'pg_class') AS comment,
                  (SELECT string_agg(DISTINCT a.grantee::regrole::text, ',')
                     FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                    WHERE a.grantee <> c.relowner) AS grantees
             FROM pg_class c WHERE c.oid = 'sys_migrations'::regclass`,
        );
        expect(table).toEqual({
          owner: 'bslt_owner',
          comment: 'rls:internal',
          grantees: null,
        });
        await expect(realDb.database.db.raw('SELECT 1 FROM sys_migrations')).rejects.toThrow(
          /permission denied/u,
        );
        await expect(realDb.database.appDb.raw('SELECT 1 FROM sys_migrations')).rejects.toThrow(
          /permission denied/u,
        );
      },
      TEST_TIMEOUT,
    );

    it(
      'runs a file in one transaction: a failure leaves nothing of it and no record',
      async () => {
        const sources = [
          await fixture('kernel', [], {
            '0001_sys.sql': 'CREATE TABLE sys_a (id int);',
            '0002_broken.sql': 'CREATE TABLE sys_b (id int); SELECT 1 / 0;',
            '0003_later.sql': 'CREATE TABLE sys_c (id int);',
          }),
        ];

        await expect(run(sources)).rejects.toThrow(/kernel\/0002_broken\.sql.*division by zero/su);

        expect(await tables()).toEqual(['sys_a', 'sys_migrations']);
        expect((await recorded()).map((row) => row.name)).toEqual(['0001_sys.sql']);
      },
      TEST_TIMEOUT,
    );

    it(
      'runs a file marked bslt:no-transaction statement by statement, outside a transaction',
      async () => {
        const statements = `CREATE TABLE sys_big (id int);
CREATE INDEX CONCURRENTLY idx_sys_big ON sys_big (id);`;
        const marked = await fixture('kernel', [], {
          '0001_sys.sql': `-- 0001_sys.sql\n-- bslt:no-transaction\n${statements}`,
        });

        await run([marked]);

        const indexes = await realDb.database.adminDb.raw<{ valid: boolean }>(
          `SELECT ix.indisvalid AS valid FROM pg_index ix WHERE ix.indexrelid = 'idx_sys_big'::regclass`,
        );
        expect(indexes).toEqual([{ valid: true }]);
        expect((await recorded()).map((row) => row.name)).toEqual(['0001_sys.sql']);

        // Without the marker the same statements cannot run.
        await resetSchema(realDb.database.ownerDb);
        const unmarked = await fixture('kernel', [], {
          '0001_sys.sql': statements,
        });
        await expect(run([unmarked])).rejects.toThrow(/CONCURRENTLY cannot/u);
      },
      TEST_TIMEOUT,
    );

    it(
      'two runners at once apply each file once',
      async () => {
        const sources = [
          await fixture('kernel', [], {
            // No IF NOT EXISTS: a second application fails.
            '0001_sys.sql': 'CREATE TABLE sys_once (id int); SELECT pg_sleep(0.5);',
            '0002_more.sql': 'CREATE TABLE sys_twice (id int);',
          }),
        ];

        const results = await Promise.all([run(sources), run(sources)]);

        const applied = results.map((result) => result.applied.length).sort();
        expect(applied).toEqual([0, 2]);
        expect((await recorded()).map((row) => row.name)).toEqual([
          '0001_sys.sql',
          '0002_more.sql',
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'stops on a baseline that changed after it was applied, and says to reset',
      async () => {
        const kernel = await fixture('kernel', [], {
          '0001_sys.sql': 'CREATE TABLE sys_a (id int);',
        });
        await run([kernel]);
        await writeFile(path.join(kernel.dir, '0001_sys.sql'), 'CREATE TABLE sys_a (id bigint);');
        await writeFile(path.join(kernel.dir, '0002_more.sql'), 'CREATE TABLE sys_b (id int);');

        const failure = await run([kernel]).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(MigrationResetRequiredError);
        const message = (failure as Error).message;
        expect(message).toContain('kernel/0001_sys.sql changed after it was applied');
        expect(message).toContain('run: pnpm bslt db reset');
        // Nothing was applied on top of the stale baseline.
        expect(await tables()).toEqual(['sys_a', 'sys_migrations']);
      },
      TEST_TIMEOUT,
    );

    it(
      'stops when a recorded file is gone, or a new file sorts before an applied one',
      async () => {
        const kernel = await fixture('kernel', [], {
          '0001_sys.sql': 'CREATE TABLE sys_a (id int);',
          '0003_c.sql': 'CREATE TABLE sys_c (id int);',
        });
        await run([kernel]);

        await writeFile(path.join(kernel.dir, '0002_b.sql'), 'CREATE TABLE sys_b (id int);');
        const inserted = await run([kernel]).catch((error: unknown) => error);
        expect(inserted).toBeInstanceOf(MigrationResetRequiredError);
        expect((inserted as Error).message).toContain(
          'kernel/0002_b.sql is new but sorts before kernel/0003_c.sql, which is applied',
        );

        await rm(path.join(kernel.dir, '0002_b.sql'));
        await rm(path.join(kernel.dir, '0003_c.sql'));
        const removed = await run([kernel]).catch((error: unknown) => error);
        expect(removed).toBeInstanceOf(MigrationResetRequiredError);
        expect((removed as Error).message).toContain(
          'kernel/0003_c.sql is recorded as applied but is not in the sources',
        );
      },
      TEST_TIMEOUT,
    );

    it(
      'refuses a database that holds tables it has no record of',
      async () => {
        // What a database built by the 0000..0926 chain looks like to this runner.
        await realDb.database.ownerDb.raw('CREATE TABLE users (id int)');
        const kernel = await fixture('kernel', [], {
          '0001_sys.sql': 'CREATE TABLE sys_a (id int);',
        });

        const failure = await run([kernel]).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(MigrationResetRequiredError);
        expect((failure as Error).message).toContain(
          'the database has tables (users) but no migration record',
        );
        expect((failure as Error).message).toContain('run: pnpm bslt db reset');
        expect(await tables()).toEqual(['users']);
      },
      TEST_TIMEOUT,
    );

    it(
      'applies required seeds after the migrations, and again only when a seed changed',
      async () => {
        const seed = (title: string): string =>
          `INSERT INTO docs (slug, title) VALUES ('tos', '${title}')
           ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title;`;
        const compliance = await fixture('compliance', [], {
          '0001_compliance.sql': 'CREATE TABLE docs (slug text PRIMARY KEY, title text NOT NULL);',
          'seeds/0001_docs.sql': seed('Terms'),
        });
        const titles = async (): Promise<string[]> =>
          (await realDb.database.ownerDb.raw<{ title: string }>('SELECT title FROM docs')).map(
            (row) => row.title,
          );

        const first = await run([compliance]);
        expect(first.applied).toEqual([
          'compliance/0001_compliance.sql',
          'compliance/seeds/0001_docs.sql',
        ]);
        expect(await titles()).toEqual(['Terms']);

        // Unchanged: not applied again, even though a row was edited by hand.
        await realDb.database.ownerDb.raw(`UPDATE docs SET title = 'Edited'`);
        const second = await run([compliance]);
        expect(second.applied).toEqual([]);
        expect(await titles()).toEqual(['Edited']);

        // Changed: a seed is idempotent, so it is applied again instead of stopping the run.
        await writeFile(path.join(compliance.dir, 'seeds/0001_docs.sql'), seed('Terms v2'));
        const third = await run([compliance]);
        expect(third.applied).toEqual(['compliance/seeds/0001_docs.sql']);
        expect(await titles()).toEqual(['Terms v2']);
        expect((await recorded()).map((row) => row.name)).toEqual([
          '0001_compliance.sql',
          'seeds/0001_docs.sql',
        ]);
      },
      TEST_TIMEOUT,
    );

    it(
      'resetSchema empties the database and leaves the schema as a new database has it',
      async () => {
        const schema = (): Promise<Array<{ owner: string; acl: string }>> =>
          realDb.database.adminDb.raw(
            `SELECT pg_get_userbyid(n.nspowner)::text AS owner,
                    (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                                       || ':' || a.privilege_type, ','
                                       ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type) COLLATE "C")
                       FROM aclexplode(n.nspacl) a) AS acl
               FROM pg_namespace n WHERE n.nspname = 'public'`,
          );
        const kernel = await fixture('kernel', [], {
          '0001_sys.sql': `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            CREATE TYPE sys_kind AS ENUM ('a');
            CREATE TABLE sys_a (id uuid DEFAULT uuid_generate_v4(), kind sys_kind);
            CREATE FUNCTION sys_f() RETURNS int LANGUAGE sql AS 'SELECT 1';`,
        });
        await run([kernel]);

        await resetSchema(realDb.database.ownerDb);

        expect(await tables()).toEqual([]);
        expect(await schema()).toEqual([
          {
            owner: 'pg_database_owner',
            acl: 'PUBLIC:USAGE,pg_database_owner:CREATE,pg_database_owner:USAGE',
          },
        ]);
        // And the same sources build it again.
        expect((await run([kernel])).applied).toEqual(['kernel/0001_sys.sql']);
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);
