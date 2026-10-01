// main/apps/server/src/migrate.ts
import { access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildConnectionString, runSqlMigrations } from '@bslt/db';
import { initEnv } from '@bslt/server-system/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PathExists = (candidate: string) => Promise<boolean>;

export interface ResolveMigrationsDirOptions {
  readonly configured?: string | undefined;
  readonly cwd?: string | undefined;
  readonly pathExists?: PathExists | undefined;
  readonly scriptDir?: string | undefined;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function resolveMigrationsDir(
  options: ResolveMigrationsDirOptions = {},
): Promise<string> {
  const configured = options.configured ?? process.env['MIGRATIONS_DIR'];
  const cwd = options.cwd ?? process.cwd();
  const scriptDir = options.scriptDir ?? __dirname;
  const exists = options.pathExists ?? pathExists;
  const candidates = [
    configured === undefined || configured === '' ? undefined : path.resolve(configured),
    path.resolve(cwd, 'migrations'),
    path.resolve(cwd, 'main/server/db/migrations'),
    path.resolve(scriptDir, '../migrations'),
    path.resolve(scriptDir, '../../../server/db/migrations'),
    path.resolve(scriptDir, '../../../../server/db/migrations'),
  ].filter((candidate): candidate is string => candidate !== undefined);

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not find migrations directory. Checked: ${candidates.join(', ')}`);
}

export async function runContainerMigrations(): Promise<void> {
  await initEnv();

  const connectionString = buildConnectionString();
  const migrationsDir = await resolveMigrationsDir();

  await runSqlMigrations({
    connectionString,
    migrationsDir,
    logger: console,
  });
}

const entryArg = process.argv[1];
const isMain = entryArg !== undefined && import.meta.url === `file://${entryArg}`;

if (isMain) {
  runContainerMigrations().catch((err: unknown) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
