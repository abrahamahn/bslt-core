// main/tools/scripts/db/migrate.ts
/**
 * `pnpm bslt db migrate`: apply the pending migrations and required seeds.
 *
 * The one way a database gets its schema. It is the multi-source runner of
 * `@bslt/db` (main/server/db/src/migrate) on the sources that package ships:
 * the kernel baseline, then one baseline per owner, in dependency order. The
 * migrate entry of the production image runs the same function; this command
 * only loads the env files first.
 *
 * A database built from an earlier version of the baselines is refused with
 * `run: pnpm bslt db reset` (the baselines are edited in place until
 * foundation-v1).
 */

import { migrateDatabase } from '@bslt/db';
import { initEnv } from '@bslt/server-system/config';

/**
 * Migrate the database `MIGRATION_DATABASE_URL` names (outside production: the
 * single development connection).
 *
 * @throws {Error} When a file fails, or the database has to be reset first.
 */
export async function migrate(): Promise<void> {
  await initEnv();
  await migrateDatabase();
}
