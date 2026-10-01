// main/apps/server/src/bootstrap/phases/data.ts

import {
  createDbClient,
  createPostgresPubSub,
  createPostgresQueueStore,
  createRepositories,
  createSqlSearchProvider,
  createWriteService,
  resolveTenantSchema,
  type ServerSearchProvider,
  type SessionContext,
  type SqlTableConfig,
} from '@bslt/db';
import { buildConnectionString } from '@bslt/server-system/config';

import { type DataContext, type PlatformContext } from '../context';

import type { AppConfig } from '@bslt/shared/system/config';

const USERS_SEARCH_TABLE: SqlTableConfig = {
  table: 'users',
  primaryKey: 'id',
  columns: [
    { field: 'id', column: 'id', type: 'string', filterable: true, sortable: true },
    { field: 'email', column: 'email', type: 'string', filterable: true, sortable: true },
    { field: 'username', column: 'username', type: 'string', filterable: true, sortable: true },
    { field: 'firstName', column: 'first_name', type: 'string', filterable: true, sortable: true },
    { field: 'lastName', column: 'last_name', type: 'string', filterable: true, sortable: true },
    { field: 'role', column: 'role', type: 'string', filterable: true, sortable: true },
    {
      field: 'emailVerified',
      column: 'email_verified',
      type: 'boolean',
      filterable: true,
      sortable: true,
    },
    { field: 'createdAt', column: 'created_at', type: 'date', filterable: true, sortable: true },
    { field: 'updatedAt', column: 'updated_at', type: 'date', filterable: true, sortable: true },
  ],
};

export interface DataPhaseState {
  context: DataContext;
  stopPubSubAdapter?: (() => Promise<void>) | undefined;
}

type CloseableMethod = 'close' | 'stop';

function hasMethod<K extends PropertyKey>(
  value: unknown,
  key: K,
): value is Record<K, () => unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    key in value &&
    typeof (value as Record<PropertyKey, unknown>)[key] === 'function'
  );
}

async function callIfMethod(value: unknown, method: CloseableMethod): Promise<void> {
  if (hasMethod(value, method)) {
    await value[method]();
  }
}

export async function bootstrapDataPhase(
  config: AppConfig,
  platform: PlatformContext,
): Promise<DataPhaseState> {
  const connectionString = buildConnectionString(config.database);
  const db = createDbClient({
    connectionString,
    maxConnections: config.database.maxConnections,
    ssl: config.database.ssl,
  });
  const repos = createRepositories(db);

  const pubsubAdapter = createPostgresPubSub({
    connectionString,
    ssl: config.database.ssl,
    onMessage: (key, version) => {
      platform.pubsub.publishLocal(key, version);
    },
    onError: (error) => {
      platform.log.error(error, 'Postgres pubsub error');
    },
  });
  await pubsubAdapter.start();
  platform.pubsub.setAdapter(pubsubAdapter);

  const queueStore = createPostgresQueueStore(db);
  const queue = {
    getStats: async () => {
      const stats = await queueStore.getQueueStats();
      return { pending: stats.pending, failed: stats.failed };
    },
  };

  const queueLogger = {
    debug: (message: string, meta?: Record<string, unknown>) => {
      platform.log.debug(message, meta);
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      platform.log.info(message, meta);
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      platform.log.warn(message, meta);
    },
    error: (message: string | Error, meta?: Record<string, unknown>) => {
      if (message instanceof Error) {
        platform.log.error(message, message.message, meta);
        return;
      }
      platform.log.error(new Error(message), message, meta);
    },
  };

  const write = createWriteService({
    db,
    pubsub: platform.pubsub,
    log: queueLogger,
  });

  const search = createSearchProvider(config, db, repos);

  const context: DataContext = Object.freeze({
    ...platform,
    db,
    repos,
    search,
    queue,
    queueStore,
    write,
    contextualize(session: SessionContext) {
      // In schema-per-tenant mode, route the session to the tenant's schema; in
      // the default shared-rls mode this is always undefined, so the session is
      // passed through unchanged (no search_path emitted).
      const schema = resolveTenantSchema(config.tenancy.mode, session.tenantId);
      const scopedDb = db.withSession(schema === undefined ? session : { ...session, schema });
      return { db: scopedDb, repos: createRepositories(scopedDb) };
    },
  });

  context.log.info('Data phase bootstrapped');

  return {
    context,
    stopPubSubAdapter: () => pubsubAdapter.stop(),
  };
}

export async function stopDataPhase(state: Partial<DataPhaseState> | undefined): Promise<void> {
  const context = state?.context;
  if (!context) return;

  await callIfMethod(context.write, 'close');
  if (state.stopPubSubAdapter !== undefined) {
    await state.stopPubSubAdapter();
  }
  await callIfMethod(context.db, 'close');
}

function createSearchProvider(
  config: AppConfig,
  db: ReturnType<typeof createDbClient>,
  repos: ReturnType<typeof createRepositories>,
): ServerSearchProvider {
  return createSqlSearchProvider(db, repos, USERS_SEARCH_TABLE, {
    name: 'sql-users',
    ...config.search.config,
  });
}
