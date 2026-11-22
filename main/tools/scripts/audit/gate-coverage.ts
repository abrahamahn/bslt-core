// main/tools/scripts/audit/gate-coverage.ts
/**
 * Gate coverage audit.
 *
 * Every gate in this repo answers "did the checks pass?". None of them answered
 * "did the checks read everything they were supposed to?" — and three separate
 * checks were found on 2026-08-06 running on a fraction of their subject:
 * `main/tools` was invisible to turbo, the hardcoded-value CSS lint read 4 of 28
 * stylesheets, and 339 source files had no colocated test.
 *
 * Each of those was a hand-maintained list that silently fell behind the tree.
 * This audit guards the ones that are still hand-maintained, so drift fails loudly
 * instead of quietly shrinking what the gate covers.
 *
 * Checks:
 * 1. The real-DB suites are selected from one place, their file-name suffix
 *    (`REAL_DB_TEST_SUFFIX` in `main/tools/lib/paths.ts`): `test:real-db` runs
 *    every file with it, `test:integration` excludes it, and every such file sits
 *    under `tests/integration`, where the vitest config looks. The script used to
 *    name 35 files by hand, and a file missing from it ran nowhere.
 * 2. Every workspace package defines `lint`, `type-check` and `test`. The merge
 *    gate runs those turbo tasks over the package graph (the hand-written
 *    `--filter` lists this check used to compare against are gone), and turbo
 *    skips a package that does not define a task, silently.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { fail, pass, type CheckResult } from '../../gates/types';
import { REAL_DB_TEST_SUFFIX, REPO_ROOT as ROOT } from '../../lib/paths';

export interface GateCoverageIssue {
  readonly check: string;
  readonly message: string;
}

interface PackageJson {
  readonly name?: string;
  readonly scripts?: Record<string, string>;
}

function readPackageJson(file: string): PackageJson {
  return JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
}

/** Repo-relative paths of every real-DB test, relative to `tests/`. */
export function realDbTestFiles(testsDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(REAL_DB_TEST_SUFFIX)) {
        found.push(path.relative(testsDir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(testsDir);
  walk(path.resolve(testsDir, '../main/modules'));
  return found.sort();
}

/**
 * Problems with how `tests/package.json` and `tests/vitest.config.ts` select the
 * real-DB suites, given the suites on disk (relative to `tests/`).
 */
export function realDbSelectionProblems(
  scripts: Readonly<Record<string, string>>,
  onDisk: readonly string[],
  vitestConfigText?: string,
): string[] {
  const problems: string[] = [];
  const realDb = (scripts['test:real-db'] ?? '').split(/\s+/u);
  const integration = scripts['test:integration'] ?? '';
  if (!realDb.includes(REAL_DB_TEST_SUFFIX)) {
    problems.push(
      `"test:real-db" must select every suite by its suffix: pass ${REAL_DB_TEST_SUFFIX} as the vitest filter.`,
    );
  }
  if (realDb.some((arg) => arg.endsWith(REAL_DB_TEST_SUFFIX) && arg !== REAL_DB_TEST_SUFFIX)) {
    problems.push(
      '"test:real-db" names suites one by one; a suite missing from a list runs nowhere.',
    );
  }
  if (!integration.includes(`--exclude '**/*${REAL_DB_TEST_SUFFIX}'`)) {
    problems.push(`"test:integration" must exclude '**/*${REAL_DB_TEST_SUFFIX}'.`);
  }
  const hasModuleRealDb = onDisk.some((file) => file.startsWith('../main/modules/'));
  if (
    hasModuleRealDb &&
    !integration.includes(`--exclude '../main/modules/**/*${REAL_DB_TEST_SUFFIX}'`)
  ) {
    problems.push(
      `"test:integration" must exclude '../main/modules/**/*${REAL_DB_TEST_SUFFIX}' (** does not match leading ..).`,
    );
  }
  if (
    hasModuleRealDb &&
    vitestConfigText !== undefined &&
    !vitestConfigText.includes(`../main/modules/**/*${REAL_DB_TEST_SUFFIX}`)
  ) {
    problems.push(
      `tests/vitest.config.ts must include '../main/modules/**/*${REAL_DB_TEST_SUFFIX}' so module real-DB suites run.`,
    );
  }
  for (const file of onDisk) {
    if (!file.startsWith('integration/') && !file.startsWith('../main/modules/')) {
      problems.push(
        `${file} is outside tests/integration and main/modules, which the vitest config includes.`,
      );
    }
  }
  return problems;
}

/** The turbo tasks the merge gate runs in every package. */
export const GATED_TASKS = ['lint', 'type-check', 'test'] as const;

export interface WorkspaceManifest {
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
}

/** `<package>: <task>` for each gated task a workspace package does not define. */
export function findPackagesMissingTasks(manifests: readonly WorkspaceManifest[]): string[] {
  return manifests
    .flatMap((manifest) =>
      GATED_TASKS.filter((task) => manifest.scripts[task] === undefined).map(
        (task) => `${manifest.name}: ${task}`,
      ),
    )
    .sort();
}

/** Workspace package names, discovered from package.json files rather than pnpm. */
export function workspacePackages(root: string): string[] {
  return [...new Set(workspaceManifests(root).map((manifest) => manifest.name))].sort();
}

/** Workspace package manifests under `main/` and `tests/`. */
export function workspaceManifests(root: string): WorkspaceManifest[] {
  const manifests: WorkspaceManifest[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const manifest = path.join(full, 'package.json');
      try {
        const pkg = readPackageJson(manifest);
        if (pkg.name !== undefined && pkg.name !== '@bslt/root') {
          manifests.push({ name: pkg.name, scripts: pkg.scripts ?? {} });
        }
      } catch {
        /* no manifest here; keep descending */
      }
      walk(full, depth + 1);
    }
  };
  walk(path.join(root, 'main'), 0);
  try {
    const pkg = readPackageJson(path.join(root, 'tests', 'package.json'));
    if (pkg.name !== undefined) manifests.push({ name: pkg.name, scripts: pkg.scripts ?? {} });
  } catch {
    /* no central tests package */
  }
  return manifests;
}

export function auditGateCoverage(root: string = ROOT): GateCoverageIssue[] {
  const issues: GateCoverageIssue[] = [];

  const testsPkg = readPackageJson(path.join(root, 'tests', 'package.json'));
  const vitestConfigPath = path.join(root, 'tests', 'vitest.config.ts');
  const vitestConfigText = existsSync(vitestConfigPath)
    ? readFileSync(vitestConfigPath, 'utf8')
    : undefined;
  for (const message of realDbSelectionProblems(
    testsPkg.scripts ?? {},
    realDbTestFiles(path.join(root, 'tests')),
    vitestConfigText,
  )) {
    issues.push({ check: 'test:real-db', message });
  }

  for (const missing of findPackagesMissingTasks(workspaceManifests(root))) {
    issues.push({
      check: 'turbo tasks',
      message: `${missing} is not defined — the merge gate's turbo task skips that package.`,
    });
  }

  return issues;
}

export function run(): CheckResult {
  const issues = auditGateCoverage();
  if (issues.length === 0) {
    return pass('every real-DB test and workspace package is reached by a gate');
  }
  return fail(
    `${String(issues.length)} coverage gap(s)`,
    issues.map((issue) => `[${issue.check}] ${issue.message}`),
  );
}
