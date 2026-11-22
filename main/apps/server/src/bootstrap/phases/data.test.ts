// main/apps/server/src/bootstrap/phases/data.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapDataPhase,
  createDataContext,
  scopeSessionDb,
  verifyDatabaseRoles,
  type DataPools,
} from './data';

import type { PlatformContext } from '../context';
import type { DbClient, SessionContext } from '@bslt/db';
import type { AppConfig } from '@bslt/server-system/config';

// Only the two constructors that open connections; everything else is real.
const dbConstructors = vi.hoisted(() => ({
  createDbClient: vi.fn(),
  createPostgresPubSub: vi.fn(),
}));
vi.mock('@bslt/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bslt/db')>()),
  ...dbConstructors,
}));

interface FakeDb {
  readonly label: string;
  readonly withSession: ReturnType<typeof vi.fn>;
  readonly queryOne: ReturnType<typeof vi.fn>;
}

function fakeDb(label: string, roleRow: Record<string, unknown> | null = null): FakeDb {
  const db: FakeDb = {
    label,
    withSession: vi.fn((session: SessionContext) => ({
      label: `${label}+session`,
      session,
      queryOne: vi.fn().mockResolvedValue(null),
    })),
    queryOne: vi.fn().mockResolvedValue(roleRow),
  };
  return db;
}

function pools(app: FakeDb, system: FakeDb): DataPools {
  return { app: app as unknown as DbClient, system: system as unknown as DbClient };
}

const HEALTHY_APP = {
  name: 'bslt_app',
  superuser: false,
  bypass_rls: false,
  owns_tables: false,
  acts_as_system: false,
  escalates: false,
};
const HEALTHY_WORKER = {
  name: 'bslt_worker',
  superuser: false,
  bypass_rls: false,
  owns_tables: false,
  acts_as_system: true,
  escalates: false,
};
const LEGACY_SUPERUSER = {
  name: 'postgres',
  superuser: true,
  bypass_rls: true,
  owns_tables: true,
  acts_as_system: true,
  escalates: false,
};

describe('scopeSessionDb', () => {
  it('runs a user session on the app pool, where it acts as `authenticated`', () => {
    const app = fakeDb('app');
    const system = fakeDb('system');
    const session = { userId: 'u1', role: 'user', orgId: 't1' };

    scopeSessionDb(pools(app, system), session);

    expect(app.withSession).toHaveBeenCalledWith(session);
    expect(system.withSession).not.toHaveBeenCalled();
  });

  it.each(['admin', 'moderator', 'user', undefined, '', 'ADMIN', ' admin'])(
    'runs role %j on the app pool as a user session: no role claim selects the system pool',
    (role) => {
      const app = fakeDb('app');
      const system = fakeDb('system');
      const session: SessionContext =
        role === undefined ? { userId: 'u1' } : { userId: 'u1', role };

      const scoped = scopeSessionDb(pools(app, system), session);

      // With the user id: the client switches to `authenticated` and sets
      // app.user_id, so the policies decide what an admin reaches (admin rights
      // come from users.role in the database, not from this JWT claim).
      expect(app.withSession).toHaveBeenCalledTimes(1);
      expect(app.withSession).toHaveBeenCalledWith(session);
      expect(scoped).not.toBe(system);
      expect(system.withSession).not.toHaveBeenCalled();
    },
  );
});

