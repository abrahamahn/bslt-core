// main/tools/catalog/audit.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { withoutAttribution } from './attribute';
import {
  auditCatalog,
  compareWithDatabase,
  missingOwnerIsolation,
  ownerIsolationTables,
  ownerTables,
  run,
  unprefixedNameProblems,
} from './audit';
import { DB_CATALOG, serializeCatalog } from './file';
import { attributedTo, soundCatalog, table } from './fixtures';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function rootWith(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-db-audit-'));
  roots.push(root);
  for (const directory of ['tests', 'main']) mkdirSync(path.join(root, directory));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const ISOLATION_SUITE = `
describeRealDb('owner isolation', (realDb) => {
  describeOwnerIsolation(realDb, [{ table: 'tasks', seedRow: seed }]);
});
`;

describe('auditCatalog', () => {
  it('accepts a catalog whose objects are attributed, classified and equal their class', () => {
    expect(auditCatalog(soundCatalog(), {})).toEqual([]);
  });

  it('reports an object without a known source', () => {
    const catalog = soundCatalog();
    const [jobs, ...rest] = catalog.tables;

    expect(auditCatalog({ ...catalog, tables: [{ ...jobs!, source: '' }, ...rest] }, {})).toEqual([
      'tables public.sys_jobs: attributed to "", which is not a migration source',
    ]);
    expect(
      auditCatalog(
        { ...catalog, functions: [{ ...catalog.functions[0]!, source: 'billing' }] },
        {},
      ),
    ).toEqual([
      'functions public.sys_current_user_id(): attributed to "billing", which is not a migration source',
    ]);
  });

  it('reports an unclassified table, a table that is not forced and one that is not its class', () => {
    const catalog = soundCatalog();
    const tables = [
      ...catalog.tables,
      attributedTo('tasks', table('notes', { comment: null })),
      attributedTo('tasks', table('drafts', { rowSecurity: { enabled: true, forced: false } })),
      attributedTo('tasks', table('labels', { grants: ['authenticated: SELECT'] })),
    ];

    expect(auditCatalog({ ...catalog, tables }, {})).toEqual([
      'table public.notes: no row-level security class (comment: null); classify it with sys_apply_rls',
      'table public.drafts: row security is not enabled and forced',
      'table public.labels: authenticated is granted (select) but has policies for (select, insert, update, delete)',
    ]);
  });

  it('reports a nullable owner column, unless it is a listed exception that still applies', () => {
    const catalog = soundCatalog();
    const nullable = attributedTo(
      'tasks',
      table('drafts', { columns: ['id uuid NOT NULL', 'user_id uuid'] }),
    );
    const withNullable = { ...catalog, tables: [...catalog.tables, nullable] };

    expect(auditCatalog(withNullable, {})).toEqual([
      'table public.drafts: the owner column user_id of class owner_user is nullable (plan section 9.2: one NOT NULL owner column)',
    ]);
    expect(auditCatalog(withNullable, { 'public.drafts': 'until the drafts module' })).toEqual([]);
    // Shrink-only: an exception that no longer applies must go.
    expect(auditCatalog(catalog, { 'public.drafts': 'until the drafts module' })).toEqual([
      'NULLABLE_OWNER_COLUMNS lists public.drafts, whose owner column is no longer nullable: remove the entry',
    ]);
  });

  it('reports a foreign key to a table of a source the referencing one does not depend on', () => {
    const catalog = soundCatalog({
      sources: [
        { id: 'kernel', dependsOn: [] },
        { id: 'identity', dependsOn: [] },
        { id: 'tasks', dependsOn: [] },
      ],
    });

    expect(auditCatalog(catalog, {})).toEqual([
      'table public.tasks (tasks): tasks_user_id_fkey references public.users of identity, which tasks does not depend on',
    ]);
  });

  it('lets every source reference the kernel and its own tables', () => {
    const catalog = soundCatalog();
    const tables = [
      ...catalog.tables,
      attributedTo(
        'tasks',
        table('task_runs', {
          constraints: [
            'task_runs_job_fkey FOREIGN KEY (job_id) REFERENCES sys_jobs(id)',
            'task_runs_task_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE',
          ],
        }),
      ),
    ];

    expect(auditCatalog({ ...catalog, tables }, {})).toEqual([]);
  });

  it('reports sources that are out of order', () => {
    const catalog = soundCatalog({
      sources: [
        { id: 'identity', dependsOn: [] },
        { id: 'tasks', dependsOn: ['kernel', 'orgs'] },
        { id: 'kernel', dependsOn: [] },
      ],
    });

    expect(auditCatalog(catalog, {}).slice(0, 3)).toEqual([
      'the first migration source is not kernel',
      'source tasks depends on kernel, which is not applied before it',
      'source tasks depends on orgs, which is not applied before it',
    ]);
  });
});

describe('owner isolation coverage', () => {
  it('names the owner_user and owner_org tables', () => {
    expect(ownerTables(soundCatalog())).toEqual(['tasks']);
  });

  it('reads the covered tables from the real-DB suites that call describeOwnerIsolation', () => {
    const root = rootWith({
      'tests/integration/api/owner-isolation.real-db.test.ts': ISOLATION_SUITE,
      // Not a describeOwnerIsolation suite: its tables do not count.
      'tests/integration/api/other.real-db.test.ts': `seed({ table: 'drafts' });`,
      // Not a real-DB suite.
      'tests/integration/api/unit.test.ts': `describeOwnerIsolation(x, { table: 'labels' });`,
      'main/modules/notes/server/notes.real-db.test.ts': `describeOwnerIsolation(realDb, {\n  table: 'notes',\n});`,
      'main/node_modules/x/y.real-db.test.ts': `describeOwnerIsolation(x, { table: 'vendored' });`,
    });

    expect([...ownerIsolationTables(root)].sort()).toEqual(['notes', 'tasks']);
  });

  it('reports an owner table without a case', () => {
    expect(missingOwnerIsolation(soundCatalog(), new Set(['tasks']))).toEqual([]);
    expect(missingOwnerIsolation(soundCatalog(), new Set(['users']))).toEqual([
      'table public.tasks: no describeOwnerIsolation case in a real-DB suite (@bslt/testing/real-db); add one, for example in tests/integration/api/owner-isolation.real-db.test.ts',
    ]);
  });
});

describe('compareWithDatabase', () => {
  it('accepts a database that holds the tables of the catalog as the catalog has them', () => {
    const catalog = soundCatalog();

    expect(compareWithDatabase(catalog, withoutAttribution(catalog))).toEqual([]);
  });

  it('reports a missing table, a table that differs and one the catalog does not know', () => {
    const catalog = soundCatalog();
    const database = withoutAttribution(catalog);
    const tables = [
      ...database.tables
        .filter((entry) => entry.name !== 'sys_jobs')
        .map((entry) =>
          entry.name === 'tasks'
            ? { ...entry, rowSecurity: { enabled: true, forced: false }, grants: [] }
            : entry,
        ),
      table('scratch'),
    ];

    expect(compareWithDatabase(catalog, { ...database, tables })).toEqual([
      'table public.sys_jobs is in the catalog but not in the database',
      'table public.tasks differs from the catalog in the database: rowSecurity, grants',
      'table public.scratch is in the database but not in the catalog',
    ]);
  });
});

describe('the db-audit gate', () => {
  function prefixedCatalog() {
    const base = soundCatalog();
    return {
      ...base,
      tables: base.tables.map((entry) => {
        if (entry.name === 'users') {
          return {
            ...entry,
            name: 'identity_users',
            constraints: ['identity_users_pkey PRIMARY KEY (id)'],
            indexes: [
              'CREATE UNIQUE INDEX identity_users_pkey ON public.identity_users USING btree (id)',
            ],
          };
        }
        if (entry.name === 'tasks') {
          return {
            ...entry,
            constraints: [
              'tasks_pkey PRIMARY KEY (id)',
              'tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE',
            ],
          };
        }
        return entry;
      }),
    };
  }

  it('passes on a sound committed catalog whose objects carry owner prefixes and whose owner tables have an isolation test', async () => {
    const root = rootWith({
      [DB_CATALOG.file]: serializeCatalog(prefixedCatalog()),
      'tests/integration/api/owner-isolation.real-db.test.ts': ISOLATION_SUITE,
    });

    const result = await run({ root, nullableOwnerColumns: {} });

    expect(result.problems ?? []).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('3 tables of 3 sources');
  });

  it('fails when any database object lacks its owner prefix', async () => {
    expect(unprefixedNameProblems(soundCatalog())).toEqual([
      'table users (identity): missing owner prefix (identity / identity_*)',
    ]);

    const root = rootWith({
      [DB_CATALOG.file]: serializeCatalog(soundCatalog()),
      'tests/integration/api/owner-isolation.real-db.test.ts': ISOLATION_SUITE,
    });
    const result = await run({ root, nullableOwnerColumns: {} });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      'table users (identity): missing owner prefix (identity / identity_*)',
    );
  });

  it('fails on a missing or hand-edited catalog before reading it', async () => {
    expect((await run({ root: rootWith({}), nullableOwnerColumns: {} })).ok).toBe(false);
    const edited = await run({
      root: rootWith({
        [DB_CATALOG.file]: JSON.stringify(JSON.parse(serializeCatalog(prefixedCatalog()))),
      }),
    });
    expect(edited.ok).toBe(false);
    expect((edited.problems ?? []).join('\n')).toContain('pnpm bslt db catalog');
  });

  it('fails when an owner table has no isolation test, and names the table', async () => {
    const root = rootWith({ [DB_CATALOG.file]: serializeCatalog(prefixedCatalog()) });

    const result = await run({ root, nullableOwnerColumns: {} });

    expect(result.ok).toBe(false);
    expect((result.problems ?? [])[0]).toContain(
      'table public.tasks: no describeOwnerIsolation case',
    );
  });

  it('is green on the committed catalog of this repository', async () => {
    const result = await run();

    expect(result.problems ?? []).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
