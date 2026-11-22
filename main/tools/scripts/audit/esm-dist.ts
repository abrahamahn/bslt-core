// main/tools/scripts/audit/esm-dist.ts
/**
 * Verifies built ESM output is directly runnable by Node.
 *
 * Two failure classes, both invisible until the artifact hits a real `node`:
 *
 * 1. Extensionless relative imports. TypeScript emits them as written under
 *    `moduleResolution: bundler`; each package's `build` script rewrites them to
 *    `.js` / `/index.js` via `bslt-esm-fix` (INSIDE `build`, not a
 *    postbuild — turbo's task hash only sees the build script, so a hook beside
 *    it kept replaying stale pre-rewrite dists from cache).
 *
 * 2. Leaked path aliases. `@hooks/useX` type-checks and bundles, but tsc never
 *    rewrites it, so the emitted file imports a package that does not exist.
 *    Checked only for `"type": "module"` packages — those are the ones whose
 *    dist a runtime `node` actually loads. Bundler-only CJS packages
 *    (`@bslt/ui`) are consumed from source via the `source` condition and their
 *    dist is not node-loadable by design (CSS imports).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import ts from 'typescript';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

interface EsmDistIssue {
  readonly file: string;
  readonly message: string;
}

interface PackageContext {
  readonly distDir: string;
  readonly isEsm: boolean;
  readonly declaredDependencies: ReadonlySet<string>;
  readonly devDependencies: ReadonlySet<string>;
}

const NODE_BUILTINS = new Set(builtinModules);

const DIST_ROOTS = ['main/apps', 'main/kernel', 'main/modules'] as const;

function toRepoPath(absolutePath: string, root: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function isTestingSubpath(filePath: string, distDir: string): boolean {
  const firstSegment = path.relative(distDir, filePath).split(path.sep)[0];
  return firstSegment === 'testing';
}

function hasExtension(specifier: string): boolean {
  const withoutQuery = specifier.split('?')[0] ?? specifier;
  const lastSegment = withoutQuery.split('/').pop() ?? '';
  return /\.[a-zA-Z0-9]+$/u.test(lastSegment);
}

function listDistDirs(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const entries = readdirSync(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'dist') {
      results.push(entryPath);
      continue;
    }
    results.push(...listDistDirs(entryPath));
  }

  return results;
}

function listJsFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const entries = readdirSync(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJsFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(entryPath);
    }
  }

  return results;
}

function expectedRuntimeSpecifier(fromFile: string, specifier: string): string | undefined {
  const baseDir = path.dirname(fromFile);
  const resolved = path.resolve(baseDir, specifier);

  if (hasExtension(specifier)) {
    return existsSync(resolved) && statSync(resolved).isFile() ? undefined : specifier;
  }

  if (existsSync(`${resolved}.js`) && statSync(`${resolved}.js`).isFile()) {
    return `${specifier}.js`;
  }

  const indexCandidate = path.join(resolved, 'index.js');
  if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
    return `${specifier}/index.js`;
  }

  return `${specifier}.js`;
}

function readStringLiteral(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

/** `@scope/name/subpath` → `@scope/name`; `name/subpath` → `name`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

function auditBareSpecifier(
  filePath: string,
  specifier: string,
  pkg: PackageContext,
  root: string,
): EsmDistIssue | undefined {
  if (!pkg.isEsm) return undefined;
  if (specifier.startsWith('node:') || specifier.startsWith('#')) return undefined;

  const packageName = packageNameOf(specifier);
  if (NODE_BUILTINS.has(packageName)) return undefined;
  if (pkg.declaredDependencies.has(packageName)) return undefined;
  if (isTestingSubpath(filePath, pkg.distDir) && pkg.devDependencies.has(packageName)) {
    return undefined;
  }

  return {
    file: toRepoPath(filePath, root),
    message: `Imports ${JSON.stringify(specifier)}, but ${JSON.stringify(packageName)} is not a declared dependency — a tsconfig path alias leaked into the emitted output.`,
  };
}

function auditRuntimeSpecifier(
  filePath: string,
  specifier: string,
  pkg: PackageContext,
  root: string,
): EsmDistIssue | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return auditBareSpecifier(filePath, specifier, pkg, root);
  }

  const expected = expectedRuntimeSpecifier(filePath, specifier);
  if (expected === undefined || expected === specifier) return undefined;

  return {
    file: toRepoPath(filePath, root),
    message: `Use runtime ESM specifier ${JSON.stringify(expected)} instead of ${JSON.stringify(specifier)}.`,
  };
}

function auditFile(filePath: string, pkg: PackageContext, root: string): EsmDistIssue[] {
  const content = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const issues: EsmDistIssue[] = [];

  function visit(node: ts.Node): void {
    const importOrExportSpecifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? readStringLiteral(node.moduleSpecifier)
        : undefined;
    const staticIssue =
      importOrExportSpecifier === undefined
        ? undefined
        : auditRuntimeSpecifier(filePath, importOrExportSpecifier, pkg, root);
    if (staticIssue !== undefined) {
      issues.push(staticIssue);
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const dynamicSpecifier = readStringLiteral(node.arguments[0]);
      const dynamicIssue =
        dynamicSpecifier === undefined
          ? undefined
          : auditRuntimeSpecifier(filePath, dynamicSpecifier, pkg, root);
      if (dynamicIssue !== undefined) {
        issues.push(dynamicIssue);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

function packageContextFor(distDir: string): PackageContext {
  const packageJsonPath = path.join(path.dirname(distDir), 'package.json');
  if (!existsSync(packageJsonPath)) {
    return {
      distDir,
      isEsm: false,
      declaredDependencies: new Set(),
      devDependencies: new Set(),
    };
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    type?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  return {
    distDir,
    isEsm: pkg.type === 'module',
    declaredDependencies: new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]),
    devDependencies: new Set(Object.keys(pkg.devDependencies ?? {})),
  };
}

function auditEsmDist(distDirs: string[], root: string): EsmDistIssue[] {
  return distDirs.flatMap((distDir) => {
    const pkg = packageContextFor(distDir);
    return listJsFiles(distDir).flatMap((filePath) => auditFile(filePath, pkg, root));
  });
}

export function run(root: string = REPO_ROOT): CheckResult {
  const distDirs = DIST_ROOTS.flatMap((distRoot) => listDistDirs(path.join(root, distRoot)));
  // A cold checkout has no dist to audit — that is a legitimate state (the gate
  // must pass on a fresh clone), but a silent "passed" here reads as coverage
  // that never happened. Say so; the post-build run is the meaningful one.
  if (distDirs.length === 0) {
    console.warn(
      'ESM dist audit: no dist directories found — nothing was audited. Run `pnpm build` for a meaningful check.',
    );
    return pass('no dist directories: nothing to audit until `pnpm build`');
  }

  const issues = auditEsmDist(distDirs, root);
  if (issues.length === 0) {
    console.log('ESM dist audit passed.');
    return pass(`${String(distDirs.length)} dist directories are valid ESM`);
  }

  console.error('ESM dist audit failed:');
  for (const issue of issues) {
    console.error(`- ${issue.file}: ${issue.message}`);
  }
  return fail(`${String(issues.length)} ESM dist issue(s)`);
}
