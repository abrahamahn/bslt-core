// main/tools/gates/types.ts
/**
 * Shapes shared by the gate registry, its runner and every gate.
 */

/**
 * Where a gate runs.
 *
 * - `merge`: `bslt gate merge`, the CI merge gate.
 * - `changed`: `bslt gate merge --changed` (pre-push): the merge lane narrowed
 *   to what changed since the merge base with the upstream branch.
 * - `nightly`: `bslt gate nightly`, the heavy CI lane.
 * - `manual`: only by name (`bslt gate run <id>`), or by a CI job that names it.
 */
export type Lane = 'merge' | 'changed' | 'nightly' | 'manual';

export const LANES: readonly Lane[] = ['merge', 'changed', 'nightly', 'manual'];

/** Files changed since the merge base, for the `changed` lane. */
export interface ChangeSet {
  /** The ref the merge base was taken against (the upstream, or `origin/main`). */
  readonly ref: string;
  /** The merge-base commit. */
  readonly base: string;
  /** Repository-relative paths added, copied, modified or renamed since `base`. */
  readonly files: readonly string[];
}

export interface GateContext {
  /** Absolute repository root. */
  readonly root: string;
  /** True on a CI runner: no local caches, terse logs. */
  readonly ci: boolean;
  /** Set by `--changed`: gates narrow themselves to these files. */
  readonly changed?: ChangeSet | undefined;
  /**
   * Set by `bslt gate --self-test`: the gate must execute and return a result,
   * fast and without a database. In-process audits run for real; command gates
   * run their tool against a fixture or in its dry mode.
   */
  readonly selfTest: boolean;
  /** Turbo `--concurrency` for the turbo gates (CI sets `TURBO_CONCURRENCY` instead). */
  readonly concurrency?: number | undefined;
  /**
   * Extra flags from `bslt gate run <id> [flags]`, for the gates that take one
   * (`--update` records a ratchet's new ceiling; `--include-archive`, `--verbose`).
   */
  readonly args?: readonly string[] | undefined;
}

export interface CheckResult {
  readonly ok: boolean;
  /** One line: what was checked and the outcome. */
  readonly summary: string;
  /** One entry per problem, when the gate did not already print them. */
  readonly problems?: readonly string[];
}

export interface Gate {
  /** Kebab-case, unique. `bslt gate run <id>` runs it. */
  readonly id: string;
  readonly description: string;
  readonly lanes: readonly Lane[];
  /** Repository-relative file that implements the check. */
  readonly source: string;
  run(ctx: GateContext): Promise<CheckResult>;
  /** For gates that run an external tool: the command line `run` would execute (`--dry-run`). */
  command?(ctx: GateContext): string | undefined;
}

export function pass(summary: string): CheckResult {
  return { ok: true, summary };
}

export function fail(summary: string, problems: readonly string[] = []): CheckResult {
  return { ok: false, summary, problems };
}

/** True when `value` has the shape of a `CheckResult`. */
export function isCheckResult(value: unknown): value is CheckResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['ok'] === 'boolean' &&
    typeof candidate['summary'] === 'string' &&
    candidate['summary'] !== '' &&
    (candidate['problems'] === undefined || Array.isArray(candidate['problems']))
  );
}
