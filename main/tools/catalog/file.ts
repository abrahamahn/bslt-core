// main/tools/catalog/file.ts
/**
 * The committed database catalog (restructure plan, section 9.1 item 4).
 *
 * ONE file, written by ONE command: `pnpm bslt db catalog` computes it on a
 * scratch database and writes `main/kernel/db/catalog.snapshot.json`. Every
 * other generator and gate reads the committed file (`bslt sync rows`,
 * `bslt db audit`), so the merge lane needs no database. The real-DB lane
 * recomputes it (`pnpm bslt db catalog --check`) and fails on any difference.
 *
 * It follows the rules of every committed snapshot (../snapshot/snapshot-file.ts):
 * sorted, deterministic, a `generated` header that names the command, never
 * edited by hand.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths';
import { serializeSnapshot, type SnapshotSpec } from '../snapshot/snapshot-file';

import type { AttributedCatalog } from './attribute';

/** The command that computes and writes the catalog. */
export const DB_CATALOG_COMMAND = 'pnpm bslt db catalog';

export const DB_CATALOG: SnapshotSpec = {
  id: 'db-catalog',
  file: 'main/kernel/db/catalog.snapshot.json',
  title: 'The database catalog',
  sources:
    'pg_catalog of a scratch database, read after each migration source of @bslt/db (main/kernel/db/sql and main/kernel/db/legacy-migrations) was applied as bslt_owner, after the cluster role bootstrap',
  command: DB_CATALOG_COMMAND,
};

/** The content of the catalog file. */
export function serializeCatalog(catalog: AttributedCatalog): string {
  return serializeSnapshot(DB_CATALOG, { ...catalog });
}

/**
 * Read the committed catalog.
 *
 * @throws {Error} When the file does not exist: the message names the command.
 */
export function loadCatalog(root: string = REPO_ROOT): AttributedCatalog {
  const file = path.join(root, DB_CATALOG.file);
  if (!existsSync(file)) {
    throw new Error(
      `${DB_CATALOG.file} does not exist. Run \`${DB_CATALOG_COMMAND}\` and commit it.`,
    );
  }
  const { generated: _generated, ...catalog } = JSON.parse(readFileSync(file, 'utf8')) as {
    generated: string;
  } & AttributedCatalog;
  return catalog;
}
