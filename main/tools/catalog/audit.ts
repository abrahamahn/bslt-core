// main/tools/catalog/audit.ts
/**
 * `bslt db audit`: what the committed catalog must say (restructure plan,
 * sections 9.1, 9.2, 9.4 and 14.3). It reads the catalog `bslt db catalog`
 * computed, never the SQL text, so it needs no database and runs in the merge
 * lane:
 *
 * - the file is the one the command wrote (its header, its canonical form);
 * - every type, sequence, function, table and view is attributed to a known
 *   migration source;
 * - every table is classified, has row security enabled and forced (all but
 *   the migrator's own `sys_migrations`), and its policies and grants equal the
 *   template of its class (./rls.ts);
 * - an `owner_user` or `owner_org` table has one NOT NULL owner column;
 * - a foreign key targets a table of the same source or of a source the
 *   referencing one depends on;
 * - every `owner_user` and `owner_org` table has a `describeOwnerIsolation`
 *   case in a real-DB suite.
 *
 * With `--db` it also compares the connected database (the one a deploy or the
 * CI lane migrated) with the catalog, table by table.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../gates/types';
import { REAL_DB_TEST_SUFFIX, REPO_ROOT } from '../lib/paths';
import { checkSnapshotForm, compareText } from '../snapshot/snapshot-file';

import { ATTRIBUTED_KINDS, qualifiedName, type AttributedCatalog } from './attribute';
import { DB_CATALOG, DB_CATALOG_COMMAND, loadCatalog } from './file';
import { legacyNames } from './names';
import { describeTableRls, ownerColumnIsNotNull, rlsClassOf } from './rls';

import type { DbCatalog } from './read';

/** The source every other source may reference without naming it. */
export const KERNEL_SOURCE = 'kernel';

/**
 * Owner columns that are still nullable, with the phase that makes them NOT
 * NULL. Shrink-only: an entry that no longer applies fails the audit.
 */
export const NULLABLE_OWNER_COLUMNS: Readonly<Record<string, string>> = {};

/** The table a foreign key constraint line of the catalog references. */
function referencedTable(constraint: string): string | null {
  const match =
    /^\S+ FOREIGN KEY \(.*?\) REFERENCES ((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\(/u.exec(
      constraint,
    );
  if (match?.[1] === undefined) return null;
  return match[1].includes('.') ? match[1] : `public.${match[1]}`;
}

/**
 * Everything the catalog says that it must not. Empty when the catalog is
 * sound.
 */
export function auditCatalog(
  catalog: AttributedCatalog,
  nullableOwnerColumns: Readonly<Record<string, string>> = NULLABLE_OWNER_COLUMNS,
): string[] {
  const problems: string[] = [];

  // --- Sources ---------------------------------------------------------------
  const sources = new Map(catalog.sources.map((source) => [source.id, source]));
  if (sources.size !== catalog.sources.length) problems.push('a migration source is listed twice');
  if (catalog.sources[0]?.id !== KERNEL_SOURCE) {
    problems.push(`the first migration source is not ${KERNEL_SOURCE}`);
  }
  const seen = new Set<string>();
  for (const source of catalog.sources) {
    for (const dependency of source.dependsOn) {
      if (!seen.has(dependency)) {
        problems.push(
          `source ${source.id} depends on ${dependency}, which is not applied before it`,
        );
      }
    }
    seen.add(source.id);
  }

  // --- Attribution -----------------------------------------------------------
  for (const kind of ATTRIBUTED_KINDS) {
    for (const object of catalog[kind]) {
      if (!sources.has(object.source)) {
        problems.push(
          `${kind} ${qualifiedName(object)}: attributed to ${JSON.stringify(object.source)}, which is not a migration source`,
        );
      }
    }
  }

  // --- Tables ----------------------------------------------------------------
  const tableSources = new Map(catalog.tables.map((table) => [qualifiedName(table), table.source]));
  const stillNullable = new Set<string>();
  for (const table of catalog.tables) {
    const name = qualifiedName(table);
    const { rls, problems: rlsProblems } = describeTableRls(table);
    for (const problem of rlsProblems) problems.push(`table ${name}: ${problem}`);

    if (rls !== null && (rls.class === 'owner_user' || rls.class === 'owner_org')) {
      if (rls.ownerColumn === null) {
        problems.push(`table ${name}: class ${rls.class} without an owner column in its policies`);
      } else if (!ownerColumnIsNotNull(table, rls.ownerColumn)) {
        stillNullable.add(name);
        if (nullableOwnerColumns[name] === undefined) {
          problems.push(
            `table ${name}: the owner column ${rls.ownerColumn} of class ${rls.class} is nullable (plan section 9.2: one NOT NULL owner column)`,
          );
        }
      }
    }

    const allowed = new Set([
      table.source,
      KERNEL_SOURCE,
      ...(sources.get(table.source)?.dependsOn ?? []),
    ]);
    for (const constraint of table.constraints) {
      const target = referencedTable(constraint);
      if (target === null) continue;
      const targetSource = tableSources.get(target);
      if (targetSource === undefined) {
        problems.push(
          `table ${name}: ${constraint.split(' ')[0] ?? ''} references ${target}, which is not in the catalog`,
        );
      } else if (!allowed.has(targetSource)) {
        problems.push(
          `table ${name} (${table.source}): ${constraint.split(' ')[0] ?? ''} references ${target} of ${targetSource}, which ${table.source} does not depend on`,
        );
      }
    }
  }
  for (const name of Object.keys(nullableOwnerColumns).sort(compareText)) {
    if (!stillNullable.has(name)) {
      problems.push(
        `NULLABLE_OWNER_COLUMNS lists ${name}, whose owner column is no longer nullable: remove the entry`,
      );
    }
  }

  return problems;
}

/** The tables whose rows belong to one user or one org. */
export function ownerTables(catalog: AttributedCatalog): string[] {
  return catalog.tables
    .filter((table) => {
      const rlsClass = rlsClassOf(table);
      return rlsClass === 'owner_user' || rlsClass === 'owner_org';
    })
    .map((table) => table.name)
    .sort(compareText);
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo', '.git', '.cache', 'e2e']);

function realDbSuites(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) realDbSuites(full, found);
    else if (entry.endsWith(REAL_DB_TEST_SUFFIX)) found.push(full);
  }
  return found;
}

/**
 * The tables a `describeOwnerIsolation` call covers: every `table: '<name>'`
 * of a real-DB suite that calls the helper.
 */
export function ownerIsolationTables(root: string = REPO_ROOT): Set<string> {
  const covered = new Set<string>();
  for (const directory of ['tests', 'main']) {
    for (const file of realDbSuites(path.join(root, directory))) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('describeOwnerIsolation(')) continue;
      for (const match of source.matchAll(/\btable: '([a-z_][a-z0-9_]*)'/gu)) {
        if (match[1] !== undefined) covered.add(match[1]);
      }
    }
  }
  return covered;
}

