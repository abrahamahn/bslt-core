// main/tools/gates/optional-module-isolation.ts
/**
 * `optional-module-isolation` gate (Owner Decision D14).
 *
 * Enforces that Minimal Core (`main/kernel/**`,
 * `main/modules/{identity,compliance,audit,devtools}/**`, and
 * `main/apps/{server,web}/src/**` outside `src/generated/**`) never imports,
 * re-exports, dynamically imports, or mocks (`vi.mock` / `vi.importActual`) any
 * optional vertical module (`@bslt/<optional-id>`).
 *
 * Optional modules may only enter the composition roots through
 * `bslt.config.ts` and the files `bslt sync modules` emits under
 * `main/apps/{server,web}/src/generated/`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';

import { fail, pass, type CheckResult } from './types';

export const CORE_INSTALLED_MODULE_IDS = ['identity', 'compliance', 'audit'] as const;
export const CORE_DEV_ONLY_MODULE_IDS = ['devtools'] as const;

export const CORE_MODULE_IDS: ReadonlySet<string> = new Set<string>([
  ...CORE_INSTALLED_MODULE_IDS,
  ...CORE_DEV_ONLY_MODULE_IDS,
]);

export const KNOWN_OPTIONAL_MODULE_IDS = [
  'admin',
  'analytics',
  'billing',
  'entitlements',
  'files',
  'flags',
  'moderation',
  'notifications',
  'orgs',
  'projects',
  'search',
  'status',
  'support',
  'tasks',
  'webhooks',
] as const;

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.cache']);
const VI_MODULE_HELPERS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

export interface OptionalModuleViolation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly moduleId: string;
}

function collectOptionalModuleIds(root: string): Set<string> {
  const ids = new Set<string>(KNOWN_OPTIONAL_MODULE_IDS);
  const modulesDir = path.join(root, 'main/modules');
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !CORE_MODULE_IDS.has(entry.name)) {
        ids.add(entry.name);
      }
    }
  }
  return ids;
}

function walkTsFiles(root: string, relDir: string, out: string[], excludePrefix?: string): void {
  const absDir = path.join(root, relDir);
  if (!existsSync(absDir)) return;

  const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    compareText(a.name, b.name),
  );
  for (const entry of entries) {
    const childRel = `${relDir}/${entry.name}`;
    if (
      excludePrefix !== undefined &&
      (childRel === excludePrefix || childRel.startsWith(`${excludePrefix}/`))
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)) {
        walkTsFiles(root, childRel, out, excludePrefix);
      }
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(childRel);
    }
  }
}

function collectGuardedFiles(root: string): string[] {
  const files: string[] = [];
  walkTsFiles(root, 'main/kernel', files);
  for (const coreId of CORE_MODULE_IDS) {
    walkTsFiles(root, `main/modules/${coreId}`, files);
  }
  walkTsFiles(root, 'main/apps/server/src', files, 'main/apps/server/src/generated');
  walkTsFiles(root, 'main/apps/web/src', files, 'main/apps/web/src/generated');
  return files.sort(compareText);
}

function extractBsltModuleId(specifier: string, optionalIds: ReadonlySet<string>): string | null {
  const match = /^@bslt\/([a-z][a-z0-9-]*)(?:\/|$)/u.exec(specifier);
  const id = match?.[1];
  if (id === undefined || !optionalIds.has(id)) {
    return null;
  }
  return id;
}

function scanFileForOptionalImports(
  root: string,
  relFile: string,
  optionalIds: ReadonlySet<string>,
): OptionalModuleViolation[] {
  const absFile = path.join(root, relFile);
  const sourceText = readFileSync(absFile, 'utf8');
  if (!sourceText.includes('@bslt/')) {
    return [];
  }

  const sf = ts.createSourceFile(
    absFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    relFile.endsWith('.tsx') || relFile.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations: OptionalModuleViolation[] = [];
  const recordSpecifier = (node: ts.Node, literal: string): void => {
    const moduleId = extractBsltModuleId(literal, optionalIds);
    if (moduleId === null) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({
      file: relFile,
      line: line + 1,
      specifier: literal,
      moduleId,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      recordSpecifier(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      recordSpecifier(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      recordSpecifier(node.argument.literal, node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const firstArg = node.arguments[0];
      if (firstArg !== undefined && ts.isStringLiteralLike(firstArg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          recordSpecifier(firstArg, firstArg.text);
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'vi' &&
          VI_MODULE_HELPERS.has(node.expression.name.text)
        ) {
          recordSpecifier(firstArg, firstArg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return violations;
}

export function findOptionalModuleViolations(root: string = REPO_ROOT): OptionalModuleViolation[] {
  const optionalIds = collectOptionalModuleIds(root);
  const guardedFiles = collectGuardedFiles(root);
  const violations: OptionalModuleViolation[] = [];
  for (const relFile of guardedFiles) {
    violations.push(...scanFileForOptionalImports(root, relFile, optionalIds));
  }
  return violations;
}

export function run(root: string = REPO_ROOT): CheckResult {
  const violations = findOptionalModuleViolations(root);
  if (violations.length === 0) {
    return pass(
      'Minimal Core and app composition roots isolate all optional modules behind src/generated/',
    );
  }
  return fail(
    `${String(violations.length)} optional-module import(s) outside src/generated/ in Core or app packages`,
    violations.map(
      (v) =>
        `${v.file}:${String(v.line)}: imports optional module "${v.specifier}" (@bslt/${v.moduleId}); route through bslt sync modules (src/generated/) instead`,
    ),
  );
}
