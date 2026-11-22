// main/tools/gates/commands.test.ts
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';

import { plannedTasks, prettierArgs, turboArgs, turboFilters } from './commands';

import type { ChangeSet, GateContext } from './types';

const BASE = '0123456789abcdef0123456789abcdef01234567';
const ctx = (overrides: Partial<GateContext> = {}): GateContext => ({
  root: REPO_ROOT,
  ci: true,
  selfTest: false,
  ...overrides,
});
const changed = (files: string[]): ChangeSet => ({ ref: 'origin/main', base: BASE, files });

describe('turboArgs', () => {
  it('reproduces the merge gate: every package, --only, errors-only, --continue', () => {
    expect(turboArgs('lint', ctx())).toEqual([
      'run',
      'lint',
      '--only',
      '--output-logs=errors-only',
      '--continue',
    ]);
    expect(turboArgs('test', ctx())).toEqual([
      'run',
      'test',
      '--only',
      '--output-logs=errors-only',
      '--continue',
      '--',
      '--coverage.enabled=false',
    ]);
  });

  it('has no hand-written package filter outside the changed lane', () => {
    for (const task of ['lint', 'type-check', 'test', 'build'] as const) {
      expect(turboArgs(task, ctx()).some((arg) => arg.startsWith('--filter'))).toBe(false);
    }
  });

  it('shows only new output for type-check and test locally, and passes --concurrency', () => {
    expect(turboArgs('type-check', ctx({ ci: false, concurrency: 2 }))).toEqual([
      'run',
      'type-check',
      '--only',
      '--output-logs=new-only',
      '--continue',
      '--concurrency=2',
    ]);
  });

  it('builds with its dependencies, not --only', () => {
    expect(turboArgs('build', ctx())).toEqual([
      'run',
      'build',
      '--output-logs=errors-only',
      '--continue',
    ]);
  });

  it('narrows to the changed packages and their dependents in the changed lane', () => {
    const args = turboArgs('lint', ctx({ changed: changed(['main/server/core/src/a.ts']) }));
    expect(args).toContain(`--filter=...[${BASE}]`);
    expect(args).not.toContain('--filter=@bslt/tools');
  });

  it('asks turbo for its plan, not a run, in self-test mode', () => {
    expect(turboArgs('test', ctx({ selfTest: true }))).toEqual([
      'run',
      'test',
      '--only',
      '--dry=json',
    ]);
  });
});

describe('turboFilters', () => {
  it('filters to changed packages and their dependents from the merge base', () => {
    expect(turboFilters(changed(['main/tools/lib/paths.ts']))).toEqual([`--filter=...[${BASE}]`]);
  });
});

describe('prettierArgs', () => {
  it('checks the whole tree without a cache on CI, and with one locally', () => {
    expect(prettierArgs(ctx())).toEqual([
      '--config',
      'config/.prettierrc',
      '--no-cache',
      '--check',
      '.',
    ]);
    expect(prettierArgs(ctx({ ci: false }))).toEqual([
      '--config',
      'config/.prettierrc',
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      'node_modules/.cache/prettier/.cache',
      '--check',
      '.',
    ]);
  });

  it('checks only the changed files in the changed lane, and nothing when none changed', () => {
    expect(prettierArgs(ctx({ changed: changed(['a.ts', 'docs/x.md']) }))).toEqual([
      '--config',
      'config/.prettierrc',
      '--check',
      '--ignore-unknown',
      '--',
      'a.ts',
      'docs/x.md',
    ]);
    expect(prettierArgs(ctx({ changed: changed([]) }))).toBeUndefined();
  });

  it('checks one known file in self-test mode', () => {
    expect(prettierArgs(ctx({ selfTest: true }))).toEqual([
      '--config',
      'config/.prettierrc',
      '--check',
      'package.json',
    ]);
  });
});

describe('plannedTasks', () => {
  const PLAN = JSON.stringify({
    tasks: [{ taskId: '@bslt/web#lint' }, { taskId: '@bslt/ui#lint' }],
  });

  it('reads the task ids of a turbo dry run', () => {
    expect(plannedTasks(PLAN)).toEqual(['@bslt/web#lint', '@bslt/ui#lint']);
  });

  it('skips what pnpm prints before the plan', () => {
    // `pnpm exec` writes its own warnings to stdout. On a Node.js outside
    // `engines.node` that is one line with braces of its own, ahead of the JSON.
    const warning =
      ' WARN  Unsupported engine: wanted: {"node":">=24 <25"} (current: {"node":"v22.23.4","pnpm":"10.26.2"})';

    expect(plannedTasks(`${warning}\n${PLAN}\n`)).toEqual(['@bslt/web#lint', '@bslt/ui#lint']);
    expect(plannedTasks(`${warning}\n${JSON.stringify(JSON.parse(PLAN), null, 2)}\n`)).toEqual([
      '@bslt/web#lint',
      '@bslt/ui#lint',
    ]);
  });

  it('plans nothing for an empty graph and throws on output that holds no plan', () => {
    expect(plannedTasks('{"tasks":[]}')).toEqual([]);
    expect(() => plannedTasks(' WARN  something went wrong\n')).toThrow();
  });
});
