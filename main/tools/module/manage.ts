// main/tools/module/manage.ts
/**
 * `bslt module` CLI and programmatic installer/remover (`new`, `release`,
 * `list`, `add`, `remove`) implementing Owner Decision D14:
 * - Deterministic `.tar.gz` extraction with mandatory SHA-256 verification;
 * - Transitive `dependsOn` DAG resolution and topological ordering;
 * - Reverse-dependency safety checks on removal (`--cascade` opt-in);
 * - Local catalog directory/file OR HTTPS catalog URL + `BSLT_MODULE_TOKEN`
 *   (bearer header restricted strictly to the catalog origin, never persisted).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { orderSources, type MigrationSource } from '@bslt/db';

import { DB_CATALOG, loadCatalog, serializeCatalog } from '../catalog/file';
import { CORE_MODULE_IDS } from '../gates/optional-module-isolation';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';
import { CADDYFILE_REL_PATH, syncCsp } from '../sync/csp';
import { loadModulesWorkspace, syncModules } from '../sync/modules';
import { PERMISSION_LOCKFILE, syncPermissions, type PermissionLockfile } from '../sync/permissions';
import { syncRows } from '../sync/rows';
import { syncHeaders } from '../sync/sync-file-headers';
import { syncTsReferences } from '../sync/sync-ts-references';

import { extractTarGzToMemory } from './archive';
import { runModuleNewCli } from './new';
import {
  MODULES_CATALOG_FILENAME,
  parseModuleReleaseArgs,
  releaseOptionalModules,
  type ModuleCatalogEntry,
  type ModulesCatalogManifest,
} from './release';

import type { AttributedCatalog } from '../catalog/attribute';

const MAX_HTTP_REDIRECTS = 5;

export const MODULE_CLI_USAGE = [
  'Usage:',
  '  pnpm bslt module list [--catalog <dir|file|url>] [--json]',
  '  pnpm bslt module add <id...> [--catalog <dir|file|url>] [--dry-run] [--force] [--no-install]',
  '  pnpm bslt module remove <id...> [--cascade] [--dry-run] [--no-install]',
  '  pnpm bslt module release [--out <dir>]',
  '  pnpm bslt module new <id> [--dry-run] [--no-install]',
].join('\n');

export interface ListedModuleStatus {
  readonly id: string;
  readonly core: boolean;
  readonly devOnly: boolean;
  readonly installed: boolean;
  readonly version: string;
  readonly summary: string;
  readonly dependsOn: readonly string[];
}

export interface ListModulesResult {
  readonly coreVersion: string;
  readonly installed: readonly ListedModuleStatus[];
  readonly available: readonly ListedModuleStatus[];
}

export interface AddModulesOptions {
  readonly root?: string;
  readonly targets: readonly string[];
  readonly catalog?: string | undefined;
  readonly token?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly force?: boolean | undefined;
  readonly install?: boolean | undefined;
}

export interface AddModulesResult {
  readonly addedIds: readonly string[];
  readonly installedIds: readonly string[];
  readonly dryRun: boolean;
}

export interface RemoveModulesOptions {
  readonly root?: string;
  readonly ids: readonly string[];
  readonly cascade?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly install?: boolean | undefined;
}

export interface RemoveModulesResult {
  readonly removedIds: readonly string[];
  readonly installedIds: readonly string[];
  readonly dryRun: boolean;
}

interface ResolvedCatalogSource {
  readonly manifest: ModulesCatalogManifest;
  readonly readArchive: (entry: ModuleCatalogEntry) => Promise<Buffer>;
}

function isAllowedRemoteUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
  ) {
    return true;
  }
  return false;
}

function fetchBytesWithOriginScopedToken(
  initialUrl: URL,
  allowedOrigin: string,
  token: string | undefined,
  redirectsLeft = MAX_HTTP_REDIRECTS,
): Promise<Buffer> {
  if (!isAllowedRemoteUrl(initialUrl)) {
    return Promise.reject(
      new Error(`Refusing insecure catalog URL "${initialUrl.href}": HTTPS is required`),
    );
  }

  return new Promise<Buffer>((resolve, reject) => {
    const headers: Record<string, string> = {
      accept: 'application/json, application/gzip, application/octet-stream',
    };
    if (token !== undefined && token.trim() !== '' && initialUrl.origin === allowedOrigin) {
      headers['authorization'] = `Bearer ${token.trim()}`;
    }

    const client = initialUrl.protocol === 'https:' ? https : http;
    const req = client.request(initialUrl, { method: 'GET', headers }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && typeof res.headers.location === 'string') {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many HTTP redirects fetching "${initialUrl.href}"`));
          return;
        }
        const redirected = new URL(res.headers.location, initialUrl);
        fetchBytesWithOriginScopedToken(redirected, allowedOrigin, token, redirectsLeft - 1).then(
          resolve,
          reject,
        );
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${String(status)} fetching "${initialUrl.href}"`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

function readRootCoreVersion(root: string): string {
  const pkgPath = path.join(root, 'package.json');
  if (!existsSync(pkgPath)) return '1.0.0';
  const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return typeof parsed.version === 'string' ? parsed.version : '1.0.0';
}

async function loadCatalogSource(
  catalogSpec: string | undefined,
  token: string | undefined,
): Promise<ResolvedCatalogSource> {
  const resolvedSpec = catalogSpec ?? process.env['BSLT_MODULE_CATALOG'];
  if (resolvedSpec === undefined || resolvedSpec.trim() === '') {
    throw new Error(
      'No module catalog specified. Pass `--catalog <dir|modules.catalog.json|https://...>` or set BSLT_MODULE_CATALOG.',
    );
  }

  if (/^https?:\/\//iu.test(resolvedSpec)) {
    const catalogUrl = new URL(resolvedSpec);
    if (!isAllowedRemoteUrl(catalogUrl)) {
      throw new Error(`Refusing insecure catalog URL "${catalogUrl.href}": HTTPS is required`);
    }
    const effectiveToken = token ?? process.env['BSLT_MODULE_TOKEN'];
    const rawCatalog = await fetchBytesWithOriginScopedToken(
      catalogUrl,
      catalogUrl.origin,
      effectiveToken,
    );
    const manifest = JSON.parse(rawCatalog.toString('utf8')) as ModulesCatalogManifest;
    return {
      manifest,
      readArchive: async (entry) => {
        const archiveUrl = new URL(entry.archive, catalogUrl);
        return fetchBytesWithOriginScopedToken(archiveUrl, catalogUrl.origin, effectiveToken);
      },
    };
  }

  const absSpec = path.resolve(resolvedSpec);
  const catalogFilePath = absSpec.endsWith('.json')
    ? absSpec
    : path.join(absSpec, MODULES_CATALOG_FILENAME);
  if (!existsSync(catalogFilePath)) {
    throw new Error(`Module catalog not found at "${catalogFilePath}"`);
  }
  const baseDir = path.dirname(catalogFilePath);
  const manifest = JSON.parse(readFileSync(catalogFilePath, 'utf8')) as ModulesCatalogManifest;
  return {
    manifest,
    readArchive: async (entry) => {
      const archivePath = path.resolve(baseDir, entry.archive);
      if (!archivePath.startsWith(`${baseDir}${path.sep}`) && archivePath !== baseDir) {
        throw new Error(
          `Unsafe archive reference "${entry.archive}" in ${MODULES_CATALOG_FILENAME}`,
        );
      }
      if (!existsSync(archivePath)) {
        throw new Error(`Missing module archive "${archivePath}"`);
      }
      await Promise.resolve();
      return readFileSync(archivePath);
    },
  };
}

function topologicalSortInstalled(
  ids: readonly string[],
  depsOf: (id: string) => readonly string[],
): string[] {
  const targetSet = new Set(ids);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Module dependency cycle involving "${id}"`);
    }
    visiting.add(id);
    for (const dep of depsOf(id)) {
      if (targetSet.has(dep)) {
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };

  for (const id of ids) {
    visit(id);
  }
  return ordered;
}

export function rewriteBsltConfigInstalledModules(
  configContent: string,
  installedIds: readonly string[],
  devOnlyIds: readonly string[],
  manifestExportOf: (id: string) => string,
): string {
  const allReferenced = [...new Set([...installedIds, ...devOnlyIds])].sort(compareText);
  const moduleImportLines = allReferenced.map(
    (id) => `import { ${manifestExportOf(id)} } from '@bslt/${id}/module';`,
  );

  const lines = configContent.split('\n');
  const keptLines: string[] = [];
  let insertedImports = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^import\s+\{[^}]+\}\s+from\s+'@bslt\/[a-z][a-z0-9-]*\/module';$/u.test(trimmed)) {
      if (!insertedImports) {
        keptLines.push(...moduleImportLines);
        insertedImports = true;
      }
      continue;
    }
    if (!insertedImports && trimmed === "import { defineConfig } from '@bslt/contract';") {
      keptLines.push(...moduleImportLines, line);
      insertedImports = true;
      continue;
    }
    keptLines.push(line);
  }

  // Re-sort the top import block alphabetically by module specifier
  const joined = keptLines.join('\n');
  const importBlockMatch = /^(?:\/\/[^\n]*\n)?((?:import\s+[^\n]+;\n)+)/u.exec(joined);
  let withSortedImports = joined;
  if (importBlockMatch?.[1] !== undefined) {
    const sorted = importBlockMatch[1]
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
      .sort((a, b) => {
        const specA = /from\s+'([^']+)'/u.exec(a)?.[1] ?? a;
        const specB = /from\s+'([^']+)'/u.exec(b)?.[1] ?? b;
        return compareText(specA, specB);
      });
    withSortedImports = joined.replace(importBlockMatch[1], `${sorted.join('\n')}\n`);
  }

  const installedItems = installedIds.map((id) => manifestExportOf(id));
  const formattedArray =
    installedItems.length <= 3
      ? `[${installedItems.join(', ')}] as const`
      : `[\n    ${installedItems.join(',\n    ')},\n  ] as const`;

  const installedRegex = /installedModules:\s*\[[\s\S]*?\]\s*(?:as\s+const)?/u;
  if (!installedRegex.test(withSortedImports)) {
    throw new Error('bslt.config.ts is missing an installedModules array literal');
  }
  return withSortedImports.replace(installedRegex, `installedModules: ${formattedArray}`);
}

function updateCatalogForInstalledModules(
  root: string,
  addedEntries: readonly ModuleCatalogEntry[],
  removedIds: ReadonlySet<string>,
  depsOf: (id: string) => readonly string[],
): void {
  const catalogPath = path.join(root, DB_CATALOG.file);
  if (!existsSync(catalogPath)) return;

  const current = loadCatalog(root);
  const replacedIds = new Set<string>([...removedIds, ...addedEntries.map((e) => e.id)]);

  const sourcesMap = new Map<string, { id: string; dependsOn: readonly string[] }>();
  for (const s of current.sources) {
    if (!replacedIds.has(s.id)) {
      sourcesMap.set(s.id, s);
    }
  }
  for (const entry of addedEntries) {
    if (entry.catalogFragment.source !== null) {
      sourcesMap.set(entry.id, entry.catalogFragment.source);
    } else if (Object.keys(entry.migrationChecksums).length > 0 || entry.tables.length > 0) {
      sourcesMap.set(entry.id, { id: entry.id, dependsOn: [...depsOf(entry.id)] });
    }
  }

  const migrationSources: MigrationSource[] = [...sourcesMap.values()].map((s) => ({
    id: s.id,
    dir: s.id === 'kernel' ? 'main/kernel/db/sql' : `main/modules/${s.id}/server/migrations`,
    dependsOn: s.dependsOn,
  }));
  const orderedSources = orderSources(migrationSources).map((s) => ({
    id: s.id,
    dependsOn: [...s.dependsOn],
  }));

  const nextCatalog: AttributedCatalog = {
    ...current,
    sources: orderedSources,
    types: [
      ...current.types.filter((x) => !replacedIds.has(x.source)),
      ...addedEntries.flatMap((e) => e.catalogFragment.types),
    ].sort((a, b) => compareText(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
    sequences: [
      ...current.sequences.filter((x) => !replacedIds.has(x.source)),
      ...addedEntries.flatMap((e) => e.catalogFragment.sequences),
    ].sort((a, b) => compareText(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
    functions: [
      ...current.functions.filter((x) => !replacedIds.has(x.source)),
      ...addedEntries.flatMap((e) => e.catalogFragment.functions),
    ].sort((a, b) => compareText(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
    tables: [
      ...current.tables.filter((x) => !replacedIds.has(x.source)),
      ...addedEntries.flatMap((e) => e.catalogFragment.tables),
    ].sort((a, b) => compareText(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
    views: [
      ...current.views.filter((x) => !replacedIds.has(x.source)),
      ...addedEntries.flatMap((e) => e.catalogFragment.views),
    ].sort((a, b) => compareText(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
  };

  writeFileSync(catalogPath, serializeCatalog(nextCatalog));
}

function pruneLockfileMigrationsOnRemove(root: string, removedIds: ReadonlySet<string>): void {
  const lockPath = path.join(root, PERMISSION_LOCKFILE);
  if (!existsSync(lockPath) || removedIds.size === 0) return;
  const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as PermissionLockfile;
  if (raw.migrations === undefined) return;
  const nextMigrations: Record<string, string> = {};
  for (const [key, sum] of Object.entries(raw.migrations)) {
    const owner = key.split('/')[0] ?? '';
    if (!removedIds.has(owner)) {
      nextMigrations[key] = sum;
    }
  }
  const updated: PermissionLockfile = {
    orgPermissionBits: raw.orgPermissionBits,
    tombstoned: raw.tombstoned,
    migrations: nextMigrations,
  };
  writeFileSync(lockPath, `${JSON.stringify(updated, null, 2)}\n`);
}

async function syncWorkspaceAfterModuleMutation(root: string, runInstall: boolean): Promise<void> {
  await syncPermissions({ root });
  if (existsSync(path.join(root, DB_CATALOG.file))) {
    await syncRows({ root });
  }
  await syncModules({ root });
  if (existsSync(path.join(root, 'tsconfig.json'))) {
    syncTsReferences({ root });
  }
  if (existsSync(path.join(root, CADDYFILE_REL_PATH))) {
    await syncCsp({ root });
  }
  syncHeaders({ root, quiet: true });
  if (runInstall) {
    const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' };
    execFileSync('pnpm', ['install', '--no-frozen-lockfile'], { cwd: root, stdio: 'inherit', env });
    if (existsSync(path.join(root, 'main/tools/snapshots'))) {
      execFileSync('pnpm', ['bslt', 'snapshot', 'api'], { cwd: root, stdio: 'inherit', env });
      execFileSync('pnpm', ['bslt', 'snapshot', 'web-routes'], {
        cwd: root,
        stdio: 'inherit',
        env,
      });
    }
    if (existsSync(path.join(root, 'docs/reference'))) {
      execFileSync('pnpm', ['bslt', 'sync', 'openapi'], { cwd: root, stdio: 'inherit', env });
      execFileSync('pnpm', ['bslt', 'sync', 'docs'], { cwd: root, stdio: 'inherit', env });
    }
    execFileSync('pnpm', ['format'], { cwd: root, stdio: 'inherit', env });
  }
}

function checkNoExistingModuleDirWithoutForce(modDir: string, force: boolean): void {
  if (!existsSync(modDir) || force) return;
  throw new Error(
    `Module directory "${modDir}" already exists on disk; pass --force to overwrite.`,
  );
}

export async function listModules(options: {
  readonly root?: string;
  readonly catalog?: string | undefined;
  readonly token?: string | undefined;
}): Promise<ListModulesResult> {
  const root = options.root ?? REPO_ROOT;
  const coreVersion = readRootCoreVersion(root);
  const workspace = loadModulesWorkspace(root);
  const installedSet = new Set([...workspace.installedIds, ...workspace.devOnlyIds]);
  const devOnlySet = new Set(workspace.devOnlyIds);

  const installed: ListedModuleStatus[] = [...installedSet]
    .map((id) => {
      const mod = workspace.modules.get(id);
      const pkgPath = path.join(root, 'main/modules', id, 'package.json');
      const pkgVer = existsSync(pkgPath)
        ? ((JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }).version ??
          coreVersion)
        : coreVersion;
      return {
        id,
        core: CORE_MODULE_IDS.has(id),
        devOnly: devOnlySet.has(id),
        installed: true,
        version: pkgVer,
        summary: mod?.summary ?? '',
        dependsOn: mod?.dependsOn ?? [],
      };
    })
    .sort((a, b) => compareText(a.id, b.id));

  const available: ListedModuleStatus[] = [];
  const catalogSpec = options.catalog ?? process.env['BSLT_MODULE_CATALOG'];
  if (catalogSpec !== undefined && catalogSpec.trim() !== '') {
    const source = await loadCatalogSource(catalogSpec, options.token);
    for (const entry of source.manifest.modules) {
      if (!installedSet.has(entry.id)) {
        available.push({
          id: entry.id,
          core: false,
          devOnly: false,
          installed: false,
          version: entry.version,
          summary: entry.summary,
          dependsOn: entry.dependsOn,
        });
      }
    }
  } else {
    // Also surface any uninstalled modules already present under main/modules/*
    for (const mod of workspace.modules.values()) {
      if (!installedSet.has(mod.id)) {
        available.push({
          id: mod.id,
          core: CORE_MODULE_IDS.has(mod.id),
          devOnly: false,
          installed: false,
          version: coreVersion,
          summary: mod.summary,
          dependsOn: mod.dependsOn,
        });
      }
    }
  }

  available.sort((a, b) => compareText(a.id, b.id));
  return { coreVersion, installed, available };
}

export async function addModules(options: AddModulesOptions): Promise<AddModulesResult> {
  const root = options.root ?? REPO_ROOT;
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const runInstall = options.install !== false;

  if (options.targets.length === 0) {
    throw new Error('bslt module add requires at least one module id');
  }

  const coreVersion = readRootCoreVersion(root);
  const workspace = loadModulesWorkspace(root);
  const currentlyInstalled = new Set(workspace.installedIds);
  const devOnlySet = new Set(workspace.devOnlyIds);

  // Check if all requested modules already exist locally on disk (e.g. inside bslt-main) or require catalog
  const catalogSpec = options.catalog ?? process.env['BSLT_MODULE_CATALOG'];
  const catalogSource =
    catalogSpec !== undefined && catalogSpec.trim() !== ''
      ? await loadCatalogSource(catalogSpec, options.token)
      : null;

  if (catalogSource !== null && catalogSource.manifest.coreVersion !== coreVersion) {
    throw new Error(
      `Catalog coreVersion "${catalogSource.manifest.coreVersion}" is not compatible with workspace Core version "${coreVersion}".`,
    );
  }

  const catalogById = new Map<string, ModuleCatalogEntry>(
    (catalogSource?.manifest.modules ?? []).map((m) => [m.id, m]),
  );

  const resolveDeps = (id: string): readonly string[] => {
    const localMod = workspace.modules.get(id);
    if (localMod !== undefined && currentlyInstalled.has(id)) {
      return localMod.dependsOn;
    }
    const catMod = catalogById.get(id);
    if (catMod !== undefined) {
      return catMod.dependsOn;
    }
    if (localMod !== undefined) {
      return localMod.dependsOn;
    }
    throw new Error(
      `Unknown module "${id}": not installed locally and not found in module catalog.`,
    );
  };

  // Compute transitive closure
  const needed = new Set<string>(workspace.installedIds);
  const queue = [...options.targets];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) continue;
    if (devOnlySet.has(next)) {
      throw new Error(`Module "${next}" is already registered in devOnly.`);
    }
    needed.add(next);
    for (const dep of resolveDeps(next)) {
      if (!needed.has(dep)) {
        queue.push(dep);
      }
    }
  }

  const nextInstalledIds = topologicalSortInstalled([...needed], resolveDeps);
  const addedIds = nextInstalledIds.filter((id) => !currentlyInstalled.has(id));

  if (dryRun || addedIds.length === 0) {
    return { addedIds, installedIds: nextInstalledIds, dryRun };
  }

  // Stage and verify all archives in memory BEFORE touching disk
  const stagedExtractions = new Map<
    string,
    { entry: ModuleCatalogEntry; files: Map<string, Buffer> }
  >();
  for (const id of addedIds) {
    const catEntry = catalogById.get(id);
    if (catEntry !== undefined && catalogSource !== null) {
      checkNoExistingModuleDirWithoutForce(path.join(root, 'main/modules', id), force);
      const archiveBytes = await catalogSource.readArchive(catEntry);
      const extracted = extractTarGzToMemory(archiveBytes, {
        expectedSha256: catEntry.sha256,
      });
      stagedExtractions.set(id, { entry: catEntry, files: extracted });
    } else if (!existsSync(path.join(root, 'main/modules', id, 'module.ts'))) {
      throw new Error(
        `Module "${id}" is not present under main/modules/${id} and no --catalog was supplied.`,
      );
    }
  }

  // Write verified archives to main/modules/<id>
  const addedCatalogEntries: ModuleCatalogEntry[] = [];
  for (const [id, { entry, files }] of stagedExtractions) {
    const modDir = path.join(root, 'main/modules', id);
    rmSync(modDir, { recursive: true, force: true });
    mkdirSync(modDir, { recursive: true });
    for (const [relFile, buf] of files) {
      const dest = path.join(modDir, relFile);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
    }
    addedCatalogEntries.push(entry);
  }

  // Reload workspace modules from disk to discover exact manifest export names
  const refreshedModulesDir = path.join(root, 'main/modules');
  const exportNameById = new Map<string, string>();
  for (const [id, mod] of workspace.modules) {
    exportNameById.set(id, mod.manifestExport);
  }
  for (const id of addedIds) {
    const manifestText = readFileSync(path.join(refreshedModulesDir, id, 'module.ts'), 'utf8');
    const match = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*defineModule\(/u.exec(manifestText);
    exportNameById.set(id, match?.[1] ?? `${id}Module`);
  }

  const configPath = path.join(root, 'bslt.config.ts');
  const nextConfig = rewriteBsltConfigInstalledModules(
    readFileSync(configPath, 'utf8'),
    nextInstalledIds,
    workspace.devOnlyIds,
    (id) => exportNameById.get(id) ?? `${id}Module`,
  );
  writeFileSync(configPath, nextConfig);

  if (addedCatalogEntries.length > 0) {
    updateCatalogForInstalledModules(root, addedCatalogEntries, new Set(), resolveDeps);
  }

  await syncWorkspaceAfterModuleMutation(root, runInstall);
  return { addedIds, installedIds: nextInstalledIds, dryRun: false };
}

export async function removeModules(options: RemoveModulesOptions): Promise<RemoveModulesResult> {
  const root = options.root ?? REPO_ROOT;
  const dryRun = options.dryRun === true;
  const cascade = options.cascade === true;
  const runInstall = options.install !== false;

  if (options.ids.length === 0) {
    throw new Error('bslt module remove requires at least one module id');
  }

  for (const id of options.ids) {
    if (CORE_MODULE_IDS.has(id)) {
      throw new Error(
        `Cannot remove "${id}": it is a required Minimal Core module (${[...CORE_MODULE_IDS].join(', ')}).`,
      );
    }
  }

  const workspace = loadModulesWorkspace(root);
  const installedSet = new Set(workspace.installedIds);
  for (const id of options.ids) {
    if (!installedSet.has(id)) {
      throw new Error(`Module "${id}" is not currently installed in bslt.config.ts.`);
    }
  }

  const toRemove = new Set<string>(options.ids);
  if (cascade) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const installedId of workspace.installedIds) {
        if (toRemove.has(installedId)) continue;
        const mod = workspace.modules.get(installedId);
        if (mod?.dependsOn.some((dep) => toRemove.has(dep)) === true) {
          if (CORE_MODULE_IDS.has(installedId)) {
            throw new Error(`Cannot cascade-remove Core module "${installedId}".`);
          }
          toRemove.add(installedId);
          changed = true;
        }
      }
    }
  } else {
    const blocking: string[] = [];
    for (const installedId of workspace.installedIds) {
      if (toRemove.has(installedId)) continue;
      const mod = workspace.modules.get(installedId);
      for (const dep of mod?.dependsOn ?? []) {
        if (toRemove.has(dep)) {
          blocking.push(`"${installedId}" depends on "${dep}"`);
        }
      }
    }
    if (blocking.length > 0) {
      throw new Error(
        `Cannot remove module(s) while dependent modules remain installed (${blocking.join('; ')}). Remove them together or pass --cascade.`,
      );
    }
  }

  // Order removedIds reverse-topologically (dependents before dependencies)
  const removedIds = [...workspace.installedIds].reverse().filter((id) => toRemove.has(id));
  const nextInstalledIds = workspace.installedIds.filter((id) => !toRemove.has(id));

  if (dryRun) {
    return { removedIds, installedIds: nextInstalledIds, dryRun: true };
  }

  const configPath = path.join(root, 'bslt.config.ts');
  const nextConfig = rewriteBsltConfigInstalledModules(
    readFileSync(configPath, 'utf8'),
    nextInstalledIds,
    workspace.devOnlyIds,
    (id) => workspace.modules.get(id)?.manifestExport ?? `${id}Module`,
  );
  writeFileSync(configPath, nextConfig);

  for (const id of removedIds) {
    const modDir = path.join(root, 'main/modules', id);
    if (existsSync(modDir)) {
      rmSync(modDir, { recursive: true, force: true });
    }
    const entriesDir = path.join(root, 'tests/integration/database/generated');
    if (existsSync(entriesDir)) {
      for (const file of readdirSync(entriesDir)) {
        if (file === `${id}.real-db.test.ts`) {
          rmSync(path.join(entriesDir, file), { force: true });
        }
      }
    }
  }

  pruneLockfileMigrationsOnRemove(root, toRemove);
  updateCatalogForInstalledModules(
    root,
    [],
    toRemove,
    (id) => workspace.modules.get(id)?.dependsOn ?? [],
  );

  await syncWorkspaceAfterModuleMutation(root, runInstall);
  return { removedIds, installedIds: nextInstalledIds, dryRun: false };
}

function parseFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const arg = argv[index] ?? '';
  if (arg === flag) {
    const val = argv[index + 1];
    if (val === undefined || val.startsWith('-')) {
      throw new Error(`${flag} requires a value`);
    }
    return { value: val, nextIndex: index + 1 };
  }
  return { value: arg.slice(`${flag}=`.length), nextIndex: index };
}

export async function runModuleCli(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(MODULE_CLI_USAGE);
    return sub === undefined ? 1 : 0;
  }

  if (sub === 'new') {
    return runModuleNewCli(argv);
  }

  if (sub === 'release') {
    const { outDir } = parseModuleReleaseArgs(rest);
    const res = await releaseOptionalModules({ outDir });
    console.log(
      `Packaged ${String(res.catalog.modules.length)} optional module(s) into ${res.outDir} (${MODULES_CATALOG_FILENAME}).`,
    );
    return 0;
  }

  if (sub === 'list') {
    let catalog: string | undefined;
    let json = false;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i] ?? '';
      if (arg === '--json') {
        json = true;
      } else if (arg === '--catalog' || arg.startsWith('--catalog=')) {
        const parsed = parseFlagValue(rest, i, '--catalog');
        catalog = parsed.value;
        i = parsed.nextIndex;
      } else {
        throw new Error(`bslt module list: unknown option "${arg}"`);
      }
    }
    const result = await listModules({ catalog });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`BSLT Modules (Core v${result.coreVersion})\n`);
    console.log('Installed:');
    for (const mod of result.installed) {
      const tag = mod.core ? '[core]' : mod.devOnly ? '[devOnly]' : '[optional]';
      console.log(`  - ${mod.id.padEnd(16)} ${tag.padEnd(11)} ${mod.summary}`);
    }
    if (result.available.length > 0) {
      console.log('\nAvailable to install (`pnpm bslt module add <id>`):');
      for (const mod of result.available) {
        const deps = mod.dependsOn.length > 0 ? ` (depends on: ${mod.dependsOn.join(', ')})` : '';
        console.log(`  - ${mod.id.padEnd(16)} v${mod.version}  ${mod.summary}${deps}`);
      }
    }
    return 0;
  }

  if (sub === 'add') {
    let catalog: string | undefined;
    let dryRun = false;
    let force = false;
    let install = true;
    const targets: string[] = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i] ?? '';
      if (arg === '--dry-run') dryRun = true;
      else if (arg === '--force') force = true;
      else if (arg === '--no-install') install = false;
      else if (arg === '--catalog' || arg.startsWith('--catalog=')) {
        const parsed = parseFlagValue(rest, i, '--catalog');
        catalog = parsed.value;
        i = parsed.nextIndex;
      } else if (arg.startsWith('-')) {
        throw new Error(`bslt module add: unknown option "${arg}"`);
      } else {
        targets.push(arg);
      }
    }
    const res = await addModules({ targets, catalog, dryRun, force, install });
    if (res.addedIds.length === 0) {
      console.log('All requested modules are already installed.');
    } else if (res.dryRun) {
      console.log(`Would install (${String(res.addedIds.length)}): ${res.addedIds.join(' -> ')}`);
    } else {
      console.log(`Installed (${String(res.addedIds.length)}): ${res.addedIds.join(', ')}`);
    }
    return 0;
  }

  if (sub === 'remove') {
    let cascade = false;
    let dryRun = false;
    let install = true;
    const ids: string[] = [];
    for (const arg of rest) {
      if (arg === '--cascade') cascade = true;
      else if (arg === '--dry-run') dryRun = true;
      else if (arg === '--no-install') install = false;
      else if (arg.startsWith('-')) {
        throw new Error(`bslt module remove: unknown option "${arg}"`);
      } else {
        ids.push(arg);
      }
    }
    const res = await removeModules({ ids, cascade, dryRun, install });
    if (res.dryRun) {
      console.log(`Would remove (${String(res.removedIds.length)}): ${res.removedIds.join(', ')}`);
    } else {
      console.log(`Removed (${String(res.removedIds.length)}): ${res.removedIds.join(', ')}`);
    }
    return 0;
  }

  throw new Error(`bslt module: unknown subcommand "${sub}"\n\n${MODULE_CLI_USAGE}`);
}
