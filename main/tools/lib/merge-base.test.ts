// main/tools/lib/merge-base.test.ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BASE_REF,
  hasMergeBase,
  listChangedFiles,
  resolveChangeSet,
  resolveMergeBase,
  type GitReader,
} from './merge-base';

const BASE = '0123456789abcdef0123456789abcdef01234567';

/** A git double answering from a table keyed by the joined arguments. */
function fakeGit(answers: Readonly<Record<string, string>>): GitReader & { calls: string[] } {
  const calls: string[] = [];
  const reader = (args: readonly string[]): string | undefined => {
    const key = args.join(' ');
    calls.push(key);
    return answers[key];
  };
  return Object.assign(reader, { calls });
}

const UPSTREAM = 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}';

describe('resolveMergeBase', () => {
  it('uses the merge base with the upstream branch', () => {
    const git = fakeGit({
      [UPSTREAM]: 'origin/feature/x',
      'merge-base HEAD origin/feature/x': BASE,
    });
    expect(resolveMergeBase(git)).toEqual({ ref: 'origin/feature/x', sha: BASE });
    expect(git.calls).not.toContain(`merge-base HEAD ${DEFAULT_BASE_REF}`);
  });

  it('falls back to origin/main when the branch has no upstream', () => {
    const git = fakeGit({ 'merge-base HEAD origin/main': BASE });
    expect(resolveMergeBase(git)).toEqual({ ref: 'origin/main', sha: BASE });
  });

  it('falls back to origin/main when the upstream shares no history with HEAD', () => {
    const git = fakeGit({ [UPSTREAM]: 'fork/rewritten', 'merge-base HEAD origin/main': BASE });
    expect(resolveMergeBase(git)).toEqual({ ref: 'origin/main', sha: BASE });
    expect(git.calls).toEqual([
      UPSTREAM,
      'merge-base HEAD fork/rewritten',
      'merge-base HEAD origin/main',
    ]);
  });

  it('asks origin/main once when it is also the upstream', () => {
    const git = fakeGit({ [UPSTREAM]: 'origin/main' });
    expect(() => resolveMergeBase(git)).toThrow(/merge base with origin\/main\./u);
    expect(git.calls.filter((call) => call.startsWith('merge-base'))).toEqual([
      'merge-base HEAD origin/main',
    ]);
  });

  it('refuses to guess when no merge base exists', () => {
    expect(() => resolveMergeBase(fakeGit({ [UPSTREAM]: 'origin/x' }))).toThrow(
      /origin\/x or origin\/main.*PRE_PUSH_FULL=1/u,
    );
  });

  it('reports whether a merge base is available without throwing on shallow clones', () => {
    expect(hasMergeBase(fakeGit({ 'merge-base HEAD origin/main': BASE }))).toBe(true);
    expect(hasMergeBase(fakeGit({}))).toBe(false);
    expect(hasMergeBase(fakeGit({ [UPSTREAM]: 'origin/x' }))).toBe(false);
  });
});

describe('listChangedFiles', () => {
  it('lists files added, copied, modified or renamed since the merge base', () => {
    const git = fakeGit({
      [`diff --name-only --diff-filter=ACMR ${BASE} HEAD`]: 'a.ts\nmain/tools/x.ts\n',
    });
    expect(listChangedFiles(git, BASE)).toEqual(['a.ts', 'main/tools/x.ts']);
  });

  it('is empty when nothing changed, and throws when git fails', () => {
    const git = fakeGit({ [`diff --name-only --diff-filter=ACMR ${BASE} HEAD`]: '' });
    expect(listChangedFiles(git, BASE)).toEqual([]);
    expect(() => listChangedFiles(fakeGit({}), BASE)).toThrow(/since/u);
  });
});

describe('resolveChangeSet', () => {
  it('carries the ref and merge base, and drops files deleted from the working tree', () => {
    const git = fakeGit({
      [UPSTREAM]: 'origin/feature/x',
      'merge-base HEAD origin/feature/x': BASE,
      [`diff --name-only --diff-filter=ACMR ${BASE} HEAD`]: 'kept.ts\ngone.ts\n',
    });
    expect(resolveChangeSet(git, (file) => file !== 'gone.ts')).toEqual({
      ref: 'origin/feature/x',
      base: BASE,
      files: ['kept.ts'],
    });
  });

  it('refuses to guess when there is no merge base', () => {
    expect(() => resolveChangeSet(fakeGit({}), () => true)).toThrow(/merge base/u);
  });
});
