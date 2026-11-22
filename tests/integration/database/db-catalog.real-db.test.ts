// tests/integration/database/db-catalog.real-db.test.ts
/**
 * The database catalog (Real DB)
 *
 * `main/server/db/catalog.snapshot.json` records what the migration sources
 * build, and which source built it: tables, columns, constraints, indexes,
 * policies with their text, grants, the `rls:<class>` comments, functions and
 * roles. `pnpm bslt db catalog` computes it by applying the sources one at a
 * time to a scratch database. This suite is that computation in the real-DB
 * lane (`bslt gate merge` has no database and reads the committed file):
 *
 * - the catalog computed from the sources equals the committed one byte for
 *   byte, with no attribution problem and a clean audit;
 * - a database built in one go holds the same catalog;
 * - a source that alters or drops another source's object is reported;
 * - two reads are byte-identical, whichever role reads;
 * - a change to the schema (a column, a policy, a grant, FORCE, an index, a
 *   function, the class comment) shows in the catalog.
 *
 * When the first test fails after a baseline changed: read the difference it
 * prints, then run `pnpm bslt db catalog` and `pnpm bslt sync rows` and commit
 * the files with the change (docs/dev/workflow.md, "Oracle snapshots").
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describeRealDb } from '@bslt/testing/real-db';
import { withoutAttribution } from '@bslt/tools/catalog/attribute';
import { auditCatalog } from '@bslt/tools/catalog/audit';
import { buildCatalog } from '@bslt/tools/catalog/build';
import { DB_CATALOG, loadCatalog, serializeCatalog } from '@bslt/tools/catalog/file';
import { readDbCatalog, type CatalogConnection } from '@bslt/tools/catalog/read';
import { checkSnapshot, diffLines } from '@bslt/tools/snapshot/snapshot-file';
import { afterAll, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

/** The bytes two readings are compared by. */
async function readDbCatalogSnapshot(db: CatalogConnection): Promise<string> {
  return `${JSON.stringify(await readDbCatalog(db), null, 2)}\n`;
}

interface CatalogFile {
  readonly tables: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
    readonly comment: string | null;
    readonly partition: { readonly key: string; readonly default: string | null } | null;
    readonly policies: ReadonlyArray<{ readonly name: string; readonly using: string | null }>;
    readonly grants: readonly string[];
  }>;
  readonly roles: ReadonlyArray<{ readonly name: string; readonly memberOf: readonly string[] }>;
}

/** The changed lines of a diff, as `+ <content>` and `- <content>` without indentation. */
function changes(before: string, after: string): string[] {
  return diffLines(before, after, 1000)
    .filter((line) => !line.startsWith('@@'))
    .map((line) => `${line.slice(0, 1)} ${line.slice(2).trim().replace(/,$/u, '')}`);
}

