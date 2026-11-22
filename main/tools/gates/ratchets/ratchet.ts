// main/tools/gates/ratchets/ratchet.ts
/**
 * Ratchets: counts of a construct the restructure removes, which may only go
 * down (restructure plan, section 14.3).
 *
 * Every ratchet has one number in `budgets.json`. Its gate fails when the count
 * is over the budget (something new was added) and when it is under (the budget
 * must follow the count down, or the gap could be refilled unnoticed).
 * `pnpm bslt gate run <id> --update` writes a lower count; it never raises one.
 * `--verbose` lists every site.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { fail, type CheckResult, type GateContext } from '../types';

/** Repository-relative path of the one budgets file. */
export const BUDGETS_FILE = 'main/tools/gates/ratchets/budgets.json';

/** One counted occurrence. */
export interface Site {
  /** Repository-relative, forward slashes. */
  readonly file: string;
  readonly line: number;
  /** What was found there, short enough for one line. */
  readonly text: string;
}

export interface Ratchet {
  /** The gate id and the key in the budgets file. */
  readonly id: string;
  /** Plural, lower case: what one unit of the count is. */
  readonly noun: string;
  /** What to do instead of adding one. */
  readonly fix: string;
  count(root: string): readonly Site[];
}

export type Budgets = Readonly<Record<string, number>>;

/**
 * @throws {Error} When the file is not an object of whole numbers of zero or more.
 */
export function readBudgets(root: string): Budgets {
  const parsed: unknown = JSON.parse(readFileSync(path.join(root, BUDGETS_FILE), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${BUDGETS_FILE} must hold one object: ratchet id to budget`);
  }
  const budgets: Record<string, number> = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`${BUDGETS_FILE}: the budget of "${id}" must be a whole number, 0 or more`);
    }
    budgets[id] = value;
  }
  return budgets;
}

function writeBudgets(root: string, budgets: Budgets): void {
  const sorted = Object.fromEntries(
    Object.entries(budgets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  writeFileSync(path.join(root, BUDGETS_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
}

function describeSite(site: Site): string {
  return `${site.file}:${String(site.line)}: ${site.text}`;
}

function hasFlag(ctx: GateContext, flag: string): boolean {
  return ctx.args?.includes(flag) === true;
}

/** The sites to show for a count that rose: those in the changed files, or all of them. */
function suspects(sites: readonly Site[], changedFiles: readonly string[]): readonly Site[] {
  const changed = new Set(changedFiles);
  const inChanged = sites.filter((site) => changed.has(site.file));
  return inChanged.length > 0 ? inChanged : sites;
}

/**
 * @param changedFiles - The files changed on this branch, asked for when the
 *   count rose and the lane did not narrow the run (`ctx.changed`).
 */
export function runRatchet(
  ratchet: Ratchet,
  ctx: GateContext,
  changedFiles: () => readonly string[] = () => [],
): CheckResult {
  const budgets = readBudgets(ctx.root);
  const budget = budgets[ratchet.id];
  if (budget === undefined) return fail(`no budget for "${ratchet.id}" in ${BUDGETS_FILE}`);

  const sites = ratchet.count(ctx.root);
  const count = sites.length;

  if (count > budget) {
    return fail(
      `${ratchet.noun}: ${String(count)}, over the budget of ${String(budget)} ` +
        `(${String(count - budget)} new). ${ratchet.fix}`,
      suspects(sites, ctx.changed?.files ?? changedFiles()).map(describeSite),
    );
  }
  if (count < budget) {
    if (hasFlag(ctx, '--update')) {
      writeBudgets(ctx.root, { ...budgets, [ratchet.id]: count });
      return {
        ok: true,
        summary: `${ratchet.noun}: budget lowered from ${String(budget)} to ${String(count)}`,
      };
    }
    return fail(
      `${ratchet.noun}: ${String(count)}, under the budget of ${String(budget)}. ` +
        `Lower "${ratchet.id}" to ${String(count)} in ${BUDGETS_FILE} ` +
        `(pnpm bslt gate run ${ratchet.id} --update).`,
    );
  }
  return {
    ok: true,
    summary: `${String(count)} ${ratchet.noun}, the budget`,
    ...(hasFlag(ctx, '--verbose') ? { problems: sites.map(describeSite) } : {}),
  };
}
