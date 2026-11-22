// main/tools/catalog/build.ts
/**
 * Compute the catalog: apply the migration sources one at a time to a scratch
 * database as `bslt_owner`, read `pg_catalog` after each, and attribute every
 * object to the source that created it (restructure plan, section 9.1 item 3).
 *
 * The cluster is the one the real-DB suites use (`DATABASE_URL`, else the
 * `POSTGRES_*` parts, with `DATABASE_ADMIN_URL` under the role split).
 */
import { migrationSources, orderSources, runMigrations, type MigrationSource } from '@bslt/db';

import { attributeCatalog, type AttributionResult } from './attribute';
import { readDbCatalog } from './read';

import type { TestDatabase } from '@bslt/testing/database';

export interface BuildCatalogOptions {
  /**
   * A database nothing was applied to yet. Default: one is created and dropped.
   * The sources are applied to it; the caller keeps it.
   */
  readonly database?: TestDatabase;
  /** Default: the sources of this repository. */
  readonly sources?: readonly MigrationSource[];
}

/**
 * Apply `sources` to `database` one at a time, in the order the runner applies
 * them, and attribute what each one created.
 */
async function attributeOn(
  database: TestDatabase,
  sources: readonly MigrationSource[],
): Promise<AttributionResult> {
  const ordered = orderSources(sources);
  const initial = await readDbCatalog(database.adminDb);
  const steps = [];
  for (const [index, source] of ordered.entries()) {
    // The runner applies what is not applied yet: after this call the database
    // holds the sources up to this one, and only this one is new.
    await runMigrations({
      connectionString: database.ownerConnectionString,
      sources: ordered.slice(0, index + 1),
      logger: { log: () => undefined },
    });
    steps.push({ source: source.id, catalog: await readDbCatalog(database.adminDb) });
  }
  return attributeCatalog({
    initial,
    steps,
    sources: ordered.map((source) => ({ id: source.id, dependsOn: source.dependsOn })),
  });
}

/** Compute the attributed catalog of the migration sources. */
export async function buildCatalog(options: BuildCatalogOptions = {}): Promise<AttributionResult> {
  const sources = options.sources ?? migrationSources();
  if (options.database !== undefined) return attributeOn(options.database, sources);

  const { createTestDatabase } = await import('@bslt/testing/database');
  const database = await createTestDatabase();
  try {
    return await attributeOn(database, sources);
  } finally {
    await database.destroy();
  }
}
