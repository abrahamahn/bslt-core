// main/tools/scripts/audit/declared-dependencies.ts
/**
 * Every package a workspace package imports is declared in its own package.json.
 *
 * pnpm links into a package's `node_modules` only what that package declares,
 * but Node and the bundlers walk up the tree, so an undeclared import still
 * resolves on a laptop: through the repository root's `node_modules`, or
 * through a workspace package someone else declared. It breaks where the tree is
 * different:
 *
 * - `@bslt/realtime` imported `ws` and declared it only as a devDependency and an
 *   optional peer. The server image copies realtime's `dist` by hand, so
 *   `import('@bslt/realtime')` failed with ERR_MODULE_NOT_FOUND 'ws', and turning
 *   the realtime capability on crashed the API at boot.
 * - `@bslt/tests` imported `@bslt/api` without declaring it, so turbo's
 *   `--filter=...@bslt/api` never type-checked or tested `@bslt/tests`.
 *
 * Two rules:
 *
 * 1. `undeclared`: every bare specifier in a package's sources, tests and configs
 *    (static and type-only imports, `export ... from`, `import()`, `require()`,
 *    `require.resolve()`, `vi.mock()` and the other `vi` module helpers,
 *    `import x = require()`, `typeof import()`, `/// <reference types>`) names a
 *    package in that package's `dependencies`, `devDependencies`,
 *    `peerDependencies` or `optionalDependencies`. A type-only reference may be
 *    declared through `@types/<name>` instead. `node:` and bare builtins, relative
 *    paths, the package's own name and other schemes (`virtual:`) are not
 *    packages; `#` specifiers must match a key of the package's `imports` map.
 * 2. `dev-only-in-production`: in a package that ships in a production image, a
 *    runtime import from production source (`src/`, minus tests, `__tests__`,
 *    `__mocks__` and the `testing` test-support entry) must be in `dependencies`, `optionalDependencies` or a required
 *    peer. A devDependency or an optional peer is not installed for it there.
 *
 * Which packages ship is read from the Dockerfiles under `infra/`: the targets of
 * `pnpm --filter <pkg> deploy --prod`, the packages a `for p in ...` loop copies
 * from a workspace directory (`main/kernel/$p` or `main/server/$p`), and their production workspace
 * dependencies. The web image is a static Vite bundle served by nginx, so no web
 * or client package ships as a Node package.
 *
 * eslint-plugin-import-x's `no-extraneous-dependencies` is installed, but it is
 * not this check: it resolves every import first and stays silent on one it
 * cannot resolve (which, under pnpm, is what an undeclared package often is),
 * skips workspace packages unless they resolve into `node_modules`, ignores
 * `vi.mock()`, and knows nothing about which packages an image ships.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

import ts from 'typescript';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

import { toPosixPath } from './file-utils';

export interface ImportRef {
  readonly specifier: string;
  /** Erased at build time: `import type`, `typeof import()`, a declaration file. */
  readonly typeOnly: boolean;
  readonly line: number;
}

export interface WorkspacePackage {
  readonly name: string;
  /** Repository-relative, forward slashes. */
  readonly dir: string;
  readonly manifest: Manifest;
}

export interface Manifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { optional?: boolean }>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly imports?: Readonly<Record<string, unknown>>;
}

export type Problem =
  'undeclared' | 'dev-only-in-production' | 'unmapped-subpath-import' | 'unknown-image-package';

export interface DependencyFinding {
  readonly problem: Problem;
  /** The importing package (or, for `unknown-image-package`, the Dockerfile's target). */
  readonly packageName: string;
  /** Repository-relative manifest of the importing package. */
  readonly manifest: string;
  /** Repository-relative file and 1-based line of the reference. */
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  /** The package the specifier names (the specifier itself for `#` imports). */
  readonly dependency: string;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
/**
 * Test-support directories under `src/`. `testing` is a test-only entry point a
 * package exports for other packages' tests (`@bslt/db/testing`); what it imports
 * at runtime is declared as an optional peer, which only those tests provide.
 */
const TEST_DIRS = new Set(['__tests__', '__mocks__', 'testing']);
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const VI_MODULE_HELPERS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

// ---------------------------------------------------------------------------
// Specifiers
// ---------------------------------------------------------------------------

function stringArgument(node: ts.CallExpression): string | undefined {
  const [first] = node.arguments;
  if (first === undefined) return undefined;
  if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) return first.text;
  return undefined;
}

