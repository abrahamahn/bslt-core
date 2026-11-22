// main/kernel/db/src/migrate/database.ts
/**
 * `bslt db migrate` and `bslt db reset`: the migration runner on this
 * repository's sources, through the owner role's connection.
 *
 * The repository tooling (`main/tools/scripts/db`) and the migrate entry of
 * the production image (./entry.ts) both call these, so a deploy and a
 * developer build a database with the same code.
 */

import { buildMigrationConnectionString, createRawDb } from '../client';

import {
  MigrationResetRequiredError,
  resetSchema,
  runMigrations,
  type MigrationLogger,
  type MigrationRunResult,
  type MigrationSource,
} from './runner';
import { loadLockedMigrationChecksums, migrationSources } from './sources';

export interface MigrateDatabaseOptions {
  /** Where the connection comes from: `MIGRATION_DATABASE_URL`, the owner role. Default: `process.env`. */
  readonly env?: Record<string, string | undefined>;
  readonly logger?: MigrationLogger;
  /** Default: the sources of this repository. */
  readonly sources?: readonly MigrationSource[];
}

/**
 * Apply every pending migration and required seed.
 *
 * @throws {Error} In production when `MIGRATION_DATABASE_URL` is unset.
 * @throws {MigrationResetRequiredError} When the database was built from other
 *   baselines than the sources hold now.
 */
export async function migrateDatabase(
  options: MigrateDatabaseOptions = {},
): Promise<MigrationRunResult> {
  const logger = options.logger ?? console;
  logger.log('Migrating the database...');
  const lockedChecksums =
    options.sources === undefined ? loadLockedMigrationChecksums() : undefined;
  return runMigrations({
    connectionString: buildMigrationConnectionString(options.env ?? process.env),
    sources: options.sources ?? migrationSources(),
    logger,
    ...(lockedChecksums !== undefined ? { lockedChecksums } : {}),
  });
}

/**
 * Drop everything in the database and build it again from the sources. This is
 * what an edited baseline needs before `foundation-v1` (restructure plan 9.3):
 * every row is lost.
 *
 * @throws {Error} With `NODE_ENV=production`; nothing is dropped.
 */
export async function resetDatabase(
  options: MigrateDatabaseOptions = {},
): Promise<MigrationRunResult> {
  const env = options.env ?? process.env;
  if (env['NODE_ENV'] === 'production') {
    throw new Error('bslt db reset drops every table: it does not run with NODE_ENV=production');
  }
  const logger = options.logger ?? console;
  const connectionString = buildMigrationConnectionString(env);

  logger.log('Dropping every object of the database...');
  const db = createRawDb({ connectionString, maxConnections: 1 });
  try {
    await resetSchema(db);
  } finally {
    await db.close();
  }
  return migrateDatabase({ ...options, env, logger });
}

// ============================================================================
// The process entry
// ============================================================================

/** Exit code of the migrate entry when the database has to be rebuilt from the baselines. */
export const RESET_REQUIRED_EXIT_CODE = 3;

export interface MigrateEntryOptions {
  readonly env?: Record<string, string | undefined>;
  readonly logger?: MigrationLogger;
  /** Where failures are written. Default: standard error. */
  readonly error?: (message: string) => void;
}

/**
 * Run the migrations and return a process exit code: 0 migrated or up to
 * date, 1 failed, {@link RESET_REQUIRED_EXIT_CODE} the database was built from
 * other baselines and has to be rebuilt. Only the message of a failure is
 * written, never the error object: it can carry a connection string.
 */
export async function runMigrateEntry(options: MigrateEntryOptions = {}): Promise<number> {
  const error =
    options.error ??
    ((message: string): void => {
      process.stderr.write(`${message}\n`);
    });
  try {
    await migrateDatabase({
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
    return 0;
  } catch (failure) {
    if (failure instanceof MigrationResetRequiredError) {
      error(failure.message);
      return RESET_REQUIRED_EXIT_CODE;
    }
    error(`Migration failed: ${failure instanceof Error ? failure.message : 'unknown error'}`);
    return 1;
  }
}
