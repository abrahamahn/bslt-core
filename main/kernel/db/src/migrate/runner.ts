// main/kernel/db/src/migrate/runner.ts
/**
 * The migration runner (restructure plan, section 9.3 item 7).
 *
 * One runner builds every database: `pnpm bslt db migrate`, the migrate entry
 * of the production image (./entry.ts), the real-DB harness and the catalog
 * snapshot all call it.
 *
 * - **Sources.** A source is a directory of `NNNN_<name>.sql` files with an id
 *   and the ids it depends on: the kernel (`sql/`), and one per owner. The
 *   kernel is applied first, then the sources after the ones they depend on
 *   (ties by id), and inside a source the files by number.
 * - **Record.** `sys_migrations(source, name, checksum, applied_at)`. A file is
 *   applied once; the SHA-256 of its content is stored with it.
 * - **Lock.** A session advisory lock is held for the whole run, so two
 *   runners (two deploys, two test processes on one database) never interleave.
 * - **Transactions.** A file runs in one transaction with its record. A file
 *   whose leading comment has the line `-- bslt:no-transaction` runs statement
 *   by statement outside one (`CREATE INDEX CONCURRENTLY`); it has to be safe
 *   to run again, because a failure half way leaves no record.
 * - **Required seeds.** `seeds/NNNN_<name>.sql` of a source holds rows the
 *   application cannot run without (the legal documents). Seeds run after all
 *   migrations. A seed is idempotent, so a changed seed is applied again
 *   instead of stopping the run.
 * - **Pre-v1 policy** (section 9.3 item 6). Until `foundation-v1` the baselines
 *   are edited in place. A database built from other content than the sources
 *   hold now (a changed or removed file, a new file before an applied one, or
 *   tables this runner has no record of) cannot be migrated forward: the run
 *   stops before it changes anything and says `run: pnpm bslt db reset`.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { createRawDb, type RawDb } from '../client';

import { splitSqlStatements } from './sql-statements';

// ============================================================================
// Sources and files
// ============================================================================

/** The id of the kernel source: applied first, depends on nothing. */
export const KERNEL_SOURCE_ID = 'kernel';

export interface MigrationSource {
  /** `kernel`, or the id of the module that owns the files. */
  readonly id: string;
  /** Absolute path of the directory that holds the `NNNN_<name>.sql` files. */
  readonly dir: string;
  /** Ids of the sources whose objects these files reference. The kernel is implied. */
  readonly dependsOn: readonly string[];
}

export interface MigrationFile {
  readonly source: string;
  /** File name; a seed is `seeds/<file name>`. */
  readonly name: string;
  readonly path: string;
  readonly sql: string;
  /** SHA-256 of the content, hex. */
  readonly checksum: string;
  /** False when the file is marked `-- bslt:no-transaction`. */
  readonly transactional: boolean;
}

export interface SourceFiles {
  readonly migrations: readonly MigrationFile[];
  readonly seeds: readonly MigrationFile[];
}

const SEEDS_DIR = 'seeds';
const FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/u;
const NO_TRANSACTION_MARKER = /^--\s*bslt:no-transaction\s*$/u;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `<source>/<name>`: how a file is named in results, logs and errors. */
const label = (file: { readonly source: string; readonly name: string }): string =>
  `${file.source}/${file.name}`;

/**
 * The order the sources are applied in: the kernel, then every source after
 * the sources it depends on; where the dependencies leave a choice, by id.
 *
 * @throws {Error} On a duplicate id, a dependency that is not a source, a
 *   kernel with dependencies, or a dependency cycle.
 */
export function orderSources(sources: readonly MigrationSource[]): MigrationSource[] {
  const byId = new Map<string, MigrationSource>();
  for (const source of sources) {
    if (byId.has(source.id)) {
      throw new Error(`migration source "${source.id}" is listed twice`);
    }
    byId.set(source.id, source);
  }
  for (const source of sources) {
    if (source.id === KERNEL_SOURCE_ID && source.dependsOn.length > 0) {
      throw new Error('the kernel source depends on nothing');
    }
    for (const dependency of source.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(
          `migration source "${source.id}" depends on "${dependency}", which is not a source`,
        );
      }
    }
  }

  const ordered: MigrationSource[] = [];
  const done = new Set<string>();
  const kernel = byId.get(KERNEL_SOURCE_ID);
  if (kernel !== undefined) {
    ordered.push(kernel);
    done.add(kernel.id);
  }
  const waiting = sources
    .filter((source) => source.id !== KERNEL_SOURCE_ID)
    .sort((a, b) => compareText(a.id, b.id));
  while (waiting.length > 0) {
    const next = waiting.findIndex((source) => source.dependsOn.every((id) => done.has(id)));
    if (next === -1) {
      throw new Error(
        `migration sources form a dependency cycle: ${waiting.map((source) => source.id).join(', ')}`,
      );
    }
    const [source] = waiting.splice(next, 1) as [MigrationSource];
    ordered.push(source);
    done.add(source.id);
  }
  return ordered;
}

