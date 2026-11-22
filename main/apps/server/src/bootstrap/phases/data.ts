// main/apps/server/src/bootstrap/phases/data.ts

import {
  createDbClient,
  createPostgresPubSub,
  createPostgresQueueStore,
  createSqlSearchProvider,
  findRuntimeRoleProblems,
  inspectDatabaseRole,
  type DbClient,
  type ServerSearchProvider,
  type SessionContext,
  type SqlTableConfig,
} from '@bslt/db';
import { authGuardReposFromDb } from '@bslt/identity/server';
import {
  buildConnectionString,
  buildListenConnectionString,
  buildWorkerConnectionString,
} from '@bslt/server-system/config';

import { type DataContext, type PlatformContext } from '../context';

import type { AppConfig } from '@bslt/server-system/config';

/**
 * The two runtime pools.
 *
 * - `app` (`DATABASE_URL`, role `bslt_app`): user sessions, platform admins
 *   included. Every query runs in a transaction that has switched to
 *   `authenticated`, so the RLS policies apply. It also serves the module
 *   kernel's anonymous viewer (`k.db.viewer(null)`): a session without a user id
 *   keeps the login role `bslt_app`, so only user policies that hold for a NULL
 *   user (`public_read`) apply.
 * - `system` (`WORKER_DATABASE_URL`, role `bslt_worker`): every other path
 *   without a user session — public auth flows, provider webhooks, the auth
 *   guard's own lookups, boot-wired services, jobs, cron, retention, admin
 *   search, and the context's explicit `system` port. It reaches cross-user
 *   rows only through `bslt_system` policies.
 */
export interface DataPools {
  readonly app: DbClient;
  readonly system: DbClient;
}

/**
 * Pick the database handle for an authenticated request: always the app pool,
 * as a user session (role `authenticated`, `app.user_id`).
 *
 * A platform admin is a user session like any other. What it may reach beyond
 * its own rows is decided by the admin policies, which ask the database
 * (`sys_current_user_is_platform_admin()` reads `users.role`), not by the role
 * claim of the JWT: that claim is copied at token mint and survives a demotion
 * until the token expires. No session reaches the system pool from here.
 *
 * @param pools - The app and system pools.
 * @param session - Verified session (user id and role come from the JWT; the
 *   tenant id was already checked against the user's memberships).
 * @returns A session-scoped client on the app pool.
 */
export function scopeSessionDb(pools: DataPools, session: SessionContext): DbClient {
  return pools.app.withSession(session);
}

/**
 * Refuse to start in production when a runtime connection would defeat RLS
 * (superuser, BYPASSRLS, table owner, app/worker collapsed into one role).
 * Outside production the legacy single-superuser setup only warns.
 *
 * @param pools - The app and system pools.
 * @param env - Runtime environment.
 * @param log - Logger for the non-production warning.
 * @throws {Error} In production when any problem is found, and in every
 *   environment when the roles cannot be inspected.
 */
export async function verifyDatabaseRoles(
  pools: DataPools,
  env: AppConfig['env'],
  log: { warn(message: string): void },
): Promise<void> {
  const [app, worker] = await Promise.all([
    inspectDatabaseRole(pools.app),
    inspectDatabaseRole(pools.system),
  ]);
  const problems = findRuntimeRoleProblems(app, worker);
  if (problems.length === 0) return;

  const report = `Database roles do not enforce RLS:\n- ${problems.join('\n- ')}`;
  if (env === 'production') {
    throw new Error(report);
  }
  log.warn(
    `${report}\n(Tolerated outside production as the legacy single-role fallback; see docs/deploy/env.md#database-roles.)`,
  );
}

const USERS_SEARCH_TABLE: SqlTableConfig = {
  table: 'identity_users',
  primaryKey: 'id',
  columns: [
    { field: 'id', column: 'id', type: 'string', filterable: true, sortable: true },
    { field: 'email', column: 'email', type: 'string', filterable: true, sortable: true },
    { field: 'username', column: 'username', type: 'string', filterable: true, sortable: true },
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
  /** The user-session pool (the system pool is `context.db`). */
  appDb?: DbClient | undefined;
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
  const systemConnectionString = buildWorkerConnectionString(config.database);
  const poolOptions = {
    maxConnections: config.database.maxConnections,
    ssl: config.database.ssl,
  };
  // Each runtime pool runs under its own statement, lock and idle-transaction
  // limits. The owner connection of the migration job is not created here and
  // has none.
  const db = createDbClient({
    connectionString: systemConnectionString,
    ...poolOptions,
    timeouts: config.database.timeouts.worker,
  });
  const appDb = createDbClient({
    connectionString: buildConnectionString(config.database),
    ...poolOptions,
    timeouts: config.database.timeouts.app,
  });
  const pools: DataPools = { app: appDb, system: db };
  await verifyDatabaseRoles(pools, config.env, platform.log);

  // Its own connection, direct to Postgres: a LISTEN session does not survive
  // PgBouncer's transaction pooling (LISTEN_DATABASE_URL, docs/deploy/env.md#database-roles).
  const pubsubAdapter = createPostgresPubSub({
    connectionString: buildListenConnectionString(config.database),
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

  const context = createDataContext(config, platform, pools);

  context.log.info('Data phase bootstrapped');

  return {
    context,
    stopPubSubAdapter: () => pubsubAdapter.stop(),
    appDb,
  };
}

/**
 * Build the data layer of the context from the two runtime pools.
 *
 * Pure wiring: it opens no connection and sends nothing. Every boot handle
 * (`db`, `repos`, queue store, search) sits on the system pool;
 * `contextualize` is the one place a request moves to the app pool.
 *
 * @param config - Application configuration (search settings).
 * @param platform - Platform services to carry over.
 * @param pools - The app and system pools, already connected to their roles.
 * @returns The frozen data context.
 */
export function createDataContext(
  config: AppConfig,
  platform: PlatformContext,
  pools: DataPools,
): DataContext {
  // The boot handles are the system pool.
  const db = pools.system;
  const repos = authGuardReposFromDb(db);

  const queueStore = createPostgresQueueStore(db);
  const queue = {
    getStats: async () => {
      const stats = await queueStore.getQueueStats();
      return { pending: stats.pending, failed: stats.failed };
    },
  };

  const search = createSearchProvider(config, db, repos);

  return Object.freeze({
    ...platform,
    db,
    repos,
    search,
    queue,
    queueStore,
    contextualize(session: SessionContext) {
      const scopedDb = scopeSessionDb(pools, session);
      return {
        db: scopedDb,
        repos: authGuardReposFromDb(scopedDb),
      };
    },
  });
}

export async function stopDataPhase(state: Partial<DataPhaseState> | undefined): Promise<void> {
  const context = state?.context;
  if (!context) return;

  if (state.stopPubSubAdapter !== undefined) {
    await state.stopPubSubAdapter();
  }
  await callIfMethod(context.db, 'close');
  // In the un-split dev fallback both pools are the same client.
  if (state.appDb !== undefined && state.appDb !== context.db) {
    await callIfMethod(state.appDb, 'close');
  }
}

function createSearchProvider(
  config: AppConfig,
  db: ReturnType<typeof createDbClient>,
  repos: unknown,
): ServerSearchProvider {
  return createSqlSearchProvider(db, repos, USERS_SEARCH_TABLE, {
    name: 'sql-users',
    ...config.search.config,
  });
}
