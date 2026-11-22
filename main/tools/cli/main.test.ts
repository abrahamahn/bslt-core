// main/tools/cli/main.test.ts
import { describe, expect, it } from 'vitest';

import { GATES } from '../gates/registry';
import { gatesForLane } from '../gates/runner';
import { REPO_ROOT } from '../lib/paths';

import { describeLanePlan, main, parseGateCommand } from './main';

describe('parseGateCommand', () => {
  it('parses the self-test and the list', () => {
    expect(parseGateCommand(['--self-test'])).toEqual({ kind: 'self-test', args: [] });
    expect(parseGateCommand(['--list'])).toEqual({ kind: 'list', args: [] });
  });

  it('parses named gates with their options', () => {
    expect(parseGateCommand(['run', 'test-pairs', 'dead-classes', '--update'])).toEqual({
      kind: 'run',
      ids: ['test-pairs', 'dead-classes'],
      args: ['--update'],
    });
  });

  it('takes --concurrency for the turbo gates', () => {
    expect(parseGateCommand(['run', 'lint', '--concurrency=2'])).toEqual({
      kind: 'run',
      ids: ['lint'],
      args: [],
      concurrency: 2,
    });
    expect(() => parseGateCommand(['run', 'lint', '--concurrency=0'])).toThrow(/concurrency/u);
  });

  it('parses the merge and nightly lanes, --changed and --dry-run', () => {
    expect(parseGateCommand(['merge'])).toEqual({
      kind: 'lane',
      lane: 'merge',
      changed: false,
      args: [],
    });
    expect(parseGateCommand(['merge', '--changed', '--dry-run', '--concurrency=2'])).toEqual({
      kind: 'lane',
      lane: 'merge',
      changed: true,
      dryRun: true,
      args: [],
      concurrency: 2,
    });
    expect(parseGateCommand(['nightly'])).toEqual({
      kind: 'lane',
      lane: 'nightly',
      changed: false,
      args: [],
    });
    expect(() => parseGateCommand(['nightly', '--changed'])).toThrow(/--changed/u);
    expect(() => parseGateCommand(['merge', '--frobnicate'])).toThrow(/--frobnicate/u);
  });

  it('rejects an unknown gate id instead of running nothing', () => {
    expect(() => parseGateCommand(['run', 'no-such-gate'])).toThrow(/no-such-gate/u);
    expect(() => parseGateCommand(['run'])).toThrow(/gate id/u);
  });

  it('rejects an unknown subcommand', () => {
    expect(() => parseGateCommand(['frobnicate'])).toThrow(/frobnicate/u);
  });
});

describe('main', () => {
  const quiet = (): (() => void) => {
    const log = console.log;
    const error = console.error;
    console.log = (): void => {};
    console.error = (): void => {};
    return () => {
      console.log = log;
      console.error = error;
    };
  };

  it('exits 1 with usage on an unknown command, and 0 on help', async () => {
    const restore = quiet();
    try {
      expect(await main(['frobnicate'])).toBe(1);
      expect(await main(['help'])).toBe(0);
    } finally {
      restore();
    }
  });

  it('runs a named gate and exits with its outcome', async () => {
    const restore = quiet();
    try {
      expect(await main(['gate', 'run', 'tombstones'])).toBe(0);
    } finally {
      restore();
    }
  }, 30_000);

  it('describes the changed-lane plan for --dry-run without running anything', () => {
    const base = 'f'.repeat(40);
    const plan = describeLanePlan(gatesForLane(GATES, 'changed'), {
      root: REPO_ROOT,
      ci: false,
      selfTest: false,
      concurrency: 2,
      changed: { ref: 'origin/main', base, files: ['main/server/core/src/a.ts'] },
    }).join('\n');
    expect(plan).toContain(`merge base ${base} (origin/main), 1 changed file(s)`);
    expect(plan).toContain(
      `turbo run lint --only --output-logs=errors-only --continue --filter=...[${base}] --concurrency=2`,
    );
    expect(plan).toContain('prettier --config config/.prettierrc --check --ignore-unknown --');
    for (const gate of gatesForLane(GATES, 'changed')) expect(plan).toContain(gate.id);
  });

  it('lists every registered gate', async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string): void => {
      lines.push(line);
    };
    try {
      expect(await main(['gate', '--list'])).toBe(0);
    } finally {
      console.log = log;
    }
    for (const gate of GATES) expect(lines.join('\n')).toContain(gate.id);
  });

  it('dispatches bslt module new --dry-run and rejects invalid module invocations and removed bslt feature', async () => {
    const restore = quiet();
    try {
      expect(await main(['module', 'new', 'dryrunprobe', '--dry-run'])).toBe(0);
      expect(await main(['module', 'unknown'])).toBe(1);
      expect(await main(['module', 'new'])).toBe(1);
      expect(await main(['module', 'new', 'identity', '--dry-run'])).toBe(1);
      expect(await main(['feature', 'notes', '--dry-run'])).toBe(1);
    } finally {
      restore();
    }
  });
});