/** SHA-256 of a file's content. Line ends are normalised, so a CRLF checkout has the same checksum. */
export function checksumSql(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/gu, '\n')).digest('hex');
}

/**
 * Whether a file asks to run outside a transaction: a line `-- bslt:no-transaction`
 * among the comment lines the file starts with.
 */
export function isNoTransaction(sql: string): boolean {
  for (const line of sql.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('--')) return false;
    if (NO_TRANSACTION_MARKER.test(trimmed)) return true;
  }
  return false;
}

async function readSqlFiles(
  source: MigrationSource,
  dir: string,
  prefix: string,
): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((entry) => !(entry.isDirectory() && prefix === '' && entry.name === SEEDS_DIR))
    .map((entry) => entry.name)
    .sort(compareText);

  const files: MigrationFile[] = [];
  const numbers = new Map<string, string>();
  for (const name of names) {
    const match = FILE_NAME.exec(name);
    if (match === null) {
      throw new Error(
        `migration source "${source.id}": "${prefix}${name}" is not named NNNN_<name>.sql`,
      );
    }
    const number = match[1] as string;
    const sameNumber = numbers.get(number);
    if (sameNumber !== undefined) {
      throw new Error(
        `migration source "${source.id}": ${prefix}${sameNumber} and ${prefix}${name} have the same number`,
      );
    }
    numbers.set(number, name);
    const filePath = path.join(dir, name);
    const sql = await readFile(filePath, 'utf8');
    files.push({
      source: source.id,
      name: `${prefix}${name}`,
      path: filePath,
      sql,
      checksum: checksumSql(sql),
      transactional: !isNoTransaction(sql),
    });
  }
  return files;
}

/**
 * The files of a source: its migrations in number order, and its required seeds.
 *
 * @throws {Error} When the directory cannot be read, a file is not named
 *   `NNNN_<name>.sql`, two files share a number, or a seed is marked
 *   `bslt:no-transaction`.
 */
export async function readSourceFiles(source: MigrationSource): Promise<SourceFiles> {
  let migrations: MigrationFile[];
  try {
    migrations = await readSqlFiles(source, source.dir, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`migration source "${source.id}": cannot read ${source.dir}`);
    }
    throw error;
  }

  let seeds: MigrationFile[] = [];
  try {
    seeds = await readSqlFiles(source, path.join(source.dir, SEEDS_DIR), `${SEEDS_DIR}/`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const untransacted = seeds.find((seed) => !seed.transactional);
  if (untransacted !== undefined) {
    throw new Error(
      `migration source "${source.id}": the seed ${untransacted.name} cannot be marked bslt:no-transaction`,
    );
  }
  return { migrations, seeds };
}

// ============================================================================
// Running
// ============================================================================

export interface MigrationLogger {
  log(message: string): void;
}

export interface MigrationRunResult {
  /** `<source>/<name>` of every file this run applied, in order. */
  readonly applied: readonly string[];
  /** `<source>/<name>` of every file that was already applied. */
  readonly skipped: readonly string[];
}

/** How a database that cannot be migrated forward is rebuilt. */
export const RESET_COMMAND = 'pnpm bslt db reset';

/**
 * The database was not built from the sources as they are now. Before
 * `foundation-v1` the answer is to rebuild it, not to repair it.
 */
export class MigrationResetRequiredError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(
      [
        'This database cannot be migrated forward:',
        ...reasons.map((reason) => `  - ${reason}`),
        'The baselines are edited in place until foundation-v1, so a database built from an',
        'earlier version of them is rebuilt, not repaired. It loses its data.',
        `run: ${RESET_COMMAND}`,
      ].join('\n'),
    );
    this.name = 'MigrationResetRequiredError';
    this.reasons = reasons;
  }
}

/** The lock two runners on one database wait for each other on. */
const ADVISORY_LOCK = `hashtextextended('bslt:migrations', 0)`;

const RECORD_TABLE = 'sys_migrations';

const CREATE_RECORD_TABLE = `
  CREATE TABLE ${RECORD_TABLE} (
    source     text        NOT NULL,
    name       text        NOT NULL,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ${RECORD_TABLE}_pkey PRIMARY KEY (source, name)
  );
  -- The migrator's own bookkeeping: no runtime role reads or writes it. Row
  -- security stays off, because forcing it would bind the migrator itself.
  REVOKE ALL ON TABLE ${RECORD_TABLE} FROM PUBLIC;
  COMMENT ON TABLE ${RECORD_TABLE} IS 'rls:internal';
`;

