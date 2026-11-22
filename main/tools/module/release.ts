// main/tools/module/release.ts
/**
 * `bslt module release [--out <dir>]`: packages every optional vertical module
 * (`main/modules/<id>` outside `CORE_MODULE_IDS`) into deterministic
 * `<id>-<version>.tar.gz` archives and writes `modules.catalog.json` with
 * SHA-256 checksums, `dependsOn` DAG metadata, migration checksums, and
 * attributed DB catalog fragments (Owner Decision D14).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { DB_CATALOG, loadCatalog } from '../catalog/file';
import { CORE_MODULE_IDS } from '../gates/optional-module-isolation';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';
import { loadModulesWorkspace } from '../sync/modules';
import { PERMISSION_LOCKFILE } from '../sync/permissions';

import { createDeterministicTarGz, sha256Hex, type ArchiveFileEntry } from './archive';

import type { Attributed, CatalogSource } from '../catalog/attribute';
import type {
  CatalogFunction,
  CatalogSequence,
  CatalogTable,
  CatalogType,
  CatalogView,
} from '../catalog/read';

export const MODULES_CATALOG_FILENAME = 'modules.catalog.json';

const EXCLUDED_DIR_NAMES = new Set([
  'dist',
  'node_modules',
  '.turbo',
  '.cache',
  'coverage',
  '.git',
]);

export interface ModuleCatalogDbFragment {
  readonly source: CatalogSource | null;
  readonly types: ReadonlyArray<Attributed<CatalogType>>;
  readonly sequences: ReadonlyArray<Attributed<CatalogSequence>>;
  readonly functions: ReadonlyArray<Attributed<CatalogFunction>>;
  readonly tables: ReadonlyArray<Attributed<CatalogTable>>;
  readonly views: ReadonlyArray<Attributed<CatalogView>>;
}

export interface ModuleCatalogEntry {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
  readonly summary: string;
  readonly status: string;
  readonly dependsOn: readonly string[];
  readonly web: boolean;
  readonly tables: readonly string[];
  readonly endpointsCount: number;
  readonly permissions: readonly string[];
  readonly archive: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly migrationChecksums: Readonly<Record<string, string>>;
  readonly catalogFragment: ModuleCatalogDbFragment;
}

export interface ModulesCatalogManifest {
  readonly schemaVersion: 1;
  readonly coreVersion: string;
  readonly modules: readonly ModuleCatalogEntry[];
}

export interface ReleaseModulesOptions {
  readonly root?: string;
  readonly outDir: string;
}

export interface ReleaseModulesResult {
  readonly outDir: string;
  readonly catalogPath: string;
  readonly catalog: ModulesCatalogManifest;
}

export function parseModuleReleaseArgs(argv: readonly string[]): { readonly outDir: string } {
  let outDir = path.join(REPO_ROOT, '.tmp/module-releases');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--out') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error('bslt module release: --out requires a target directory path');
      }
      outDir = path.resolve(next);
      i += 1;
    } else if (arg.startsWith('--out=')) {
      const val = arg.slice('--out='.length).trim();
      if (val === '') {
        throw new Error('bslt module release: --out requires a target directory path');
      }
      outDir = path.resolve(val);
    } else {
      throw new Error(`bslt module release: unknown option "${arg}"`);
    }
  }
  return { outDir };
}

function collectModuleFiles(absModuleDir: string): ArchiveFileEntry[] {
  const entries: ArchiveFileEntry[] = [];
  const walk = (currentAbs: string, relPrefix: string): void => {
    const children = readdirSync(currentAbs, { withFileTypes: true }).sort((a, b) =>
      compareText(a.name, b.name),
    );
    for (const child of children) {
      const rel = relPrefix === '' ? child.name : `${relPrefix}/${child.name}`;
      const childAbs = path.join(currentAbs, child.name);
      if (child.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(child.name)) {
          walk(childAbs, rel);
        }
      } else if (child.isFile()) {
        if (child.name.endsWith('.tsbuildinfo') || child.name.startsWith('.eslintcache')) {
          continue;
        }
        entries.push({
          path: rel,
          content: readFileSync(childAbs),
        });
      }
    }
  };
  walk(absModuleDir, '');
  return entries;
}

function readDeclaredModulePermissions(manifestPath: string): string[] {
  const sf = ts.createSourceFile(
    manifestPath,
    readFileSync(manifestPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'permissions' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const el of node.initializer.elements) {
        if (ts.isStringLiteral(el)) {
          out.push(el.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function readPackageVersion(pkgPath: string, fallback: string): { name: string; version: string } {
  if (!existsSync(pkgPath)) {
    return { name: '', version: fallback };
  }
  const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name?: string;
    version?: string;
  };
  return {
    name: typeof parsed.name === 'string' ? parsed.name : '',
    version: typeof parsed.version === 'string' ? parsed.version : fallback,
  };
}

export async function releaseOptionalModules(
  options: ReleaseModulesOptions,
): Promise<ReleaseModulesResult> {
  const root = options.root ?? REPO_ROOT;
  const rootPkgPath = path.join(root, 'package.json');
  if (!existsSync(rootPkgPath)) {
    throw new Error(`Missing root package.json under ${root}`);
  }
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version?: string };
  const coreVersion = typeof rootPkg.version === 'string' ? rootPkg.version : '1.0.0';

  const workspace = loadModulesWorkspace(root);
  const hasDbCatalog = existsSync(path.join(root, DB_CATALOG.file));
  const dbCatalog = hasDbCatalog ? loadCatalog(root) : null;

  const lockPath = path.join(root, PERMISSION_LOCKFILE);
  const lockMigrations: Readonly<Record<string, string>> = existsSync(lockPath)
    ? ((
        JSON.parse(readFileSync(lockPath, 'utf8')) as {
          migrations?: Readonly<Record<string, string>>;
        }
      ).migrations ?? {})
    : {};

  mkdirSync(options.outDir, { recursive: true });

  const optionalIds = [...workspace.modules.keys()]
    .filter((id) => !CORE_MODULE_IDS.has(id))
    .sort(compareText);

  const catalogEntries: ModuleCatalogEntry[] = [];

  for (const id of optionalIds) {
    const modInfo = workspace.modules.get(id);
    if (modInfo === undefined) continue;
    const modDir = path.join(root, 'main/modules', id);
    const pkgMeta = readPackageVersion(path.join(modDir, 'package.json'), coreVersion);
    const packageName = pkgMeta.name !== '' ? pkgMeta.name : `@bslt/${id}`;
    const version = pkgMeta.version;
    const archiveName = `${id}-${version}.tar.gz`;

    const files = collectModuleFiles(modDir);
    const archiveBuffer = createDeterministicTarGz(files);
    const sha256 = sha256Hex(archiveBuffer);
    writeFileSync(path.join(options.outDir, archiveName), archiveBuffer);

    const migrationChecksums: Record<string, string> = {};
    for (const [migKey, sum] of Object.entries(lockMigrations).sort(([a], [b]) =>
      compareText(a, b),
    )) {
      if (migKey.startsWith(`${id}/`)) {
        migrationChecksums[migKey] = sum;
      }
    }

    const catalogFragment: ModuleCatalogDbFragment = {
      source: dbCatalog?.sources.find((s) => s.id === id) ?? null,
      types: dbCatalog?.types.filter((t) => t.source === id) ?? [],
      sequences: dbCatalog?.sequences.filter((s) => s.source === id) ?? [],
      functions: dbCatalog?.functions.filter((f) => f.source === id) ?? [],
      tables: dbCatalog?.tables.filter((t) => t.source === id) ?? [],
      views: dbCatalog?.views.filter((v) => v.source === id) ?? [],
    };

    catalogEntries.push({
      id,
      packageName,
      version,
      summary: modInfo.summary,
      status: modInfo.status,
      dependsOn: [...modInfo.dependsOn],
      web: modInfo.web,
      tables: [...modInfo.tables],
      endpointsCount: modInfo.endpoints.length,
      permissions: readDeclaredModulePermissions(path.join(modDir, 'module.ts')),
      archive: archiveName,
      sha256,
      bytes: archiveBuffer.length,
      migrationChecksums,
      catalogFragment,
    });
  }

  const catalog: ModulesCatalogManifest = {
    schemaVersion: 1,
    coreVersion,
    modules: catalogEntries,
  };
  const catalogPath = path.join(options.outDir, MODULES_CATALOG_FILENAME);
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  await Promise.resolve();
  return { outDir: options.outDir, catalogPath, catalog };
}
