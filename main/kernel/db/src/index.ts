// main/kernel/db/src/index.ts
/**
 * Database Package Entry Point
 *
 * Exports:
 * - Client: Raw PostgreSQL client (createRawDb, createDbClient)
 * - Schema: TypeScript types for kernel system tables (sys_outbox, sys_jobs, sys_cron)
 * - Repositories: Kernel system table repositories (outbox, jobs, cron)
 * - Validation: Schema validation utilities
 * - Utils: Database helpers (case conversion, formatting)
 * - Builder: SQL query builder
 *
 * @module @bslt/db
 */

// Client
export {
  buildConnectionString,
  buildMigrationConnectionString,
  buildWorkerConnectionString,
  canReachDatabase,
  createDbClient,
  createDbFromSql,
  createRawDb,
  DEFAULT_TRANSACTION_RETRY,
  isRetryableTransactionError,
  resolveConnectionStringWithFallback,
  sessionSettingsQuery,
  timeoutSettingsQuery,
  toSafeNumber,
  transactionRetryDelay,
  type DbClient,
  type DbConfig,
  type DbRuntimeOptions,
  type DbTimeouts,
  type IsolationLevel,
  type QueryOptions,
  type QueryResult,
  type RawDb,
  type SessionContext,
  type TransactionOptions,
  type TransactionRetryEvent,
  type TransactionRetryOptions,
} from './client';

// Schema (kernel system tables)
export { CRON_JOBS_TABLE, JOB_QUEUE_TABLE, JOB_STATUSES } from './schema';

// Repositories (kernel system outbox & cron)
export {
  advanceCronSchedule,
  claimDueCronRows,
  claimUndispatchedOutboxRows,
  insertOutboxEvent,
  markOutboxDispatched,
  pruneDispatchedOutbox,
  selectOwnedRealtimeRows,
  tryAcquireCronLeaderLock,
  updateOwnedRealtimeRow,
  upsertCronSchedule,
  type CursorPaginatedResult,
  type CursorPaginationOptions,
  type DueCronRow,
  type TimeRangeFilter,
} from './repositories';

// Migrations: the multi-source runner
export {
  checksumSql,
  isNoTransaction,
  KERNEL_SOURCE_ID,
  KERNEL_SQL_DIR,
  migrateDatabase,
  MigrationResetRequiredError,
  migrationSources,
  orderSources,
  readSourceFiles,
  RESET_COMMAND,
  RESET_REQUIRED_EXIT_CODE,
  resetDatabase,
  resetSchema,
  runMigrateEntry,
  runMigrations,
  runMigrationsWithDb,
  splitSqlStatements,
  type MigrateDatabaseOptions,
  type MigrateEntryOptions,
  type MigrationFile,
  type MigrationLogger,
  type MigrationRunResult,
  type MigrationSource,
  type RunMigrationsOptions,
  type RunMigrationsWithDbOptions,
  type SourceFiles,
} from './migrate';

// Roles — owner / app / worker split that makes RLS enforceable
export {
  bootstrapClusterRoles,
  bootstrapDatabaseRoles,
  DB_ROLES,
  findRuntimeRoleProblems,
  inspectDatabaseRole,
  resolveRoleBootstrapEnv,
  scramSha256Verifier,
  type DatabaseRoleFacts,
  type DatabaseRolePasswords,
  type RoleBootstrapEnv,
} from './roles';

// Validation
export {
  getExistingTables,
  REQUIRED_TABLES,
  requireValidSchema,
  SchemaValidationError,
  validateSchema,
  type RequiredTable,
  type SchemaValidationResult,
} from './validation';

// Utils
export {
  applyCursorPagination,
  applyOffsetPagination,
  buildColumnList,
  buildInsertClause,
  buildPostgresDsn,
  buildSetClause,
  camelizeKeys,
  camelToSnake,
  formatJsonb,
  getQueryParam,
  PaginationError,
  parseJsonb,
  parseLimitParam,
  parsePageParam,
  parseSortByParam,
  parseSortOrderParam,
  snakeifyKeys,
  snakeToCamel,
  toCamelCase,
  toCamelCaseArray,
  toSnakeCase,
  type ColumnMapping,
  type CountResult,
  type CursorPaginationQueryBuilder,
  type OffsetPaginationQueryBuilder,
  type PostgresDsnParts,
} from './utils';

// Builder
export {
  and,
  deleteFrom,
  eq,
  eqSubquery,
  escapeIdentifier,
  gt,
  gte,
  ilike,
  inArray,
  insert,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  rawCondition,
  select,
  selectCount,
  update,
  type QueryBuilder,
  type SqlFragment,
} from './builder';

// Transaction
export { isInTransaction, withTransaction } from './utils';

// Optimistic Locking

// Queue
export {
  createPostgresQueueStore,
  PostgresQueueStore,
  QueueServer,
  createQueueServer,
  queuesForRole,
  MemoryQueueStore,
  createMemoryQueueStore,
  type QueueMetrics,
  type QueueServerJobSpec,
  type QueueServerOptions,
} from './queue';

export {
  type JobDetails,
  type JobListOptions,
  type JobListResult,
  type JobStatus,
  type QueueConfig,
  type QueueSnapshotMetrics,
  type QueueStats,
  type QueueStore,
  type Task,
  type TaskError,
  type TaskHandler,
  type TaskHandlers,
  type TaskResult,
} from './queue';

// Pagination Helpers
export { createPaginationHelpers, type PaginationHelpers } from './utils/pagination.helpers';

// PubSub
export {
  createPostgresChannelListener,
  createPostgresPubSub,
  PostgresPubSub,
  type PostgresChannelListener,
} from './pubsub';
export type { PostgresPubSubOptions, PubSubMessage } from './pubsub';

// Search
export { createSqlSearchProvider, FILTER_OPERATORS, SqlSearchProvider } from './search';

export type {
  IndexHint,
  SearchContext,
  SearchMetrics,
  SearchProviderConfig,
  SearchProviderFactoryOptions,
  SearchProviderType,
  SearchResultWithMetrics,
  ServerSearchProvider,
  SqlColumnMapping,
  SqlCursorData,
  SqlFilterResult,
  SqlOperatorMap,
  SqlOperatorTranslator,
  SqlQueryOptions,
  SqlSearchProviderConfig,
  SqlTableConfig,
} from './search/types';