/** Strict prefix check (plan section 9.1 item 1): every DB object carries its owner's prefix. */
export function unprefixedNameProblems(catalog: AttributedCatalog): string[] {
  return legacyNames(catalog).map(
    ({ kind, name, source }) =>
      `${kind} ${name} (${source}): missing owner prefix (${source === KERNEL_SOURCE ? 'sys_*' : `${source} / ${source}_*`})`,
  );
}

/** The owner tables without a `describeOwnerIsolation` case (plan 9.4, proof item 3). */
export function missingOwnerIsolation(
  catalog: AttributedCatalog,
  covered: ReadonlySet<string>,
): string[] {
  return ownerTables(catalog)
    .filter((table) => !covered.has(table))
    .map(
      (table) =>
        `table public.${table}: no describeOwnerIsolation case in a real-DB suite (@bslt/testing/real-db); add one, for example in tests/integration/api/owner-isolation.real-db.test.ts`,
    );
}

/** How the connected database differs from the catalog, table by table. */
export function compareWithDatabase(catalog: AttributedCatalog, database: DbCatalog): string[] {
  const problems: string[] = [];
  const live = new Map(database.tables.map((table) => [qualifiedName(table), table]));
  for (const table of catalog.tables) {
    const name = qualifiedName(table);
    const found = live.get(name);
    if (found === undefined) {
      problems.push(`table ${name} is in the catalog but not in the database`);
      continue;
    }
    const { source: _source, ...expected } = table;
    const facets = Object.keys(expected).filter(
      (key) =>
        JSON.stringify((expected as Record<string, unknown>)[key]) !==
        JSON.stringify((found as unknown as Record<string, unknown>)[key]),
    );
    if (facets.length > 0) {
      problems.push(`table ${name} differs from the catalog in the database: ${facets.join(', ')}`);
    }
  }
  for (const name of live.keys()) {
    if (!catalog.tables.some((table) => qualifiedName(table) === name)) {
      problems.push(`table ${name} is in the database but not in the catalog`);
    }
  }
  return problems;
}

async function readConnectedDatabase(): Promise<DbCatalog> {
  const [{ buildConnectionString, createRawDb }, { initEnv }, { readDbCatalog }] =
    await Promise.all([import('@bslt/db'), import('@bslt/server-system/config'), import('./read')]);
  await initEnv();
  const db = createRawDb({ connectionString: buildConnectionString(), maxConnections: 1 });
  try {
    return await readDbCatalog(db);
  } finally {
    await db.close();
  }
}

/**
 * The `db-audit` gate and `bslt db audit`.
 *
 * @param options.db - Also compare the connected database (real-DB lane).
 */
export async function run(
  options: {
    readonly db?: boolean;
    readonly root?: string;
    /** Default: {@link NULLABLE_OWNER_COLUMNS}. */
    readonly nullableOwnerColumns?: Readonly<Record<string, string>>;
  } = {},
): Promise<CheckResult> {
  const root = options.root ?? REPO_ROOT;
  const form = checkSnapshotForm(DB_CATALOG, root);
  if (!form.ok) return form;

  const catalog = loadCatalog(root);
  const problems = [
    ...auditCatalog(catalog, options.nullableOwnerColumns),
    ...unprefixedNameProblems(catalog),
    ...missingOwnerIsolation(catalog, ownerIsolationTables(root)),
  ];
  if (options.db === true) {
    problems.push(...compareWithDatabase(catalog, await readConnectedDatabase()));
  }
  if (problems.length > 0) {
    return fail(`the database catalog (${DB_CATALOG.file}) is not sound`, [
      ...problems,
      `After fixing a baseline: \`${DB_CATALOG_COMMAND}\`, then commit the catalog with the change.`,
    ]);
  }
  const owned = ownerTables(catalog).length;
  return pass(
    `${String(catalog.tables.length)} tables of ${String(catalog.sources.length)} sources are attributed, classified and equal their class; ${String(owned)} owner tables have an isolation test${options.db === true ? '; the database equals the catalog' : ''}`,
  );
}
