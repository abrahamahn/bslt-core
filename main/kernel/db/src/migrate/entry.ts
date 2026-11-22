// main/kernel/db/src/migrate/entry.ts
/**
 * The migrate entry of the production image:
 *
 *   node node_modules/@bslt/db/dist/migrate/entry.js
 *
 * The image ships without the repository tooling, so the `migrate` one-shot of
 * the compose files runs this file. It is `pnpm bslt db migrate` without the
 * env-file loading: the same `migrateDatabase`, on the sources shipped inside
 * this package, through `MIGRATION_DATABASE_URL` (the owner role).
 *
 * Exit codes: 0 migrated or up to date; 1 failed; 3 the database was built
 * from other baselines and has to be rebuilt (`MigrationResetRequiredError`).
 * A deploy never rebuilds a production database on 3. The demo deploy does:
 * its database is disposable while the baselines are edited in place.
 *
 * This module runs when it is loaded and has no main-module guard: it is a
 * process entry only. Nothing imports it, and the package `exports` do not
 * offer it; the function it calls is `runMigrateEntry` of ./database.ts.
 */

import { runMigrateEntry } from './database';

void runMigrateEntry().then((code) => {
  process.exitCode = code;
});