function isRequireCall(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === 'require';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'require' &&
    callee.name.text === 'resolve'
  );
}

function isViModuleHelper(callee: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'vi' &&
    VI_MODULE_HELPERS.has(callee.name.text)
  );
}

/** Every module reference in one file, in source order. */
export function collectImports(fileName: string, sourceText: string): ImportRef[] {
  const declarationFile = DECLARATION_FILE.test(fileName);
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: { specifier: string; typeOnly: boolean; pos: number }[] = [];
  const add = (specifier: string, typeOnly: boolean, pos: number): void => {
    found.push({ specifier, typeOnly: typeOnly || declarationFile, pos });
  };

  for (const reference of sourceFile.typeReferenceDirectives) {
    add(reference.fileName, true, reference.pos);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.importClause?.isTypeOnly === true, node.getStart());
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text, node.isTypeOnly, node.getStart());
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression.text, node.isTypeOnly, node.getStart());
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal.text, true, node.getStart());
    } else if (ts.isCallExpression(node)) {
      const specifier = stringArgument(node);
      const callee = node.expression;
      if (
        specifier !== undefined &&
        (callee.kind === ts.SyntaxKind.ImportKeyword ||
          isRequireCall(callee) ||
          isViModuleHelper(callee))
      ) {
        add(specifier, false, node.getStart());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return found
    .sort((a, b) => a.pos - b.pos)
    .map(({ specifier, typeOnly, pos }) => ({
      specifier,
      typeOnly,
      line: sourceFile.getLineAndCharacterOfPosition(pos).line + 1,
    }));
}

/**
 * The package a bare specifier names (`@scope/name/sub` -> `@scope/name`), or
 * undefined for a relative or absolute path, a builtin, a `#` import or another
 * scheme (`node:`, `virtual:`).
 */
export function packageNameOf(specifier: string): string | undefined {
  const bare = specifier.split('?')[0] ?? '';
  if (bare === '' || bare.startsWith('.') || bare.startsWith('/') || bare.startsWith('#')) {
    return undefined;
  }
  if (bare.includes(':') || isBuiltin(bare)) return undefined;
  const parts = bare.split('/');
  if (bare.startsWith('@')) {
    return parts.length >= 2 && parts[1] !== '' ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : undefined;
  }
  return parts[0];
}

/** `ws` -> `@types/ws`, `@scope/pkg` -> `@types/scope__pkg`. */
function typesPackageOf(name: string): string {
  return `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
}

function matchesImportsKey(specifier: string, imports: Manifest['imports']): boolean {
  return Object.keys(imports ?? {}).some((key) => {
    const star = key.indexOf('*');
    if (star === -1) return key === specifier;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    return (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    );
  });
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function readManifest(file: string): Manifest {
  return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
}

function subdirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter((entry) => entry.name !== 'node_modules')
    .map((entry) => path.join(dir, entry.name));
}

/** The `packages:` globs of `pnpm-workspace.yaml` (`dir`, `dir/*`, `dir/**`). */
function workspaceGlobs(root: string): string[] {
  const yaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const globs: string[] = [];
  let inPackages = false;
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/#.*$/u, '').trimEnd();
    if (line.trim() === '') continue;
    if (/^\S/u.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    const item = /^\s+-\s+['"]?([^'"]+)['"]?$/u.exec(line);
    if (inPackages && item?.[1] !== undefined && !item[1].startsWith('!')) globs.push(item[1]);
  }
  return globs;
}

function expandGlob(root: string, glob: string): string[] {
  if (glob.endsWith('/**')) {
    const walk = (dir: string): string[] =>
      subdirectories(dir).flatMap((child) => [child, ...walk(child)]);
    return walk(path.join(root, glob.slice(0, -3)));
  }
  if (glob.endsWith('/*')) return subdirectories(path.join(root, glob.slice(0, -2)));
  return [path.join(root, glob)];
}

/** The pnpm workspace packages (the root excluded), sorted by directory. */
export function workspacePackages(root: string): WorkspacePackage[] {
  const dirs = new Set(workspaceGlobs(root).flatMap((glob) => expandGlob(root, glob)));
  const packages: WorkspacePackage[] = [];
  for (const dir of dirs) {
    const file = path.join(dir, 'package.json');
    if (!existsSync(file)) continue;
    const manifest = readManifest(file);
    if (manifest.name === undefined) continue;
    packages.push({
      name: manifest.name,
      dir: toPosixPath(path.relative(root, dir)),
      manifest,
    });
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir));
}

// ---------------------------------------------------------------------------
// Production images
// ---------------------------------------------------------------------------

interface ImageReference {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

function dockerfiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) walk(full);
      else if (entry.isFile() && /^Dockerfile(?:\.(?!dockerignore$)[\w-]+)?$/u.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(path.join(root, 'infra'));
  return found.sort();
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function deployReferences(root: string): ImageReference[] {
  const references: ImageReference[] = [];
  const pattern = /pnpm\s+(?:--filter|-F)[=\s]+["']?([^"'\s]+)["']?\s+deploy\b[^\n]*--prod\b/gu;
  for (const file of dockerfiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? '';
      if (value.includes('$')) continue;
      references.push({
        file: toPosixPath(path.relative(root, file)),
        line: lineOf(text, match.index),
        value,
      });
    }
  }
  return references;
}

/** Packages a Dockerfile installs with `pnpm --filter <pkg> deploy --prod`. */
export function deployedPackages(root: string): string[] {
  return [...new Set(deployReferences(root).map((reference) => reference.value))].sort();
}

/**
 * Workspace directories a Dockerfile copies into an image by hand: every
 * `<dir>/$p` path inside a `for p in a b; do ... done` loop, expanded, that is a
 * workspace package.
 */
export function copiedPackageDirs(root: string): string[] {
  const workspaceDirs = new Set(workspacePackages(root).map((pkg) => pkg.dir));
  const copied = new Set<string>();
  for (const file of dockerfiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const loop of text.matchAll(
      /for\s+(\w+)\s+in\s+([\w\s.-]+?);\s*do\b([\s\S]*?)\bdone\b/gu,
    )) {
      const variable = loop[1] ?? '';
      const names = (loop[2] ?? '').split(/\s+/u).filter((name) => name !== '');
      const body = loop[3] ?? '';
      const paths = new RegExp(String.raw`([\w./-]+)/\$\{?${variable}\}?(?![\w])`, 'gu');
      for (const use of body.matchAll(paths)) {
        for (const name of names) {
          const dir = `${use[1] ?? ''}/${name}`;
          if (workspaceDirs.has(dir)) copied.add(dir);
        }
      }
    }
  }
  return [...copied].sort();
}

