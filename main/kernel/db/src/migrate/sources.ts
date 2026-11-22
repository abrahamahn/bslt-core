// main/kernel/db/src/migrate/sources.ts
/**
 * The migration sources of this repository (restructure plan, sections 9.1
 * and 9.3): the kernel baseline and each installed module's `server/migrations/`.
 *
 * The SQL ships inside each owning package (`files` of package.json), so the
 * image's migrate entry finds it next to `dist/`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KERNEL_SOURCE_ID, type MigrationSource } from './runner';

/** `main/kernel/db`, from `src/migrate/` and from `dist/migrate/` alike. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Directory of the kernel baseline, relative to the package root. */
export const KERNEL_SQL_DIR = 'sql';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function candidateModuleContainers(packageRoot: string): string[] {
  const candidates = [
    // Monorepo: main/kernel/db -> main/modules
    path.resolve(packageRoot, '../../modules'),
    // Hoisted node_modules/@bslt/db -> node_modules/@bslt
    path.resolve(packageRoot, '..'),
    // pnpm virtual store: node_modules/.pnpm/<pkg>/node_modules/@bslt/db -> node_modules/@bslt
    path.resolve(packageRoot, '../../../../../@bslt'),
  ];
  if (path.resolve(packageRoot) === PACKAGE_ROOT) {
    // Deployed CWD fallback: /app/node_modules/@bslt
    candidates.push(path.resolve(process.cwd(), 'node_modules/@bslt'));
  }
  return candidates;
}

function readModuleDependsOn(
  moduleRoot: string,
  knownSourceIds: ReadonlySet<string>,
  selfId: string,
): string[] {
  for (const rel of ['module.ts', 'dist/module.js']) {
    const file = path.join(moduleRoot, rel);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const deps: string[] = [];
    for (const match of text.matchAll(/from\s+['"]@bslt\/([a-z][a-z0-9]*)\/module['"]/gu)) {
      const dep = match[1];
      if (dep !== undefined && dep !== selfId && knownSourceIds.has(dep) && !deps.includes(dep)) {
        deps.push(dep);
      }
    }
    return deps;
  }
  const pkgFile = path.join(moduleRoot, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {})
      .flatMap((name) => {
        const m = /^@bslt\/([a-z][a-z0-9]*)$/u.exec(name);
        return m?.[1] !== undefined && m[1] !== selfId && knownSourceIds.has(m[1]) ? [m[1]] : [];
      })
      .sort(compareText);
  }
  return selfId !== 'identity' && knownSourceIds.has('identity') ? ['identity'] : [];
}

function discoverModuleSources(packageRoot: string): MigrationSource[] {
  const discovered = new Map<string, { readonly moduleRoot: string; readonly dir: string }>();
  for (const container of candidateModuleContainers(packageRoot)) {
    if (!existsSync(container)) continue;
    const entries = readdirSync(container, { withFileTypes: true }).sort((a, b) =>
      compareText(a.name, b.name),
    );
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const id = entry.name;
      if (
        !/^[a-z][a-z0-9]*$/u.test(id) ||
        id === KERNEL_SOURCE_ID ||
        id === 'db' ||
        discovered.has(id)
      ) {
        continue;
      }
      const moduleRoot = path.join(container, id);
      const migrationsDir = path.join(moduleRoot, 'server/migrations');
      if (existsSync(migrationsDir)) {
        discovered.set(id, { moduleRoot, dir: migrationsDir });
      }
    }
  }

  const knownSourceIds = new Set<string>(discovered.keys());
  return [...discovered.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([id, info]) => ({
      id,
      dir: info.dir,
      dependsOn: readModuleDependsOn(info.moduleRoot, knownSourceIds, id),
    }));
}

function sortTopologically(sources: readonly MigrationSource[]): MigrationSource[] {
  const byId = new Map<string, MigrationSource>(sources.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const ordered: MigrationSource[] = [];

  const visit = (source: MigrationSource): void => {
    if (visited.has(source.id)) return;
    visited.add(source.id);
    for (const depId of source.dependsOn) {
      const dep = byId.get(depId);
      if (dep !== undefined) {
        visit(dep);
      }
    }
    ordered.push(source);
  };

  for (const source of sources) {
    visit(source);
  }
  return ordered;
}

/**
 * Every migration source, with absolute directories, topologically ordered by `dependsOn`.
 *
 * @param packageRoot - Where `sql/` is located. Default: this package.
 */
export function migrationSources(packageRoot: string = PACKAGE_ROOT): MigrationSource[] {
  const nonKernel = sortTopologically(discoverModuleSources(packageRoot));
  return [
    {
      id: KERNEL_SOURCE_ID,
      dir: path.join(packageRoot, KERNEL_SQL_DIR),
      dependsOn: [],
    },
    ...nonKernel,
  ];
}

/**
 * Loads locked migration SHA-256 checksums from `bslt.lock.json` when present
 * (in either the monorepo root or `/app/bslt.lock.json` inside the container image).
 */
export function loadLockedMigrationChecksums(
  packageRoot: string = PACKAGE_ROOT,
): Readonly<Record<string, string>> | undefined {
  const candidates = [
    path.resolve(packageRoot, '../../../bslt.lock.json'),
    path.resolve(process.cwd(), 'bslt.lock.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
        migrations?: Record<string, string>;
      };
      if (parsed.migrations !== undefined && typeof parsed.migrations === 'object') {
        return parsed.migrations;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}
