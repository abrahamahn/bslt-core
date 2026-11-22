// main/kernel/db/src/schema-coverage.test.ts
/**
 * Every table the server writes to in raw SQL must be created by a baseline.
 *
 * `email_unsubscribes` was written to from four places in
 * `core/src/notifications/unsubscribe.ts` and created by no migration. Nothing
 * caught it: the type-check has no view into a SQL string, the unit tests mock
 * the db client, and the only symptom was a 500 from the public unsubscribe
 * endpoint — an endpoint nobody clicks in development, because nobody sends
 * themselves marketing email in development.
 *
 * COVERAGE, STATED HONESTLY: this scans raw SQL only — `INSERT INTO x (`,
 * `UPDATE x SET`, `DELETE FROM x WHERE`. Writes that go through the query
 * builder or a repository are invisible to it, and so are plain `SELECT`s. It
 * is a floor, not a proof. The patterns are deliberately strict about the
 * syntax that follows the table name, because a looser regex matches the prose
 * in JSDoc and OpenAPI summaries ("Update user preferences") and drowns the
 * signal in about seventy English words.
 */

import { readFile, readdir } from 'fs/promises';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';

import { migrationSources, readSourceFiles } from './migrate';

const MAIN_ROOT = path.join(__dirname, '..', '..', '..');

/**
 * Created at runtime by the migration runner itself, which cannot record that
 * it has applied a file until the table recording that exists. It is the one
 * table that legitimately is in no file.
 */
const CREATED_OUTSIDE_MIGRATIONS = new Set(['sys_migrations']);

const MUTATION_PATTERNS = [
  /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(/gi,
  /\bUPDATE\s+([a-z_][a-z0-9_]*)\s+SET\b/gi,
  /\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)\s*(?:WHERE\b|;|$)/gim,
];

/** Comments hold prose that reads like SQL. Drop them before scanning. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

async function tsFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(?:node_modules|dist|\.turbo|\.claude|testing)$/u.test(entry.name))
        await tsFiles(full, found);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

let createdTables: Set<string>;
let mutatedTables: Map<string, string>;

beforeAll(async () => {
  createdTables = new Set(CREATED_OUTSIDE_MIGRATIONS);
  // The kernel baseline and every owner's files, as the runner reads them.
  const migrations = (
    await Promise.all(migrationSources().map((source) => readSourceFiles(source)))
  ).flatMap((files) => files.migrations);
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      createdTables.add((match[1] ?? '').toLowerCase());
    }
  }

  mutatedTables = new Map();
  const files = (
    await Promise.all(
      ['kernel', 'modules', 'apps'].map((tier) => tsFiles(path.join(MAIN_ROOT, tier))),
    )
  ).flat();
  for (const file of files) {
    const source = stripComments(await readFile(file, 'utf8'));
    for (const pattern of MUTATION_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const table = (match[1] ?? '').toLowerCase();
        if (!mutatedTables.has(table)) {
          mutatedTables.set(table, path.relative(MAIN_ROOT, file));
        }
      }
    }
  }
});

describe('schema coverage', () => {
  it('creates every table the server writes to in raw SQL', () => {
    const orphans = [...mutatedTables]
      .filter(([table]) => !createdTables.has(table))
      .map(([table, file]) => `${table} (written by ${file})`);

    expect(orphans).toEqual([]);
  });

  it('actually scanned something, so a broken regex cannot pass vacuously', () => {
    // Without this, a pattern that silently stops matching turns the test above
    // into an assertion that the empty set is empty.
    expect(createdTables.size).toBeGreaterThan(20);
    expect(mutatedTables.size).toBeGreaterThan(0);
    expect(mutatedTables.has('audit_log')).toBe(true);
    expect(mutatedTables.has('sys_jobs')).toBe(true);
  });
});