interface RecordRow {
  readonly source: string;
  readonly name: string;
  readonly checksum: string;
}

const isSeed = (name: string): boolean => name.startsWith(`${SEEDS_DIR}/`);

/**
 * Why the recorded state and the sources do not fit, or nothing when they do.
 * Seeds are left out: a changed seed is simply applied again.
 */
function findResetReasons(
  ordered: ReadonlyArray<{
    readonly source: MigrationSource;
    readonly files: SourceFiles;
  }>,
  recorded: readonly RecordRow[],
  unrecordedTables: readonly string[],
): string[] {
  const reasons: string[] = [];
  if (recorded.length === 0 && unrecordedTables.length > 0) {
    const shown = unrecordedTables.slice(0, 5).join(', ');
    const more =
      unrecordedTables.length > 5 ? `, and ${String(unrecordedTables.length - 5)} more` : '';
    reasons.push(
      `the database has tables (${shown}${more}) but no migration record: it was not built by this runner`,
    );
    return reasons;
  }

  const checksums = new Map(recorded.map((row) => [label(row), row.checksum]));
  const known = new Set<string>();
  for (const { files } of ordered) {
    let lastApplied: MigrationFile | undefined;
    for (const file of [...files.migrations].reverse()) {
      if (checksums.has(label(file))) {
        lastApplied = file;
        break;
      }
    }
    for (const file of files.migrations) {
      known.add(label(file));
      const applied = checksums.get(label(file));
      if (applied === undefined) {
        if (lastApplied !== undefined && compareText(file.name, lastApplied.name) < 0) {
          reasons.push(
            `${label(file)} is new but sorts before ${label(lastApplied)}, which is applied`,
          );
        }
      } else if (applied !== file.checksum) {
        reasons.push(`${label(file)} changed after it was applied`);
      }
    }
  }
  for (const row of recorded) {
    if (!isSeed(row.name) && !known.has(label(row))) {
      reasons.push(`${label(row)} is recorded as applied but is not in the sources`);
    }
  }
  return reasons;
}

async function applyFile(db: RawDb, file: MigrationFile): Promise<void> {
  const record = {
    text: `INSERT INTO ${RECORD_TABLE} (source, name, checksum) VALUES ($1, $2, $3)
           ON CONFLICT (source, name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
    values: [file.source, file.name, file.checksum],
  };
  try {
    if (file.transactional) {
      await db.transaction(async (tx) => {
        await tx.raw(file.sql);
        await tx.execute(record);
      });
    } else {
      for (const statement of splitSqlStatements(file.sql)) {
        await db.raw(statement);
      }
      await db.execute(record);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${label(file)} failed: ${reason}`, {
      cause: error,
    });
  }
}

export interface RunMigrationsWithDbOptions {
  /**
   * A client that holds ONE connection (`maxConnections: 1`): the advisory
   * lock belongs to a session, and every statement has to run on it.
   */
  readonly db: RawDb;
  readonly sources: readonly MigrationSource[];
  readonly logger?: MigrationLogger;
  /** Optional immutable SHA-256 checksums from `bslt.lock.json` (`<source>/<name>` -> hex). */
  readonly lockedChecksums?: Readonly<Record<string, string>>;
}

function verifyLockedChecksums(
  ordered: ReadonlyArray<{ readonly source: MigrationSource; readonly files: SourceFiles }>,
  lockedChecksums: Readonly<Record<string, string>>,
): void {
  const seenLabels = new Set<string>();
  const sourceIds = new Set<string>();
  for (const { source, files } of ordered) {
    sourceIds.add(source.id);
    for (const file of files.migrations) {
      const key = label(file);
      seenLabels.add(key);
      const locked = lockedChecksums[key];
      if (locked === undefined) {
        if (Object.keys(lockedChecksums).length > 0) {
          throw new Error(
            `Migration ${key} is missing a locked checksum in bslt.lock.json (run pnpm bslt sync permissions)`,
          );
        }
      } else if (locked !== file.checksum) {
        throw new Error(
          `Migration ${key} checksum mismatch against bslt.lock.json (expected ${locked}, found ${file.checksum}); migrations are immutable`,
        );
      }
    }
  }
  for (const lockedKey of Object.keys(lockedChecksums)) {
    const slash = lockedKey.indexOf('/');
    const lockedSource = slash > 0 ? lockedKey.slice(0, slash) : '';
    if (sourceIds.has(lockedSource) && !seenLabels.has(lockedKey)) {
      throw new Error(
        `Locked migration ${lockedKey} is missing from migration sources; migrations are immutable`,
      );
    }
  }
}

