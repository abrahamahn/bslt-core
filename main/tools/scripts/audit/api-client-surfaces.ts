// main/tools/scripts/audit/api-client-surfaces.ts
/**
 * Browser REST transport surface audit.
 *
 * The canonical browser REST transport is `@bslt/client-engine` (`createTransport`
 * + `createEndpointClient`). Web app code must not introduce feature-local API
 * adapters or raw `fetch(...)` calls outside documented allowlist entries.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

import { toRepoRelative, walkFiles } from './file-utils';

interface Violation {
  readonly file: string;
  readonly message: string;
}

const WEB_SRC_ROOT = path.join(REPO_ROOT, 'main/apps/web/src');
const WEB_FEATURES_ROOT = path.join(WEB_SRC_ROOT, 'features');
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.turbo']);
const SOURCE_FILE_PATTERN = /\.(ts|tsx|mts|cts)$/u;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|mts|cts)$/u;
const DECLARATION_FILE_PATTERN = /\.d\.(ts|mts|cts)$/u;

const RAW_FETCH_ALLOWLIST: ReadonlyMap<string, string> = new Map([] as const);

function isRuntimeSourceFile(filePath: string): boolean {
  return (
    SOURCE_FILE_PATTERN.test(filePath) &&
    !DECLARATION_FILE_PATTERN.test(filePath) &&
    !TEST_FILE_PATTERN.test(filePath)
  );
}

function isFeatureLocalApiSurface(filePath: string): boolean {
  const relative = toRepoRelative(REPO_ROOT, filePath);
  if (!relative.startsWith('main/apps/web/src/features/')) return false;
  if (!isRuntimeSourceFile(filePath)) return false;

  const featureRelative = toRepoRelative(WEB_FEATURES_ROOT, filePath);
  return (
    /(^|\/)api\/[^/]+\.(ts|tsx|mts|cts)$/u.test(featureRelative) ||
    /(^|\/)services\/[^/]*Api\.(ts|tsx|mts|cts)$/u.test(featureRelative)
  );
}

function collectSourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return walkFiles(root, isRuntimeSourceFile, IGNORED_DIRS);
}

function isGlobalFetchExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === 'fetch';

  if (!ts.isPropertyAccessExpression(expression)) return false;
  if (expression.name.text !== 'fetch') return false;

  const receiver = expression.expression;
  return (
    ts.isIdentifier(receiver) && (receiver.text === 'globalThis' || receiver.text === 'window')
  );
}

function collectFetchCallLines(filePath: string): number[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isGlobalFetchExpression(node.expression)) {
      lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lines;
}

function collectFeatureLocalApiSurfaceViolations(): Violation[] {
  const violations: Violation[] = [];
  if (!existsSync(WEB_FEATURES_ROOT)) return violations;
  const surfaces = walkFiles(WEB_FEATURES_ROOT, isFeatureLocalApiSurface, IGNORED_DIRS);

  for (const file of surfaces) {
    const relative = toRepoRelative(REPO_ROOT, file);
    violations.push({
      file: relative,
      message:
        'New feature-local API adapter detected. Declare endpoints in main/modules/<id>/contract and call via @bslt/client-engine.',
    });
  }

  return violations;
}

function collectRawFetchViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const file of collectSourceFiles(WEB_SRC_ROOT)) {
    const relative = toRepoRelative(REPO_ROOT, file);
    const lines = collectFetchCallLines(file);
    if (lines.length === 0) continue;
    if (RAW_FETCH_ALLOWLIST.has(relative)) continue;

    violations.push({
      file: relative,
      message: `Runtime fetch call at line(s) ${lines.join(', ')}. Use @bslt/client-engine transport or add a documented allowlist entry.`,
    });
  }

  return violations;
}

export function run(): CheckResult {
  const violations = [...collectFeatureLocalApiSurfaceViolations(), ...collectRawFetchViolations()];

  if (violations.length === 0) {
    console.log('API client surface audit passed.');
    console.log('Canonical browser REST transport: @bslt/client-engine.');
    return pass('no feature-local API surfaces or raw fetches in main/apps/web');
  }

  console.error('API client surface audit failed:');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.message}`);
  }

  return fail(`${String(violations.length)} API client surface violation(s)`);
}
