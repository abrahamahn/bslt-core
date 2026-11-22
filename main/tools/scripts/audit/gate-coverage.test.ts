// main/tools/scripts/audit/gate-coverage.test.ts
import { describe, expect, it } from 'vitest';

import { PATHS, REPO_ROOT } from '../../lib/paths';

import {
  auditGateCoverage,
  findPackagesMissingTasks,
  realDbSelectionProblems,
  realDbTestFiles,
  workspacePackages,
} from './gate-coverage';

const SELECTING = {
  'test:integration':
    "vitest run --config vitest.config.ts --exclude '**/*.real-db.test.ts' --exclude '../main/modules/**/*.real-db.test.ts'",
  'test:real-db': 'REQUIRE_REAL_DB=1 vitest run --config vitest.config.ts .real-db.test.ts',
};

describe('realDbSelectionProblems', () => {
  it('accepts a real-DB script that selects by suffix, which the integration script excludes', () => {
    expect(realDbSelectionProblems(SELECTING, ['integration/api/a.real-db.test.ts'])).toEqual([]);
  });

  it('rejects a hand-maintained file list: a new suite would run nowhere', () => {
    const listed = {
      ...SELECTING,
      'test:real-db': 'vitest run --config vitest.config.ts integration/api/a.real-db.test.ts',
    };
    expect(realDbSelectionProblems(listed, ['integration/api/a.real-db.test.ts'])).toEqual([
      expect.stringContaining('select every suite by its suffix'),
      expect.stringContaining('names suites one by one'),
    ]);
  });

  it('rejects an integration script that does not exclude the real-DB suites', () => {
    const including = { ...SELECTING, 'test:integration': 'vitest run --config vitest.config.ts' };
    expect(realDbSelectionProblems(including, [])).toEqual([
      expect.stringContaining('test:integration'),
    ]);
  });

  it('rejects a real-DB suite outside tests/integration, which the vitest include misses', () => {
    expect(realDbSelectionProblems(SELECTING, ['e2e/x.real-db.test.ts'])).toEqual([
      expect.stringContaining('e2e/x.real-db.test.ts'),
    ]);
  });

  it('requires tests/vitest.config.ts to include main/modules when a module real-DB suite exists', () => {
    expect(
      realDbSelectionProblems(
        SELECTING,
        ['../main/modules/tasks/server/repository.real-db.test.ts'],
        "include: ['integration/**/*.test.ts']",
      ),
    ).toEqual([expect.stringContaining('../main/modules/**/*.real-db.test.ts')]);

    expect(
      realDbSelectionProblems(
        SELECTING,
        ['../main/modules/tasks/server/repository.real-db.test.ts'],
        "include: ['integration/**/*.test.ts', '../main/modules/**/*.real-db.test.ts']",
      ),
    ).toEqual([]);

    expect(
      realDbSelectionProblems(
        {
          ...SELECTING,
          'test:integration':
            "vitest run --config vitest.config.ts --exclude '**/*.real-db.test.ts'",
        },
        ['../main/modules/tasks/server/repository.real-db.test.ts'],
        "include: ['integration/**/*.test.ts', '../main/modules/**/*.real-db.test.ts']",
      ),
    ).toEqual([expect.stringContaining("exclude '../main/modules/**/*.real-db.test.ts'")]);
  });
});

describe('findPackagesMissingTasks', () => {
  it('reports each gated task a workspace package does not define', () => {
    // turbo runs a task only in the packages that define it: a package without a
    // `test` script is silently never tested by the merge gate.
    expect(
      findPackagesMissingTasks([
        { name: '@bslt/db', scripts: { lint: 'x', 'type-check': 'x', test: 'x' } },
        { name: '@bslt/new', scripts: { lint: 'x' } },
      ]),
    ).toEqual(['@bslt/new: test', '@bslt/new: type-check'].sort());
  });

  it('is silent when every package defines lint, type-check and test', () => {
    expect(
      findPackagesMissingTasks([
        { name: '@bslt/db', scripts: { lint: 'x', 'type-check': 'x', test: 'x' } },
      ]),
    ).toEqual([]);
  });
});

describe('the real repository', () => {
  it('runs every real-DB test in test:real-db', () => {
    expect(auditGateCoverage().filter((i) => i.check === 'test:real-db')).toEqual([]);
  });

  it('reaches every workspace package with the turbo lint, type-check and test gates', () => {
    expect(auditGateCoverage().filter((i) => i.check === 'turbo tasks')).toEqual([]);
  });

  it('discovers the packages and real-DB tests it claims to check', () => {
    // Guards the discovery itself: an audit that finds nothing to inspect would
    // pass the two cases above while checking nothing at all.
    expect(workspacePackages(REPO_ROOT).length).toBeGreaterThanOrEqual(15);
    expect(realDbTestFiles(PATHS.tests).length).toBeGreaterThanOrEqual(20);
  });
});
