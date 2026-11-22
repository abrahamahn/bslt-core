// main/tools/scripts/audit/package-exports.ts
/**
 * Verifies workspace package export maps point at real files.
 *
 * Dist targets are checked only when that package has a dist directory, so the
 * audit is useful in a clean checkout and after a production build.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REPO_ROOT } from '../../lib/paths';

interface PackageExportIssue {
  readonly file: string;
  readonly message: string;
}

interface PackageJson {
  readonly exports?: unknown;
  readonly name?: unknown;
}

const PACKAGE_SCAN_ROOTS = ['main/apps', 'main/kernel', 'main/modules'] as const;

function toRepoPath(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listPackageJsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const entries = readdirSync(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;

    const packageJsonPath = path.join(entryPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      results.push(packageJsonPath);
      continue;
    }

    results.push(...listPackageJsonFiles(entryPath));
  }

  return results;
}

function collectExportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!isRecord(value)) return [];

  return Object.values(value).flatMap((entry) => collectExportTargets(entry));
}

function shouldCheckTarget(packageDir: string, target: string): boolean {
  if (!target.startsWith('./')) return false;
  if (target.includes('*')) return false;
  if (!target.includes('/dist/')) return true;
  return existsSync(path.join(packageDir, 'dist'));
}

function auditPackageExports(packageJsonPath: string): PackageExportIssue[] {
  const packageDir = path.dirname(packageJsonPath);
  const raw = readFileSync(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as PackageJson;
  const exportTargets = collectExportTargets(parsed.exports);
  const issues: PackageExportIssue[] = [];

  for (const target of exportTargets) {
    if (!shouldCheckTarget(packageDir, target)) continue;
    const absoluteTarget = path.resolve(packageDir, target);
    if (existsSync(absoluteTarget)) continue;
    issues.push({
      file: toRepoPath(packageJsonPath),
      message: `Export target does not exist: ${target}`,
    });
  }

  return issues;
}

function auditWorkspacePackageExports(): PackageExportIssue[] {
  return PACKAGE_SCAN_ROOTS.flatMap((scanRoot) =>
    listPackageJsonFiles(path.join(REPO_ROOT, scanRoot)),
  ).flatMap((packageJsonPath) => auditPackageExports(packageJsonPath));
}

export function run(): CheckResult {
  const issues = auditWorkspacePackageExports();
  if (issues.length === 0) {
    console.log('Package exports audit passed.');
    return pass('every workspace package export resolves');
  }

  console.error('Package exports audit failed:');
  for (const issue of issues) {
    console.error(`- ${issue.file}: ${issue.message}`);
  }
  return fail(`${String(issues.length)} package export issue(s)`);
}
