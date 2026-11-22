// main/tools/scripts/audit/client-public-surfaces.ts
/**
 * Client Public Surface Audit
 *
 * Keeps app and test code on declared client package entrypoints instead of
 * importing private source files through wildcard tsconfig aliases.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

import { toRepoRelative, walkFiles } from './file-utils';

interface Violation {
  file: string;
  specifier: string;
  message: string;
  kind: 'import' | 'tsconfig path';
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.turbo']);
const SOURCE_ROOTS = ['main', 'tests', 'config'].map((segment) => path.join(REPO_ROOT, segment));
const SOURCE_FILE_PATTERN = /\.(ts|tsx|mts|cts)$/u;
const TSCONFIG_FILE_PATTERN = /(^|[/\\])tsconfig(?:\.[^/\\]+)?\.json$/u;
const ALLOWED_REACT_SUBPATHS = new Set(['@bslt/react/hooks', '@bslt/react/router']);
const ALLOWED_UI_SUBPATHS = new Set([
  '@bslt/ui/components',
  '@bslt/ui/elements',
  '@bslt/ui/layouts',
  '@bslt/ui/theme',
  '@bslt/ui/utils',
]);
const MODULE_SPECIFIER_CALLS = new Set(['doMock', 'importActual', 'mock', 'requireActual']);

function isSourceFile(filePath: string): boolean {
  return SOURCE_FILE_PATTERN.test(filePath) && !filePath.endsWith('.d.ts');
}

function clientSurfaceMessage(specifier: string): string | undefined {
  if (specifier.startsWith('@bslt/client-engine/')) {
    return 'Use the @bslt/client-engine root export; private engine subpaths are not public.';
  }

  if (specifier.startsWith('@bslt/web-platform/')) {
    return 'Use the @bslt/web-platform root export; private web-platform subpaths are not public.';
  }

  if (specifier.startsWith('@bslt/react/') && !ALLOWED_REACT_SUBPATHS.has(specifier)) {
    return 'Use @bslt/react, @bslt/react/hooks, or @bslt/react/router; other React subpaths are private.';
  }

  if (
    specifier.startsWith('@bslt/ui/') &&
    !ALLOWED_UI_SUBPATHS.has(specifier) &&
    specifier !== '@bslt/ui/styles/*' &&
    !specifier.startsWith('@bslt/ui/styles/')
  ) {
    return 'Use @bslt/ui or one of the declared category exports; UI leaf files are private.';
  }

  return undefined;
}

function isModuleSpecifierCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === 'require';
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    return (
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.expression.text === 'vi' || node.expression.expression.text === 'jest') &&
      MODULE_SPECIFIER_CALLS.has(node.expression.name.text)
    );
  }

  return false;
}

function collectImportSpecifiers(filePath: string): string[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }

    if (ts.isCallExpression(node) && isModuleSpecifierCall(node)) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }

    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        specifiers.push(argument.literal.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function collectImportViolations(): Violation[] {
  const files = SOURCE_ROOTS.flatMap((root) =>
    existsSync(root) ? walkFiles(root, isSourceFile, IGNORED_DIRS) : [],
  );
  const violations: Violation[] = [];

  for (const file of files) {
    for (const specifier of collectImportSpecifiers(file)) {
      const message = clientSurfaceMessage(specifier);
      if (message === undefined) continue;
      violations.push({
        file: toRepoRelative(REPO_ROOT, file),
        specifier,
        message,
        kind: 'import',
      });
    }
  }

  return violations;
}

function collectTsconfigViolations(): Violation[] {
  const tsconfigFiles = walkFiles(
    REPO_ROOT,
    (filePath) => TSCONFIG_FILE_PATTERN.test(filePath),
    IGNORED_DIRS,
  );
  const violations: Violation[] = [];

  for (const file of tsconfigFiles) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      compilerOptions?: { paths?: Record<string, unknown> };
    };
    const paths = raw.compilerOptions?.paths ?? {};
    for (const alias of Object.keys(paths)) {
      const message = clientSurfaceMessage(alias);
      if (message === undefined) continue;
      violations.push({
        file: toRepoRelative(REPO_ROOT, file),
        specifier: alias,
        message,
        kind: 'tsconfig path',
      });
    }
  }

  return violations;
}

export function run(): CheckResult {
  const violations = [...collectImportViolations(), ...collectTsconfigViolations()];

  if (violations.length === 0) {
    console.log('Client public surface audit passed.');
    return pass('client packages are imported only through their public surfaces');
  }

  console.error('Client public surface audit failed:');
  for (const violation of violations) {
    console.error(
      `- ${violation.kind} ${violation.specifier} in ${violation.file}: ${violation.message}`,
    );
  }

  return fail(`${String(violations.length)} client public surface violation(s)`);
}