function productionWorkspaceDependencies(manifest: Manifest): string[] {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
}

/** Names of the workspace packages that ship in a production image. */
export function productionPackages(root: string): Set<string> {
  const packages = workspacePackages(root);
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));
  const queue = [
    ...deployedPackages(root),
    ...copiedPackageDirs(root).flatMap((dir) => byDir.get(dir)?.name ?? []),
  ];
  const shipped = new Set<string>();
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || shipped.has(name)) continue;
    const pkg = byName.get(name);
    if (pkg === undefined) continue;
    shipped.add(name);
    queue.push(...productionWorkspaceDependencies(pkg.manifest).filter((dep) => byName.has(dep)));
  }
  return shipped;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Source files of one package: its own tree, minus build output and nested packages. */
function packageFiles(packageDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        if (existsSync(path.join(full, 'package.json'))) continue;
        walk(full);
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(packageDir);
  return files.sort();
}

function isProductionSource(relativeToPackage: string): boolean {
  const segments = relativeToPackage.split('/');
  const isNodeRuntimeTree =
    segments[0] === 'src' ||
    relativeToPackage === 'module.ts' ||
    segments[0] === 'contract' ||
    segments[0] === 'server';
  return (
    isNodeRuntimeTree &&
    !TEST_FILE.test(relativeToPackage) &&
    !segments.some((segment) => TEST_DIRS.has(segment))
  );
}