/**
 * Apply every file of `sources` that the database does not have yet.
 *
 * @throws {MigrationResetRequiredError} When the database was built from other
 *   content than the sources hold; nothing is changed.
 * @throws {Error} When a source is malformed, a locked checksum differs, or a file fails.
 *   A failed file leaves nothing behind unless it is marked `bslt:no-transaction`.
 */
export async function runMigrationsWithDb({
  db,
  sources,
  logger = console,
  lockedChecksums,
}: RunMigrationsWithDbOptions): Promise<MigrationRunResult> {
  // Read and validate everything before the database is touched.
  const ordered: Array<{ source: MigrationSource; files: SourceFiles }> = [];
  for (const source of orderSources(sources)) {
    ordered.push({ source, files: await readSourceFiles(source) });
  }
  if (lockedChecksums !== undefined) {
    verifyLockedChecksums(ordered, lockedChecksums);
  }

  await db.raw(`SELECT pg_advisory_lock(${ADVISORY_LOCK})`);
  try {
    const unrecordedTables = (
      await db.raw<{ name: string }>(
        `SELECT c.relname::text AS name
           FROM pg_class c
          WHERE c.relnamespace = current_schema()::regnamespace
            AND c.relkind IN ('r', 'p')
            AND c.relname <> '${RECORD_TABLE}'
            AND NOT EXISTS (SELECT 1 FROM pg_depend d
                             WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
          ORDER BY 1`,
      )
    ).map((row) => row.name);
    const hasRecord =
      (
        await db.raw<{ found: boolean }>(
          `SELECT to_regclass('${RECORD_TABLE}') IS NOT NULL AS found`,
        )
      )[0]?.found === true;
    const recorded = hasRecord
      ? await db.raw<RecordRow>(`SELECT source, name, checksum FROM ${RECORD_TABLE}`)
      : [];

    const reasons = findResetReasons(ordered, recorded, unrecordedTables);
    if (reasons.length > 0) {
      throw new MigrationResetRequiredError(reasons);
    }

    if (!hasRecord) {
      await db.raw(CREATE_RECORD_TABLE);
    }

    const checksums = new Map(recorded.map((row) => [label(row), row.checksum]));
    const applied: string[] = [];
    const skipped: string[] = [];
    const apply = async (file: MigrationFile): Promise<void> => {
      if (checksums.get(label(file)) === file.checksum) {
        skipped.push(label(file));
        return;
      }
      logger.log(`  applying ${label(file)}`);
      await applyFile(db, file);
      applied.push(label(file));
    };

    for (const { files } of ordered) {
      for (const file of files.migrations) await apply(file);
    }
    // Seeds reference tables of any source, so they run when all tables exist.
    for (const { files } of ordered) {
      for (const seed of files.seeds) await apply(seed);
    }

    logger.log(
      applied.length === 0
        ? 'The database is up to date.'
        : `Applied ${String(applied.length)} file(s).`,
    );
    return { applied, skipped };
  } finally {
    // A failed unlock must not replace the outcome of the run. The lock belongs
    // to the session, so closing the connection releases it either way.
    await db.raw(`SELECT pg_advisory_unlock(${ADVISORY_LOCK})`).catch((error: unknown) => {
      logger.log(
        `  could not release the migration lock: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  }
}

export interface RunMigrationsOptions {
  /** The owner role's connection (`MIGRATION_DATABASE_URL`). */
  readonly connectionString: string;
  readonly sources: readonly MigrationSource[];
  readonly logger?: MigrationLogger;
  readonly lockedChecksums?: Readonly<Record<string, string>>;
}

/** {@link runMigrationsWithDb} on a connection of its own, closed afterwards. */
export async function runMigrations({
  connectionString,
  sources,
  logger,
  lockedChecksums,
}: RunMigrationsOptions): Promise<MigrationRunResult> {
  const db = createRawDb({ connectionString, maxConnections: 1 });
  try {
    return await runMigrationsWithDb({
      db,
      sources,
      ...(logger === undefined ? {} : { logger }),
      ...(lockedChecksums === undefined ? {} : { lockedChecksums }),
    });
  } finally {
    await db.close();
  }
}

// ============================================================================
// Reset
// ============================================================================

/**
 * Empty the database: drop the `public` schema with everything in it and
 * create it again the way a new database has it (owned by `pg_database_owner`,
 * usable by everyone, writable by the owner). Cluster roles are not touched.
 *
 * Run it as the owner of the database (`bslt_owner`), then {@link runMigrations}.
 */
export async function resetSchema(db: RawDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.raw(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public AUTHORIZATION pg_database_owner;
      GRANT USAGE ON SCHEMA public TO PUBLIC;
      COMMENT ON SCHEMA public IS 'standard public schema';
    `);
  });
}
