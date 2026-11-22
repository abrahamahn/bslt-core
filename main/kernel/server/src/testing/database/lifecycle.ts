// main/kernel/server/src/testing/database/lifecycle.ts
/**
 * Isolated PostgreSQL test database lifecycle with the production role split
 * (`bslt_owner`, `bslt_app`, `bslt_worker`). Kept free of `vitest` and of
 * top-level probes so CLI commands (`bslt db catalog`) can import it directly.
 */

import { randomUUID } from 'node:crypto';

import {
  bootstrapClusterRoles,
  buildConnectionString,
  createRawDb,
  DB_ROLES,
  inspectDatabaseRole,
  migrationSources,
  runMigrations,
  type DbClient,
} from '@bslt/db';

import { initEnv } from '../../config/factory';

import {
  describeHarnessAdminProblem,
  resolveHarnessProvisioning,
  type HarnessProvisioning,
} from './provisioning';

export interface TestDatabase {
  connectionString: string;
  db: DbClient;
  appConnectionString: string;
  appDb: DbClient;
  ownerConnectionString: string;
  ownerDb: DbClient;
  adminConnectionString: string;
  readonly adminDb: DbClient;
  bootstrapRoles: () => Promise<void>;
  destroy: () => Promise<void>;
  migrate: () => Promise<void>;
  truncate: (tables: string) => Promise<void>;
}

const DEADLOCK_CODE = '40P01';

async function truncateWithDeadlockRetry(
  db: DbClient,
  tables: string,
  attempts = 5,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await db.raw(`TRUNCATE ${tables}`);
      return;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = error instanceof Error ? error.message : String(error);
      const isDeadlock = code === DEADLOCK_CODE || /deadlock/iu.test(message);
      if (!isDeadlock || attempt >= attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

async function openClusterAdmin(provisioning: HarnessProvisioning): Promise<DbClient> {
  const admin = createRawDb(provisioning.adminConnectionString);
  let problem: string | null;
  try {
    problem = describeHarnessAdminProblem(
      await inspectDatabaseRole(admin),
      provisioning.adminSource,
    );
  } catch (error) {
    await admin.close().catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The real-DB harness could not use its admin connection (from ${provisioning.adminSource}): ${reason}`,
    );
  }
  if (problem !== null) {
    await admin.close();
    throw new Error(problem);
  }
  return admin;
}

function connectionStringFor(
  base: string,
  database: string,
  credentials?: { readonly user: string; readonly password: string },
): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (credentials !== undefined) {
    url.username = encodeURIComponent(credentials.user);
    url.password = encodeURIComponent(credentials.password);
  }
  return url.toString();
}

export async function createTestDatabase(
  options: { baseConnectionString?: string } = {},
): Promise<TestDatabase> {
  await initEnv();

  const provisioning = resolveHarnessProvisioning(
    process.env,
    options.baseConnectionString ?? buildConnectionString(),
  );
  const { adminConnectionString: clusterAdmin, passwords } = provisioning;
  const mainDb = await openClusterAdmin(provisioning);

  const dbName = `test_${randomUUID().replace(/-/gu, '_')}`;

  try {
    await bootstrapClusterRoles(mainDb, passwords);
    await mainDb.raw(`CREATE DATABASE ${dbName} OWNER ${DB_ROLES.owner}`);
    await mainDb.close();

    const workerConnectionString = connectionStringFor(clusterAdmin, dbName, {
      user: DB_ROLES.worker,
      password: passwords.worker,
    });
    const appConnectionString = connectionStringFor(clusterAdmin, dbName, {
      user: DB_ROLES.app,
      password: passwords.app,
    });
    const ownerConnectionString = connectionStringFor(clusterAdmin, dbName, {
      user: DB_ROLES.owner,
      password: passwords.owner,
    });
    const adminConnectionString = connectionStringFor(clusterAdmin, dbName);

    const testDb = createRawDb(workerConnectionString);
    const appDb = createRawDb(appConnectionString);
    const ownerDb = createRawDb(ownerConnectionString);
    let adminDb: DbClient | undefined;

    return {
      connectionString: workerConnectionString,
      db: testDb,
      appConnectionString,
      appDb,
      ownerConnectionString,
      ownerDb,
      adminConnectionString,
      get adminDb(): DbClient {
        adminDb ??= createRawDb(adminConnectionString);
        return adminDb;
      },
      bootstrapRoles: async () => {
        const admin = createRawDb(clusterAdmin);
        try {
          await bootstrapClusterRoles(admin, passwords);
        } finally {
          await admin.close();
        }
      },
      migrate: async () => {
        await runMigrations({
          connectionString: ownerConnectionString,
          sources: migrationSources(),
          logger: { log: () => undefined },
        });
      },
      truncate: (tables: string) => truncateWithDeadlockRetry(ownerDb, tables),
      destroy: async () => {
        await Promise.all([testDb.close(), appDb.close(), ownerDb.close(), adminDb?.close()]);
        const cleanupDb = createRawDb(clusterAdmin);
        await cleanupDb.raw(`
          SELECT pg_terminate_backend(pg_stat_activity.pid)
          FROM pg_stat_activity
          WHERE pg_stat_activity.datname = '${dbName}'
            AND pid <> pg_backend_pid();
        `);
        await cleanupDb.raw(`DROP DATABASE IF EXISTS ${dbName}`);
        await cleanupDb.close();
      },
    };
  } catch (error) {
    await mainDb.close();
    throw error;
  }
}