function isOptionalPeer(manifest: Manifest, name: string): boolean {
  return manifest.peerDependenciesMeta?.[name]?.optional === true;
}

function declaredAnywhere(manifest: Manifest, name: string): boolean {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].some((field) => field?.[name] !== undefined);
}

function declaredForProduction(manifest: Manifest, name: string): boolean {
  return (
    manifest.dependencies?.[name] !== undefined ||
    manifest.optionalDependencies?.[name] !== undefined ||
    (manifest.peerDependencies?.[name] !== undefined && !isOptionalPeer(manifest, name))
  );
}

function auditPackage(root: string, pkg: WorkspacePackage, shipped: boolean): DependencyFinding[] {
  const findings: DependencyFinding[] = [];
  const packageDir = path.join(root, pkg.dir);
  const manifest = `${pkg.dir}/package.json`;

  for (const file of packageFiles(packageDir)) {
    const relative = toPosixPath(path.relative(packageDir, file));
    const production = shipped && isProductionSource(relative);
    const repoFile = toPosixPath(path.relative(root, file));

    for (const ref of collectImports(file, readFileSync(file, 'utf8'))) {
      const finding = (problem: Problem, dependency: string): DependencyFinding => ({
        problem,
        packageName: pkg.name,
        manifest,
        file: repoFile,
        line: ref.line,
        specifier: ref.specifier,
        dependency,
      });

      if (ref.specifier.startsWith('#')) {
        if (!matchesImportsKey(ref.specifier, pkg.manifest.imports)) {
          findings.push(finding('unmapped-subpath-import', ref.specifier));
        }
        continue;
      }

      const name = packageNameOf(ref.specifier);
      if (name === undefined || name === pkg.name) continue;

      const declared =
        declaredAnywhere(pkg.manifest, name) ||
        (ref.typeOnly && declaredAnywhere(pkg.manifest, typesPackageOf(name)));
      if (!declared) {
        findings.push(finding('undeclared', name));
      } else if (production && !ref.typeOnly && !declaredForProduction(pkg.manifest, name)) {
        findings.push(finding('dev-only-in-production', name));
      }
    }
  }
  return findings;
}

export function auditDeclaredDependencies(root: string = REPO_ROOT): DependencyFinding[] {
  const packages = workspacePackages(root);
  const names = new Set(packages.map((pkg) => pkg.name));
  const shipped = productionPackages(root);

  const imageFindings: DependencyFinding[] = deployReferences(root)
    .filter((reference) => !names.has(reference.value))
    .map((reference) => ({
      problem: 'unknown-image-package',
      packageName: reference.value,
      manifest: '',
      file: reference.file,
      line: reference.line,
      specifier: reference.value,
      dependency: reference.value,
    }));

  return [
    ...imageFindings,
    ...packages.flatMap((pkg) => auditPackage(root, pkg, shipped.has(pkg.name))),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function describeFinding(finding: DependencyFinding): string {
  const where = `${finding.file}:${String(finding.line)}`;
  const owner = `${finding.packageName} (${finding.manifest})`;
  switch (finding.problem) {
    case 'undeclared':
      return `${where} imports '${finding.specifier}', but ${owner} does not declare ${finding.dependency}`;
    case 'dev-only-in-production':
      return (
        `${where} imports '${finding.specifier}' from production source, but ${owner} ` +
        `declares ${finding.dependency} only as a devDependency or an optional peer; ` +
        `${finding.packageName} ships in a production image, where neither is installed for it`
      );
    case 'unmapped-subpath-import':
      return `${where} imports '${finding.specifier}', which matches no key of the imports map of ${owner}`;
    case 'unknown-image-package':
      return `${where} deploys ${finding.dependency}, which is not a workspace package`;
  }
}

export function run(root: string = REPO_ROOT): CheckResult {
  const findings = auditDeclaredDependencies(root);
  const shipped = [...productionPackages(root)].sort();
  if (findings.length === 0) {
    return pass(
      `every import is declared by its package; ${String(shipped.length)} packages ship in an image`,
    );
  }
  return fail(
    `${String(findings.length)} import(s) not declared by the importing package`,
    findings.map(describeFinding),
  );
}
