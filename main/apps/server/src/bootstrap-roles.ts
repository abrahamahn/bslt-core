// main/apps/server/src/bootstrap-roles.ts
/**
 * Container entry for the database role bootstrap.
 *
 * The deployed image has no repo tooling, so deploys run this by path, before
 * the migrations (the migrate entry of @bslt/db):
 *
 *   node dist/src/bootstrap-roles.js && node node_modules/@bslt/db/dist/migrate/entry.js
 *
 * It creates or repairs `bslt_owner` / `bslt_app` / `bslt_worker` and the
 * `authenticated` / `bslt_system` / `bslt_definer` policy targets, and hands
 * the database to `bslt_owner`. Idempotent. Reads `DATABASE_ADMIN_URL` (or the
 * `POSTGRES_*` superuser parts) plus `MIGRATION_DATABASE_URL`, `DATABASE_URL`
 * and `WORKER_DATABASE_URL`, whose passwords become the role passwords.
 */

import { bootstrapDatabaseRoles, createRawDb, resolveRoleBootstrapEnv } from '@bslt/db';
import { initEnv } from '@bslt/server-system/config';

import { isEntryModule } from './is-entry-module';

/**
 * Bootstrap the database roles for the configured database.
 *
 * @throws {Error} When the role URLs are missing or inconsistent (before
 *   connecting), or when the admin connection lacks superuser rights.
 */
export async function runContainerRoleBootstrap(): Promise<void> {
  await initEnv();
  const { adminConnectionString, passwords } = resolveRoleBootstrapEnv(process.env);
  const admin = createRawDb(adminConnectionString);
  try {
    await bootstrapDatabaseRoles(admin, passwords);
  } finally {
    await admin.close();
  }
}

if (isEntryModule(import.meta.url)) {
  runContainerRoleBootstrap().catch((error: unknown) => {
    // Message only: never print a connection string.
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`Role bootstrap failed: ${message}\n`);
    process.exit(1);
  });
}