describe('createDataContext', () => {
  function platform(): PlatformContext {
    return {
      config: {} as AppConfig,
      pubsub: { publishLocal: vi.fn(), setAdapter: vi.fn() },
      cache: {},
      errorTracker: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as PlatformContext;
  }

  function config(): AppConfig {
    return { search: {} } as unknown as AppConfig;
  }

  it('puts the boot handles on the system pool and opens no connection', async () => {
    const app = fakeDb('app');
    const system = fakeDb('system');

    const context = createDataContext(config(), platform(), pools(app, system));

    expect(context.db).toBe(system);
    // Building the context is pure wiring: nothing was sent to either pool.
    expect(app.withSession).not.toHaveBeenCalled();
    expect(system.withSession).not.toHaveBeenCalled();
    expect(app.queryOne).not.toHaveBeenCalled();
    expect(system.queryOne).not.toHaveBeenCalled();

    // The boot repositories query the system pool.
    await context.repos.users.findById('u1');
    expect(system.queryOne).toHaveBeenCalledTimes(1);
    expect(app.queryOne).not.toHaveBeenCalled();
  });

  it('contextualize() scopes db and repos onto the app pool with the session', async () => {
    const app = fakeDb('app');
    const system = fakeDb('system');
    const context = createDataContext(config(), platform(), pools(app, system));
    const session = { userId: 'u1', role: 'admin', orgId: 't1' };

    const scoped = context.contextualize(session);

    expect(app.withSession).toHaveBeenCalledWith(session);
    expect(system.withSession).not.toHaveBeenCalled();
    const scopedDb = scoped.db as unknown as { label: string; queryOne: ReturnType<typeof vi.fn> };
    expect(scopedDb.label).toBe('app+session');

    // Repositories are rebuilt over the scoped client, never shared with the boot ones.
    expect(scoped.repos).not.toBe(context.repos);
    await scoped.repos.users.findById('u1');
    expect(scopedDb.queryOne).toHaveBeenCalledTimes(1);
    expect(system.queryOne).not.toHaveBeenCalled();
    expect(app.queryOne).not.toHaveBeenCalled();
  });

  it('hands a tenant session to the app pool as it is: one schema, no routing', () => {
    const app = fakeDb('app');
    const system = fakeDb('system');
    const context = createDataContext(config(), platform(), pools(app, system));
    const session = { userId: 'u1', role: 'user', orgId: 'tenant-1' };

    context.contextualize(session);

    expect(app.withSession).toHaveBeenCalledWith(session);
    expect(system.withSession).not.toHaveBeenCalled();
  });
});

describe('verifyDatabaseRoles', () => {
  const log = () => ({ warn: vi.fn() });

  it('accepts the bootstrapped role split silently', async () => {
    const logger = log();
    await verifyDatabaseRoles(
      pools(fakeDb('app', HEALTHY_APP), fakeDb('system', HEALTHY_WORKER)),
      'production',
      logger,
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('refuses to start in production when the app connects as a superuser', async () => {
    const logger = log();
    await expect(
      verifyDatabaseRoles(
        pools(fakeDb('app', LEGACY_SUPERUSER), fakeDb('system', HEALTHY_WORKER)),
        'production',
        logger,
      ),
    ).rejects.toThrow(/DATABASE_URL.*superuser/s);
  });

  it('refuses to start in production when the worker cannot reach cross-user rows', async () => {
    await expect(
      verifyDatabaseRoles(
        pools(
          fakeDb('app', HEALTHY_APP),
          fakeDb('system', { ...HEALTHY_WORKER, acts_as_system: false }),
        ),
        'production',
        log(),
      ),
    ).rejects.toThrow(/WORKER_DATABASE_URL/);
  });

  it('only warns for the legacy single-superuser fallback outside production', async () => {
    const logger = log();
    const legacy = fakeDb('legacy', LEGACY_SUPERUSER);

    await verifyDatabaseRoles(pools(legacy, legacy), 'development', logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message] = logger.warn.mock.calls[0] as [string];
    expect(message).toMatch(/RLS/);
  });

  it('fails closed when the role cannot be inspected', async () => {
    const broken = fakeDb('app');
    broken.queryOne.mockRejectedValue(new Error('connection refused'));

    await expect(
      verifyDatabaseRoles(pools(broken, fakeDb('system', HEALTHY_WORKER)), 'development', log()),
    ).rejects.toThrow(/connection refused/);
  });
});

describe('bootstrapDataPhase', () => {
  const APP_URL = 'postgresql://bslt_app:a@pgbouncer:5432/app';
  const WORKER_URL = 'postgresql://bslt_worker:w@pgbouncer:5432/app';
  // Direct to Postgres: PgBouncer's transaction pooling does not carry LISTEN.
  const LISTEN_URL = 'postgresql://bslt_worker:w@postgres:5432/app';

  function bootPlatform(): PlatformContext {
    return {
      config: {} as AppConfig,
      pubsub: { publishLocal: vi.fn(), setAdapter: vi.fn() },
      cache: {},
      errorTracker: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as PlatformContext;
  }

  function bootConfig(database: Record<string, unknown>): AppConfig {
    return {
      env: 'production',
      search: {},
      database: { maxConnections: 5, ssl: false, timeouts: NO_LIMITS, ...database },
    } as unknown as AppConfig;
  }

  const POOL_WITHOUT_LIMITS = {
    statementTimeoutMs: 0,
    lockTimeoutMs: 0,
    idleInTransactionTimeoutMs: 0,
  };
  const NO_LIMITS = { app: POOL_WITHOUT_LIMITS, worker: POOL_WITHOUT_LIMITS };

  /** The URL the pub/sub adapter listens on, and the URLs the pools were created with. */
  async function connectionsFor(
    database: Record<string, unknown>,
  ): Promise<{ listen: string; pools: string[] }> {
    dbConstructors.createDbClient.mockImplementation(
      ({ connectionString }: { connectionString: string }) =>
        fakeDb(
          connectionString,
          connectionString.includes('bslt_app') ? HEALTHY_APP : HEALTHY_WORKER,
        ),
    );
    dbConstructors.createPostgresPubSub.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    });

    await bootstrapDataPhase(bootConfig(database), bootPlatform());

    expect(dbConstructors.createPostgresPubSub).toHaveBeenCalledTimes(1);
    const [options] = dbConstructors.createPostgresPubSub.mock.calls[0] as [
      { connectionString: string },
    ];
    // Read before the mocks are cleared for the next test.
    const pools = dbConstructors.createDbClient.mock.calls.map(
      ([pool]) => (pool as { connectionString: string }).connectionString,
    );
    dbConstructors.createPostgresPubSub.mockClear();
    dbConstructors.createDbClient.mockClear();
    return { listen: options.connectionString, pools };
  }

  it('listens for pub/sub notifications on LISTEN_DATABASE_URL, not through the pools', async () => {
    const { listen, pools } = await connectionsFor({
      connectionString: APP_URL,
      workerConnectionString: WORKER_URL,
      listenConnectionString: LISTEN_URL,
    });

    expect(listen).toBe(LISTEN_URL);
    // The pools still use their own URLs.
    expect([...pools].sort()).toEqual([APP_URL, WORKER_URL].sort());
  });

  it('gives each runtime pool its own limits from config', async () => {
    const timeouts = {
      app: {
        statementTimeoutMs: 30_000,
        lockTimeoutMs: 10_000,
        idleInTransactionTimeoutMs: 60_000,
      },
      worker: {
        statementTimeoutMs: 120_000,
        lockTimeoutMs: 10_000,
        idleInTransactionTimeoutMs: 60_000,
      },
    };
    dbConstructors.createDbClient.mockImplementation(
      ({ connectionString }: { connectionString: string }) =>
        fakeDb(
          connectionString,
          connectionString.includes('bslt_app') ? HEALTHY_APP : HEALTHY_WORKER,
        ),
    );
    dbConstructors.createPostgresPubSub.mockReturnValue({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    });

    await bootstrapDataPhase(
      bootConfig({ connectionString: APP_URL, workerConnectionString: WORKER_URL, timeouts }),
      bootPlatform(),
    );

    const limitsByPool = Object.fromEntries(
      dbConstructors.createDbClient.mock.calls.map(([options]) => {
        const pool = options as { connectionString: string; timeouts?: unknown };
        return [pool.connectionString, pool.timeouts];
      }),
    );
    expect(limitsByPool).toEqual({ [APP_URL]: timeouts.app, [WORKER_URL]: timeouts.worker });
    dbConstructors.createPostgresPubSub.mockClear();
    dbConstructors.createDbClient.mockClear();
  });

  it('listens on the worker connection when no LISTEN_DATABASE_URL is set (outside production)', async () => {
    const { listen } = await connectionsFor({
      connectionString: APP_URL,
      workerConnectionString: WORKER_URL,
    });

    expect(listen).toBe(WORKER_URL);
  });
});