describeRealDb(
  'The database catalog, computed source by source (Real DB)',
  (realDb) => {
    it(
      'the catalog computed from the migration sources equals the committed one',
      async () => {
        // The suite's database is empty: the sources are applied to it one at a time.
        const { catalog, problems } = await buildCatalog({ database: realDb.database });

        expect(problems).toEqual([]);
        expect(auditCatalog(catalog)).toEqual([]);
        const result = checkSnapshot(DB_CATALOG, serializeCatalog(catalog));
        // The problems are the difference and how to update the catalog on purpose.
        expect(result.problems ?? []).toEqual([]);
        expect(result.ok).toBe(true);
      },
      TEST_TIMEOUT,
    );

    it(
      'every table, type and function is attributed to the source whose file creates it',
      () => {
        const catalog = loadCatalog();
        const sourceOf = (
          kind: 'tables' | 'types' | 'functions',
          name: string,
        ): string | undefined => catalog[kind].find((entry) => entry.name === name)?.source;

        const sourceIds = new Set(catalog.sources.map((source) => source.id));
        expect(catalog.sources[0]).toEqual({ id: 'kernel', dependsOn: [] });
        expect(sourceIds.has('identity')).toBe(true);
        expect(sourceIds.has('audit')).toBe(true);
        // The runner creates its record table while it applies the kernel.
        expect(sourceOf('tables', 'sys_migrations')).toBe('kernel');
        expect(sourceOf('tables', 'sys_jobs')).toBe('kernel');
        expect(sourceOf('tables', 'identity_users')).toBe('identity');
        expect(sourceOf('tables', 'audit_log')).toBe('audit');
        expect(sourceOf('functions', 'sys_current_user_id()')).toBe('kernel');
        if (sourceIds.has('orgs')) {
          expect(sourceOf('tables', 'orgs_members')).toBe('orgs');
          expect(sourceOf('types', 'orgs_role')).toBe('orgs');
          expect(sourceOf('functions', 'orgs_current_user_role(_org_id uuid)')).toBe('orgs');
        }
        if (sourceIds.has('tasks')) {
          expect(sourceOf('tables', 'tasks')).toBe('tasks');
        }
        expect(
          [...catalog.tables, ...catalog.types, ...catalog.functions].filter(
            (entry) => !catalog.sources.some((source) => source.id === entry.source),
          ),
        ).toEqual([]);
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);

describeRealDb(
  'Catalog attribution of sources that reach into each other (Real DB)',
  (realDb) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bslt-catalog-sources-'));

    afterAll(() => {
      rmSync(directory, { recursive: true, force: true });
    });

    function source(id: string, dependsOn: readonly string[], sql: string) {
      const dir = path.join(directory, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `0001_${id}.sql`), sql);
      return { id, dir, dependsOn };
    }

    it(
      'reports a source that alters and one that drops what another source created',
      async () => {
        const sources = [
          source(
            'kernel',
            [],
            `CREATE TABLE notes (id uuid PRIMARY KEY, body text);
             CREATE FUNCTION notes_count() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM notes';
             CREATE TABLE scratch (id uuid PRIMARY KEY);`,
          ),
          source(
            'labels',
            [],
            `CREATE TABLE labels (id uuid PRIMARY KEY, note_id uuid REFERENCES notes(id));
             ALTER TABLE notes ADD COLUMN label_count integer NOT NULL DEFAULT 0;
             CREATE INDEX idx_notes_label_count ON notes (label_count);
             CREATE OR REPLACE FUNCTION notes_count() RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';`,
          ),
          source('purge', ['labels'], `DROP TABLE scratch;`),
        ];

        const { catalog, problems } = await buildCatalog({ database: realDb.database, sources });

        expect(problems).toEqual([
          'labels alters function public.notes_count(), which kernel created (bodySha256): a source changes only its own objects',
          'labels alters table public.notes, which kernel created (columns, indexes): a source changes only its own objects',
          'purge drops table public.scratch, which kernel created: a source drops only its own objects',
        ]);
        expect(
          Object.fromEntries(catalog.tables.map((table) => [table.name, table.source])),
        ).toEqual({ labels: 'labels', notes: 'kernel', sys_migrations: 'kernel' });
        // None of the three is classified, and that is reported per table.
        expect(auditCatalog(catalog, {})).toEqual(
          expect.arrayContaining([
            'table public.labels: no row-level security class (comment: null); classify it with sys_apply_rls',
          ]),
        );
      },
      TEST_TIMEOUT,
    );
  },
  { migrate: false },
);

describeRealDb('The catalog of a database built in one go (Real DB)', (realDb) => {
  it(
    'equals the committed catalog without its attribution',
    async () => {
      const committed = `${JSON.stringify(withoutAttribution(loadCatalog()), null, 2)}\n`;

      expect(diffLines(committed, await readDbCatalogSnapshot(realDb.database.adminDb))).toEqual(
        [],
      );
    },
    TEST_TIMEOUT,
  );

  it(
    'two reads are byte-identical, whichever role reads the catalog',
    async () => {
      const asAdmin = await readDbCatalogSnapshot(realDb.database.adminDb);

      expect(await readDbCatalogSnapshot(realDb.database.adminDb)).toBe(asAdmin);
      expect(await readDbCatalogSnapshot(realDb.database.ownerDb)).toBe(asAdmin);
      expect(await readDbCatalogSnapshot(realDb.database.appDb)).toBe(asAdmin);
    },
    TEST_TIMEOUT,
  );

  it(
    'records classes, policies, grants and roles, and leaves the dated partitions out',
    async () => {
      const catalog = JSON.parse(
        await readDbCatalogSnapshot(realDb.database.adminDb),
      ) as CatalogFile;
      const table = (name: string): CatalogFile['tables'][number] => {
        const found = catalog.tables.find((entry) => entry.name === name);
        if (found === undefined) throw new Error(`no table ${name} in the catalog`);
        return found;
      };

      expect(catalog.tables.length).toBeGreaterThan(20);
      expect(catalog.tables.map((entry) => entry.name)).toEqual(
        catalog.tables.map((entry) => entry.name).sort(),
      );
      expect(catalog.tables.every((entry) => /^rls:[a-z_]+$/u.test(entry.comment ?? ''))).toBe(
        true,
      );
      expect(table('identity_api_keys').policies.length).toBeGreaterThan(0);
      expect(
        table('identity_api_keys').grants.some((grant) => grant.startsWith('authenticated: ')),
      ).toBe(true);

      if (catalog.tables.some((entry) => entry.name === 'analytics_events')) {
        // The migrations create a partition for this month and the next; their
        // names depend on the day, so only the parent and its default are recorded.
        expect(table('analytics_events')).toMatchObject({
          kind: 'partitioned table',
          partition: { key: 'RANGE (created_at)', default: 'analytics_events_default' },
        });
        expect(catalog.tables.filter((entry) => /^analytics_events_/u.test(entry.name))).toEqual(
          [],
        );
        const partitions = await realDb.database.adminDb.raw<{ name: string }>(
          `SELECT c.relname::text AS name FROM pg_class c WHERE c.relispartition AND c.relkind = 'r'`,
        );
        expect(partitions.length).toBeGreaterThan(1);
      }

      // The login roles reach the tables through the roles they are members of.
      const memberOf = Object.fromEntries(catalog.roles.map((role) => [role.name, role.memberOf]));
      expect(memberOf).toMatchObject({
        bslt_app: ['authenticated'],
        bslt_worker: ['bslt_system'],
        authenticated: [],
      });
      expect(Object.keys(memberOf)).not.toContain('postgres');
    },
    TEST_TIMEOUT,
  );

  // Last: it changes the suite's database.
  it(
    'a schema change shows in the catalog, and the check says how to update it',
    async () => {
      const before = await readDbCatalogSnapshot(realDb.database.adminDb);
      const owner = realDb.database.ownerDb;

      await owner.raw('ALTER TABLE identity_api_keys ADD COLUMN seeded_note text');
      await owner.raw(
        'CREATE INDEX idx_identity_api_keys_seeded ON identity_api_keys (seeded_note)',
      );
      await owner.raw(
        'CREATE POLICY seeded_read ON identity_api_keys FOR SELECT TO authenticated USING (true)',
      );
      await owner.raw('GRANT DELETE ON identity_api_keys TO PUBLIC');
      await owner.raw('ALTER TABLE identity_api_keys NO FORCE ROW LEVEL SECURITY');
      await owner.raw(`COMMENT ON TABLE identity_api_keys IS 'rls:internal'`);
      await owner.raw(`CREATE FUNCTION seeded_fn() RETURNS integer LANGUAGE sql AS 'SELECT 1'`);

      const after = await readDbCatalogSnapshot(realDb.database.adminDb);
      const changed = changes(before, after);

      expect(changed).toContain('+ "seeded_note text"');
      expect(changed).toContain(
        '+ "CREATE INDEX idx_identity_api_keys_seeded ON public.identity_api_keys USING btree (seeded_note)"',
      );
      expect(changed).toContain('+ "name": "seeded_read"');
      expect(changed).toContain('+ "PUBLIC: DELETE"');
      expect(changed).toContain('- "forced": true');
      expect(changed).toContain('+ "forced": false');
      expect(changed).toContain('+ "comment": "rls:internal"');
      expect(changed).toContain('+ "name": "seeded_fn()"');

      const result = checkSnapshot(DB_CATALOG, after);
      expect(result.ok).toBe(false);
      expect((result.problems ?? []).join('\n')).toContain('pnpm bslt db catalog');

      // A function body that changes keeps its name; its hash moves.
      await owner.raw(
        `CREATE OR REPLACE FUNCTION seeded_fn() RETURNS integer LANGUAGE sql AS 'SELECT 2'`,
      );
      const rebodied = changes(after, await readDbCatalogSnapshot(realDb.database.adminDb));
      expect(rebodied).toHaveLength(2);
      expect(rebodied.every((line) => line.includes('"bodySha256"'))).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
