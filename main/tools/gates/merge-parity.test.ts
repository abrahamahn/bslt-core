// main/tools/gates/merge-parity.test.ts
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PATHS, repoPath } from '../lib/paths';
import { workspacePackages } from '../scripts/audit/gate-coverage';

import {
  MERGE_GATE_CHAIN_AT_PHASE_2_START,
  MERGE_GATE_FILTERED_PACKAGES,
  PARITY_CHANGES,
  checksOfCommand,
  expandScript,
  laneFromChain,
} from './merge-parity';
import { GATES } from './registry';
import { gatesForLane } from './runner';

const mergeLane = (): string[] => gatesForLane(GATES, 'merge').map((gate) => gate.id);

describe('expandScript', () => {
  it('follows pnpm script calls in order and forwards their extra arguments', () => {
    const scripts = {
      gate: 'pnpm -w run a && pnpm b --flag && tool c',
      a: 'tool a1 && pnpm run inner',
      inner: 'tool inner',
      b: 'tool b',
    };
    expect(expandScript(scripts, 'gate')).toEqual([
      'tool a1',
      'tool inner',
      'tool b --flag',
      'tool c',
    ]);
  });
});

describe('merge gate parity', () => {
  it('maps every command of the old chain to a check', () => {
    const checks = MERGE_GATE_CHAIN_AT_PHASE_2_START.flatMap((command) => checksOfCommand(command));
    // 31 commands, 30 checks: both tsc commands are the @bslt/tools type-check now.
    expect(checks).toHaveLength(31);
    expect(new Set(checks).size).toBe(30);
  });

  it('runs every check of ci:merge-gate at the start of Phase 2, except the recorded changes', () => {
    expect(mergeLane()).toEqual(laneFromChain(MERGE_GATE_CHAIN_AT_PHASE_2_START));
  });

  it('covers every package the old filter lists named, through the package graph', () => {
    // turbo runs a task in every workspace package that defines it; the old lists
    // named 16 packages and missed none, so the graph is a superset (minus packages
    // explicitly folded into vertical modules).
    const packages = workspacePackages(PATHS.root);
    const deleted = new Set<string>(PARITY_CHANGES.deletedPackages);
    for (const name of MERGE_GATE_FILTERED_PACKAGES) {
      if (!deleted.has(name)) expect(packages).toContain(name);
    }
    expect(packages).toContain('@bslt/identity');
    expect(packages).toContain('@bslt/tools');
    if (existsSync(repoPath('main/modules/files'))) {
      expect(packages).toContain('@bslt/files');
    }
  });

  it('folds the tools type-check and tests into @bslt/tools', () => {
    const pkg = JSON.parse(readFileSync(repoPath('main/tools/package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['type-check']).toBe('tsc -p tsconfig.json');
    expect(readFileSync(repoPath('main/tools/vitest.config.ts'), 'utf8')).toContain(
      "'main/tools/**/*.test.ts'",
    );
    expect(Object.values(PARITY_CHANGES.folded)).toEqual(['type-check', 'test']);
  });
});
