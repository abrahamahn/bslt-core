// main/tools/lib/merge-base.ts
/**
 * What changed on this branch: the merge base of HEAD with its upstream branch
 * (or `origin/main`), and the files changed since. `bslt gate merge --changed`
 * and the pre-push hook use it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { gitEnvironment } from '../scripts/git-environment';

import { REPO_ROOT } from './paths';

import type { ChangeSet } from '../gates/types';

/** Runs `git <args>` and returns trimmed stdout, or `undefined` when git fails. */
export type GitReader = (args: readonly string[]) => string | undefined;

export const DEFAULT_BASE_REF = 'origin/main';

/**
 * The merge base of HEAD with the upstream branch, falling back to
 * `origin/main` when there is no upstream or it shares no history with HEAD.
 *
 * @throws {Error} When neither ref yields a merge base (for example, `origin/main`
 *   was never fetched): the push is not checked against an unknown base.
 */
export function resolveMergeBase(git: GitReader): { readonly ref: string; readonly sha: string } {
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const candidates = [upstream, DEFAULT_BASE_REF].filter(
    (ref, index, all): ref is string =>
      ref !== undefined && ref !== '' && all.indexOf(ref) === index,
  );
  for (const ref of candidates) {
    const sha = git(['merge-base', 'HEAD', ref]);
    if (sha !== undefined && sha !== '') {
      return { ref, sha };
    }
  }
  throw new Error(
    `Cannot find a merge base with ${candidates.join(' or ')}. ` +
      `Run \`git fetch origin main\`, or push with PRE_PUSH_FULL=1 to check everything.`,
  );
}

/** Whether HEAD shares history with its upstream branch or `origin/main` (false in shallow single-branch clones). */
export function hasMergeBase(git: GitReader): boolean {
  try {
    resolveMergeBase(git);
    return true;
  } catch {
    return false;
  }
}

/** Files added, copied, modified or renamed between the merge base and HEAD. */
export function listChangedFiles(git: GitReader, mergeBase: string): string[] {
  const output = git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase, 'HEAD']);
  if (output === undefined) {
    throw new Error(`Cannot list the files changed since ${mergeBase}.`);
  }
  return output.split('\n').filter((file) => file !== '');
}

/** The change set for `--changed`: merge base, its ref, and the changed files that still exist. */
export function resolveChangeSet(git: GitReader, exists: (file: string) => boolean): ChangeSet {
  const { ref, sha } = resolveMergeBase(git);
  return { ref, base: sha, files: listChangedFiles(git, sha).filter((file) => exists(file)) };
}

/** A `GitReader` over the real repository. */
export function readGit(args: readonly string[]): string | undefined {
  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnvironment(),
    }).trim();
  } catch {
    return undefined;
  }
}

/** The change set of the real repository. */
export function changeSetOfRepository(): ChangeSet {
  return resolveChangeSet(readGit, (file) => existsSync(path.join(REPO_ROOT, file)));
}
