// main/tools/scripts/dev/pre-push.test.ts
import { describe, expect, it } from 'vitest';

import { parseGateCommand } from '../../cli/main';
import { GATES } from '../../gates/registry';
import { gatesForLane } from '../../gates/runner';

import { prePushArgs, resolveMode } from './pre-push';

describe('resolveMode', () => {
  it('defaults to the changed-files mode', () => {
    expect(resolveMode({})).toBe('changed');
    expect(resolveMode({ PRE_PUSH_FAST: '0', PRE_PUSH_FULL: '' })).toBe('changed');
  });

  it('keeps PRE_PUSH_FAST=1 and PRE_PUSH_FULL=1, with fast taking precedence', () => {
    expect(resolveMode({ PRE_PUSH_FAST: '1' })).toBe('fast');
    expect(resolveMode({ PRE_PUSH_FULL: '1' })).toBe('full');
    expect(resolveMode({ PRE_PUSH_FAST: '1', PRE_PUSH_FULL: '1' })).toBe('fast');
  });
});

describe('prePushArgs', () => {
  it('runs the merge lane narrowed to the changes since the merge base by default', () => {
    expect(prePushArgs('changed')).toEqual(['gate', 'merge', '--changed', '--concurrency=2']);
    expect(parseGateCommand(prePushArgs('changed').slice(1))).toEqual({
      kind: 'lane',
      lane: 'merge',
      changed: true,
      args: [],
      concurrency: 2,
    });
  });

  it('checks in the changed mode everything the merge gate checks, with no fixed package list', () => {
    // The old default (ci:fast) skipped @bslt/core and seven other packages.
    expect(gatesForLane(GATES, 'changed').map((gate) => gate.id)).toEqual(
      gatesForLane(GATES, 'merge').map((gate) => gate.id),
    );
  });

  it('falls back to the un-narrowed merge lane when a shallow clone has no merge base', () => {
    expect(prePushArgs('changed', { hasMergeBase: false })).toEqual([
      'gate',
      'merge',
      '--concurrency=2',
    ]);
    expect(parseGateCommand(prePushArgs('changed', { hasMergeBase: false }).slice(1))).toEqual({
      kind: 'lane',
      lane: 'merge',
      changed: false,
      args: [],
      concurrency: 2,
    });
  });

  it('keeps PRE_PUSH_FAST as headers and lint, and PRE_PUSH_FULL as the full gate plus build', () => {
    expect(prePushArgs('fast')).toEqual([
      'gate',
      'run',
      'headers',
      'test-pairs',
      'lint',
      '--concurrency=2',
    ]);
    expect(prePushArgs('full')).toEqual(['gate', 'nightly', '--concurrency=2']);
    for (const mode of ['fast', 'full'] as const) {
      expect(() => parseGateCommand(prePushArgs(mode).slice(1))).not.toThrow();
    }
  });
});
