// main/kernel/db/src/migrate/index.ts
export {
  migrateDatabase,
  RESET_REQUIRED_EXIT_CODE,
  resetDatabase,
  runMigrateEntry,
  type MigrateDatabaseOptions,
  type MigrateEntryOptions,
} from './database';
export {
  checksumSql,
  isNoTransaction,
  KERNEL_SOURCE_ID,
  MigrationResetRequiredError,
  orderSources,
  readSourceFiles,
  RESET_COMMAND,
  resetSchema,
  runMigrations,
  runMigrationsWithDb,
  type MigrationFile,
  type MigrationLogger,
  type MigrationRunResult,
  type MigrationSource,
  type RunMigrationsOptions,
  type RunMigrationsWithDbOptions,
  type SourceFiles,
} from './runner';
export { KERNEL_SQL_DIR, migrationSources } from './sources';
export { splitSqlStatements } from './sql-statements';
