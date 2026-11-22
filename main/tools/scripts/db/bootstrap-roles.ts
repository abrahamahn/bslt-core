// main/tools/scripts/db/bootstrap-roles.ts
/**
 * Database Role Bootstrap
 *
 * Creates or repairs the role split that makes RLS enforceable — `bslt_owner`
 * (migrator), `bslt_app` (user sessions), `bslt_worker` (system work) and the
 * `authenticated` / `bslt_system` / `bslt_definer` policy targets — and hands
 * the configured database to `bslt_owner`. Idempotent: safe to run on every
 * deploy, and it repairs drift (a role that gained BYPASSRLS or a forbidden
 * membership, default privileges an earlier version granted).
 *
 * Usage:
 *   pnpm db:bootstrap:roles
 *
 * Environment:
 *   DATABASE_ADMIN_URL      superuser connection (default: the POSTGRES_* parts)
 *   MIGRATION_DATABASE_URL  postgresql://bslt_owner:<password>@host/db
 *   DATABASE_URL            postgresql://bslt_app:<password>@host/db
 *   WORKER_DATABASE_URL     postgresql://bslt_worker:<password>@host/db
 *
 * Each role's password is taken from the URL it logs in with, and only its
 * SCRAM verifier is sent to the server.
 */

import { bootstrapDatabaseRoles, createRawDb, resolveRoleBootstrapEnv } from '@bslt/db';
import { initEnv } from '@bslt/server-system/config';

/**
 * Bootstrap the database roles for the configured database.
 *
 * @throws {Error} When the role URLs are missing or inconsistent (before
 *   connecting), or when the admin connection lacks superuser rights.
 */
export async function bootstrapRoles(): Promise<void> {
  await initEnv();
  const { adminConnectionString, passwords } = resolveRoleBootstrapEnv(process.env);
  const admin = createRawDb(adminConnectionString);
  try {
    await bootstrapDatabaseRoles(admin, passwords);
  } finally {
    await admin.close();
  }
}
