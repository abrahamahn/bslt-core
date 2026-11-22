// main/tools/catalog/command.ts
/**
 * `bslt db catalog [--check]`: compute the database catalog and write it, or
 * compare it with the committed file.
 *
 * The command fails, and writes nothing, when a source alters or drops another
 * source's object, when an object is unattributed, or when the catalog is not
 * sound (an unclassified table, a table that is not its class: ./audit.ts).
 */
import { REPO_ROOT } from '../lib/paths';
import { checkSnapshot, checkSnapshotForm, writeSnapshot } from '../snapshot/snapshot-file';

import { auditCatalog } from './audit';
import { DB_CATALOG, serializeCatalog } from './file';

import type { CheckResult } from '../gates/types';
import type { AttributionResult } from './attribute';

interface Output {
  log(message: string): void;
  error(message: string): void;
}

export interface CatalogCommandOptions {
  readonly root?: string;
  readonly out?: Output;
  /** Default: compute it on a scratch database (./build.ts). */
  readonly build?: () => Promise<AttributionResult>;
  /** Default: the listed exceptions of ./audit.ts. */
  readonly nullableOwnerColumns?: Readonly<Record<string, string>>;
}

async function computed(options: CatalogCommandOptions): Promise<AttributionResult> {
  if (options.build !== undefined) return options.build();
  // Loaded on demand: it opens a Postgres client.
  return (await import('./build')).buildCatalog();
}

/**
 * Run `bslt db catalog`.
 *
 * @returns The process exit code.
 */
export async function catalogCommand(
  argv: readonly string[],
  options: CatalogCommandOptions = {},
): Promise<number> {
  const root = options.root ?? REPO_ROOT;
  const out = options.out ?? console;
  const unknown = argv.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    out.error(`bslt db catalog: unknown argument(s) ${unknown.join(' ')}`);
    out.error('Usage: bslt db catalog [--check]');
    return 1;
  }

  const { catalog, problems: attribution } = await computed(options);
  const problems = [...attribution, ...auditCatalog(catalog, options.nullableOwnerColumns)];
  if (problems.length > 0) {
    out.error(
      `The catalog of the migration sources is not sound; ${DB_CATALOG.file} was not written:`,
    );
    for (const problem of problems) out.error(`  - ${problem}`);
    return 1;
  }

  const current = serializeCatalog(catalog);
  if (argv.includes('--check')) {
    const result = checkSnapshot(DB_CATALOG, current, root);
    if (result.ok) {
      out.log(result.summary);
      return 0;
    }
    out.error(result.summary);
    for (const problem of result.problems ?? []) out.error(problem);
    return 1;
  }

  out.log(
    writeSnapshot(DB_CATALOG, current, root)
      ? `wrote ${DB_CATALOG.file}. Commit it with the change that caused the difference, then run \`pnpm bslt sync rows\`.`
      : `${DB_CATALOG.file} is up to date.`,
  );
  return 0;
}

/**
 * The `db-catalog` gate (by name only; the real-DB lane runs
 * `pnpm bslt db catalog --check`).
 *
 * In the self-test there is no database: the gate then checks only that the
 * committed file is one this command wrote (its header, its canonical form).
 */
export async function run(
  options: { readonly selfTest: boolean } & Pick<
    CatalogCommandOptions,
    'root' | 'build' | 'nullableOwnerColumns'
  >,
): Promise<CheckResult> {
  const root = options.root ?? REPO_ROOT;
  if (options.selfTest) return checkSnapshotForm(DB_CATALOG, root);
  const lines: string[] = [];
  const code = await catalogCommand(['--check'], {
    root,
    out: { log: (line) => lines.push(line), error: (line) => lines.push(line) },
    ...(options.build === undefined ? {} : { build: options.build }),
    ...(options.nullableOwnerColumns === undefined
      ? {}
      : { nullableOwnerColumns: options.nullableOwnerColumns }),
  });
  const [summary = 'no output', ...rest] = lines;
  return code === 0 ? { ok: true, summary } : { ok: false, summary, problems: rest };
}
