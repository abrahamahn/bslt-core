// main/tools/gates/module-shape.ts
/**
 * `module-shape` gate (restructure plan, sections 5.4, 12.7, and 14.3).
 *
 * Verifies every package under `main/modules/<id>/` conforms to the canonical
 * module layout, single baseline migration file pre-`foundation-v1`, namespaced
 * and fully referenced `en-US` message keys, zero JSX text/attribute literals
 * in module web `.tsx` files, zero `process.env` reads in production module code, and
 * `describeOwnerIsolation` coverage for every owner-isolated table.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';

import { fail, pass, type CheckResult } from './types';

const ALLOWED_TOP_LEVEL_ENTRIES = new Set([
  'module.ts',
  'module.test.ts',
  'package.json',
  'tsconfig.json',
  'tsconfig.lint.json',
  'vitest.config.ts',
  'eslint.config.ts',
  'README.md',
  'contract',
  'server',
  'web',
  'i18n',
  'seeds',
  'testing',
  // Ignored local/build directories
  'dist',
  'node_modules',
  'coverage',
  '.turbo',
  '.cache',
]);

const USER_FACING_JSX_ATTRS = new Set([
  'label',
  'placeholder',
  'title',
  'aria-label',
  'description',
]);

const README_START_MARKER = '<!-- bslt:generated reference -->';
const README_END_MARKER = '<!-- /bslt:generated -->';

function isTestFile(relPath: string): boolean {
  return (
    relPath.endsWith('.test.ts') ||
    relPath.endsWith('.test.tsx') ||
    relPath.endsWith('.spec.ts') ||
    relPath.endsWith('.spec.tsx') ||
    relPath.endsWith('.real-db.test.ts') ||
    relPath.includes('/__tests__/')
  );
}

function walkFiles(absDir: string, prefix = ''): string[] {
  if (!existsSync(absDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage' ||
      entry.name === '.turbo' ||
      entry.name === '.cache'
    ) {
      continue;
    }
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, rel));
    } else if (entry.isFile()) {
      results.push(rel);
    }
  }
  return results.sort(compareText);
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

interface ManifestSummary {
  readonly hasEndpoints: boolean;
  readonly hasWeb: boolean;
  readonly tables: readonly string[];
}

function inspectManifest(
  manifestPath: string,
  expectedId: string,
  problems: string[],
): ManifestSummary | null {
  const sf = ts.createSourceFile(
    manifestPath,
    readFileSync(manifestPath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (decl.initializer === undefined) continue;
      const init = unwrap(decl.initializer);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === 'defineModule' &&
        init.arguments[0] !== undefined
      ) {
        const arg = unwrap(init.arguments[0]);
        if (!ts.isObjectLiteralExpression(arg)) continue;

        let idText = '';
        let hasEndpoints = false;
        let hasWeb = true;
        const tables: string[] = [];

        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key =
            ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : '';
          const val = unwrap(prop.initializer);
          if (key === 'id' && ts.isStringLiteral(val)) {
            idText = val.text;
          } else if (key === 'endpoints') {
            if (ts.isObjectLiteralExpression(val)) {
              hasEndpoints = val.properties.length > 0;
            } else {
              hasEndpoints = true;
            }
          } else if (key === 'web' && val.kind === ts.SyntaxKind.FalseKeyword) {
            hasWeb = false;
          } else if (key === 'tables' && ts.isArrayLiteralExpression(val)) {
            for (const el of val.elements) {
              const unwrappedEl = unwrap(el);
              if (ts.isStringLiteral(unwrappedEl)) tables.push(unwrappedEl.text);
            }
          }
        }

        if (idText !== expectedId) {
          problems.push(
            `main/modules/${expectedId}/module.ts: declared id "${idText}" does not match folder "${expectedId}"`,
          );
        }

        return { hasEndpoints, hasWeb, tables };
      }
    }
  }

  problems.push(`main/modules/${expectedId}/module.ts: missing exported defineModule({...})`);
  return null;
}

function checkNoProcessEnv(absFile: string, repoRel: string, problems: string[]): void {
  const scriptKind = absFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    absFile,
    readFileSync(absFile, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    scriptKind,
  );

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      problems.push(
        `${repoRel}:${String(line + 1)}: direct process.env read is forbidden inside modules; declare manifest env instead`,
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
}

function checkNoJsxLiterals(absFile: string, repoRel: string, problems: string[]): void {
  const sf = ts.createSourceFile(
    absFile,
    readFileSync(absFile, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const trimmed = node.getText(sf).trim();
      if (trimmed.length > 0) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        problems.push(
          `${repoRel}:${String(line + 1)}: raw JSX text literal "${trimmed}" is forbidden in module web views; use t('${repoRel.split('/')[2] ?? 'module'}.*')`,
        );
      }
    } else if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const attrName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sf);
      const isLiteralInitializer =
        ts.isStringLiteral(node.initializer) ||
        (ts.isJsxExpression(node.initializer) &&
          node.initializer.expression !== undefined &&
          (ts.isStringLiteral(unwrap(node.initializer.expression)) ||
            ts.isNoSubstitutionTemplateLiteral(unwrap(node.initializer.expression)) ||
            ts.isTemplateExpression(unwrap(node.initializer.expression))));
      if (USER_FACING_JSX_ATTRS.has(attrName) && isLiteralInitializer) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        problems.push(
          `${repoRel}:${String(line + 1)}: raw string literal on JSX attribute "${attrName}" is forbidden; use t(...)`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
}

function collectStringLiteralsInWeb(webDir: string): Set<string> {
  const literals = new Set<string>();
  for (const rel of walkFiles(webDir)) {
    if (isTestFile(rel) || (!rel.endsWith('.ts') && !rel.endsWith('.tsx'))) continue;
    const abs = path.join(webDir, rel);
    const sf = ts.createSourceFile(
      abs,
      readFileSync(abs, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        literals.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return literals;
}

function findRegisteredSubscribersInServer(serverDir: string): string[] {
  if (!existsSync(serverDir)) return [];
  const subscriberIds: string[] = [];

  for (const rel of walkFiles(serverDir)) {
    if (isTestFile(rel) || (!rel.endsWith('.ts') && !rel.endsWith('.tsx'))) continue;
    const abs = path.join(serverDir, rel);
    const sf = ts.createSourceFile(
      abs,
      readFileSync(abs, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'on' || node.expression.text === 'onFlagged') &&
        node.arguments[1] !== undefined
      ) {
        const spec = unwrap(node.arguments[1]);
        if (ts.isObjectLiteralExpression(spec)) {
          let foundId = 'subscriber';
          for (const prop of spec.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
              prop.name.text === 'id' &&
              ts.isStringLiteral(unwrap(prop.initializer))
            ) {
              foundId = (unwrap(prop.initializer) as ts.StringLiteral).text;
            }
          }
          subscriberIds.push(foundId);
        } else {
          subscriberIds.push('subscriber');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return subscriberIds;
}

function hasRunSubscriberTwiceInServerTests(serverDir: string): boolean {
  if (!existsSync(serverDir)) return false;
  for (const rel of walkFiles(serverDir)) {
    if (!isTestFile(rel) || (!rel.endsWith('.ts') && !rel.endsWith('.tsx'))) continue;
    const abs = path.join(serverDir, rel);
    const sf = ts.createSourceFile(
      abs,
      readFileSync(abs, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 'runSubscriberTwice') ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'runSubscriberTwice'))
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (found) return true;
  }
  return false;
}

function findNonOwnerTablesInSql(sqlPath: string): Set<string> {
  const nonOwner = new Set<string>();
  if (!existsSync(sqlPath)) return nonOwner;
  const sql = readFileSync(sqlPath, 'utf8');
  const regex = /sys_apply_rls\(\s*'([^']+)'\s*,\s*'([^']+)'/gu;
  for (const match of sql.matchAll(regex)) {
    const table = match[1];
    const rlsClass = match[2];
    if (
      table !== undefined &&
      rlsClass !== undefined &&
      rlsClass !== 'owner_user' &&
      rlsClass !== 'owner_org'
    ) {
      nonOwner.add(table);
    }
  }
  return nonOwner;
}

function checkModuleDirectory(root: string, moduleId: string, problems: string[]): void {
  const modRel = `main/modules/${moduleId}`;
  const modDir = path.join(root, modRel);

  for (const entry of readdirSync(modDir)) {
    if (!ALLOWED_TOP_LEVEL_ENTRIES.has(entry)) {
      problems.push(
        `${modRel}/${entry}: unexpected top-level entry in module (allowed: module.ts, package.json, tsconfig.json, README.md, contract/, server/, web/, i18n/, testing/)`,
      );
    }
  }

  const pkgPath = path.join(modDir, 'package.json');
  if (!existsSync(pkgPath)) {
    problems.push(`${modRel}/package.json: missing file`);
  } else {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
    if (pkg.name !== `@bslt/${moduleId}`) {
      problems.push(
        `${modRel}/package.json: package name must be "@bslt/${moduleId}", got "${pkg.name ?? ''}"`,
      );
    }
  }

  if (!existsSync(path.join(modDir, 'tsconfig.json'))) {
    problems.push(`${modRel}/tsconfig.json: missing file`);
  }

  const readmePath = path.join(modDir, 'README.md');
  if (!existsSync(readmePath)) {
    problems.push(`${modRel}/README.md: missing file`);
  } else {
    const readme = readFileSync(readmePath, 'utf8');
    if (!readme.includes(README_START_MARKER) || !readme.includes(README_END_MARKER)) {
      problems.push(
        `${modRel}/README.md: missing ${README_START_MARKER} ... ${README_END_MARKER} block`,
      );
    }
  }

  const manifestPath = path.join(modDir, 'module.ts');
  if (!existsSync(manifestPath)) {
    problems.push(`${modRel}/module.ts: missing file`);
    return;
  }

  const manifest = inspectManifest(manifestPath, moduleId, problems);
  if (manifest === null) return;

  const serverDir = path.join(modDir, 'server');
  if (!existsSync(path.join(serverDir, 'index.ts'))) {
    problems.push(`${modRel}/server/index.ts: missing server binding`);
  } else {
    const subscriberIds = findRegisteredSubscribersInServer(serverDir);
    if (subscriberIds.length > 0 && !hasRunSubscriberTwiceInServerTests(serverDir)) {
      problems.push(
        `${modRel}/server: declares event subscriber(s) (${subscriberIds.join(', ')}) without a runSubscriberTwice(...) idempotency test in ${modRel}/server/*.test.ts`,
      );
    }
  }

  if (manifest.hasEndpoints && !existsSync(path.join(modDir, 'contract/endpoints.ts'))) {
    problems.push(`${modRel}/contract/endpoints.ts: required when module declares endpoints`);
  }

  const migrationsDir = path.join(modDir, 'server/migrations');
  if (existsSync(migrationsDir)) {
    const expectedSql = `0001_${moduleId}.sql`;
    for (const entry of readdirSync(migrationsDir, { withFileTypes: true }).sort((a, b) =>
      compareText(a.name, b.name),
    )) {
      if (entry.isDirectory() && entry.name === 'seeds') {
        const seedsDir = path.join(migrationsDir, 'seeds');
        for (const seedEntry of readdirSync(seedsDir, { withFileTypes: true }).sort((a, b) =>
          compareText(a.name, b.name),
        )) {
          if (!seedEntry.isFile() || !/^\d{4}_[a-z0-9_]+\.sql$/u.test(seedEntry.name)) {
            problems.push(
              `${modRel}/server/migrations/seeds/${seedEntry.name}: only numbered seed SQL files (0001_<name>.sql) are permitted`,
            );
          }
        }
        continue;
      }
      if (!entry.isFile() || entry.name !== expectedSql) {
        problems.push(
          `${modRel}/server/migrations/${entry.name}: only baseline "${expectedSql}" (and optional seeds/*.sql) is permitted before foundation-v1`,
        );
      }
    }
  }

  if (manifest.tables.length > 0) {
    const nonOwner = findNonOwnerTablesInSql(
      path.join(modDir, `server/migrations/0001_${moduleId}.sql`),
    );
    const ownerTables = manifest.tables.filter((t) => !nonOwner.has(t));
    if (ownerTables.length > 0) {
      const realDbTestPath = path.join(modDir, 'server/repository.real-db.test.ts');
      const realDbContent = existsSync(realDbTestPath) ? readFileSync(realDbTestPath, 'utf8') : '';
      for (const table of ownerTables) {
        const hasIsolation =
          realDbContent.includes('describeOwnerIsolation') &&
          (realDbContent.includes(`'${table}'`) || realDbContent.includes(`"${table}"`));
        if (!hasIsolation) {
          problems.push(
            `${modRel}/server/repository.real-db.test.ts: missing describeOwnerIsolation case for table "${table}"`,
          );
        }
      }
    }
  }

  const webDir = path.join(modDir, 'web');
  const i18nPath = path.join(modDir, 'i18n/en-US.json');

  if (!manifest.hasWeb) {
    if (existsSync(webDir)) {
      problems.push(`${modRel}/web: directory must not exist when module sets web: false`);
    }
  } else {
    if (!existsSync(path.join(webDir, 'index.ts'))) {
      problems.push(`${modRel}/web/index.ts: missing web binding (or set web: false in module.ts)`);
    }
    if (!existsSync(i18nPath)) {
      problems.push(`${modRel}/i18n/en-US.json: required when module has a web binding`);
    } else {
      const messages = JSON.parse(readFileSync(i18nPath, 'utf8')) as Record<string, unknown>;
      const referenced = collectStringLiteralsInWeb(webDir);
      const prefix = `${moduleId}.`;
      for (const key of Object.keys(messages).sort(compareText)) {
        if (!key.startsWith(prefix)) {
          problems.push(`${modRel}/i18n/en-US.json: key "${key}" must start with "${prefix}"`);
        } else if (!referenced.has(key)) {
          problems.push(
            `${modRel}/i18n/en-US.json: unused message key "${key}" (not referenced in ${modRel}/web/)`,
          );
        }
      }
    }

    for (const rel of walkFiles(webDir)) {
      if (!isTestFile(rel) && rel.endsWith('.tsx')) {
        checkNoJsxLiterals(path.join(webDir, rel), `${modRel}/web/${rel}`, problems);
      }
    }
  }

  for (const rel of walkFiles(modDir)) {
    if (
      isTestFile(rel) ||
      rel === 'vitest.config.ts' ||
      rel === 'eslint.config.ts' ||
      (!rel.endsWith('.ts') && !rel.endsWith('.tsx'))
    ) {
      continue;
    }
    checkNoProcessEnv(path.join(modDir, rel), `${modRel}/${rel}`, problems);
  }
}

export function run(root: string = REPO_ROOT): CheckResult {
  const modulesRoot = path.join(root, 'main/modules');
  if (!existsSync(modulesRoot)) {
    return pass('no native modules directory yet');
  }

  const moduleIds = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareText);

  const problems: string[] = [];
  for (const id of moduleIds) {
    checkModuleDirectory(root, id, problems);
  }

  if (problems.length === 0) {
    return pass(`${String(moduleIds.length)} module(s) conform to canonical module-shape`);
  }
  return fail(`${String(problems.length)} module-shape violation(s)`, problems);
}
