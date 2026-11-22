// main/tools/scripts/dev/pre-push.ts
/**
 * Pre-push checks (`pnpm pre-push`, run by `infra/git-hooks/pre-push`).
 *
 * - Default: `bslt gate merge --changed`: the merge lane narrowed to what
 *   changed since the merge base of HEAD with its upstream branch (or
 *   `origin/main`). Turbo gates run on the changed packages and their
 *   dependents, Prettier on the changed files, the repository audits in full.
 * - `PRE_PUSH_FAST=1`: headers, test pairs and lint only.
 * - `PRE_PUSH_FULL=1`: the nightly lane (the full merge gate plus the build).
 *
 * Turbo runs with `--concurrency=2` to stay within local memory.
 */

export type PrePushMode = 'changed' | 'fast' | 'full';

export function resolveMode(env: NodeJS.ProcessEnv): PrePushMode {
  if (env['PRE_PUSH_FAST'] === '1') return 'fast';
  if (env['PRE_PUSH_FULL'] === '1') return 'full';
  return 'changed';
}

export interface PrePushOptions {
  /** Whether a merge base with upstream or `origin/main` is reachable (default: true). */
  readonly hasMergeBase?: boolean;
}

/** The `bslt` arguments each mode runs. */
export function prePushArgs(mode: PrePushMode, options?: PrePushOptions): string[] {
  switch (mode) {
    case 'fast':
      return ['gate', 'run', 'headers', 'test-pairs', 'lint', '--concurrency=2'];
    case 'full':
      return ['gate', 'nightly', '--concurrency=2'];
    case 'changed':
      return options?.hasMergeBase === false
        ? ['gate', 'merge', '--concurrency=2']
        : ['gate', 'merge', '--changed', '--concurrency=2'];
  }
}
