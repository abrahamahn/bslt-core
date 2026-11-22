// main/tools/gates/runner.ts
/**
 * Runs gates: a lane (`bslt gate merge`), named gates (`bslt gate run`), or the
 * self-test (`bslt gate --self-test`).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../lib/paths';

import {
  LANES,
  fail,
  isCheckResult,
  type CheckResult,
  type Gate,
  type GateContext,
  type Lane,
} from './types';

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

const CONSOLE: Output = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

export interface GateOutcome {
  readonly id: string;
  readonly result: CheckResult;
  readonly ms: number;
}

export interface RunReport {
  readonly ok: boolean;
  readonly results: readonly GateOutcome[];
}

export interface SelfTestReport extends RunReport {
  /** Registry defects found before any gate ran. */
  readonly registryProblems: readonly string[];
  /** Gates that threw or returned something that is not a `CheckResult`. */
  readonly broken: readonly string[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function gatesForLane(gates: readonly Gate[], lane: Lane): Gate[] {
  return gates.filter((gate) => gate.lanes.includes(lane));
}

/** Structural defects in a registry: duplicate or malformed ids, no lane, a missing source. */
export function validateRegistry(gates: readonly Gate[], root: string = REPO_ROOT): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const gate of gates) {
    if (seen.has(gate.id)) problems.push(`duplicate gate id "${gate.id}"`);
    seen.add(gate.id);
    if (!ID_PATTERN.test(gate.id)) problems.push(`gate id "${gate.id}" is not kebab-case`);
    if (gate.lanes.length === 0 || gate.lanes.some((lane) => !LANES.includes(lane))) {
      problems.push(`gate "${gate.id}" has no lane or an unknown lane`);
    }
    if (!existsSync(path.join(root, gate.source))) {
      problems.push(`gate "${gate.id}" names a source that does not exist: ${gate.source}`);
    }
  }
  return problems;
}

async function execute(gate: Gate, ctx: GateContext): Promise<{ value: unknown; ms: number }> {
  const started = performance.now();
  try {
    const value: unknown = await gate.run(ctx);
    return { value, ms: performance.now() - started };
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return { value: new GateThrew(message), ms: performance.now() - started };
  }
}

class GateThrew {
  constructor(readonly message: string) {}
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function report(out: Output, outcome: GateOutcome): void {
  const mark = outcome.result.ok ? 'ok  ' : 'FAIL';
  const line = `${mark} ${outcome.id} (${seconds(outcome.ms)}): ${outcome.result.summary}`;
  if (outcome.result.ok) out.log(line);
  else out.error(line);
  for (const problem of outcome.result.problems ?? []) out.error(`       ${problem}`);
}

function summarize(out: Output, outcomes: readonly GateOutcome[], label: string): void {
  const failed = outcomes.filter((outcome) => !outcome.result.ok).map((outcome) => outcome.id);
  out.log('');
  if (failed.length === 0) {
    out.log(`${label}: ${String(outcomes.length)} gate(s) passed.`);
  } else {
    out.error(
      `${label}: ${String(failed.length)} of ${String(outcomes.length)} gate(s) failed: ${failed.join(', ')}`,
    );
  }
}

/**
 * Runs the gates in order. A failing or throwing gate does not stop the run, so
 * one run reports every failure; the run fails if any gate failed, or if it was
 * given no gates at all (a lane that runs nothing checks nothing).
 */
export async function runGates(
  gates: readonly Gate[],
  ctx: GateContext,
  out: Output = CONSOLE,
  label = 'bslt gate',
): Promise<RunReport> {
  const results: GateOutcome[] = [];
  for (const gate of gates) {
    out.log(`\n▶ ${gate.id}: ${gate.description}`);
    const { value, ms } = await execute(gate, ctx);
    const result: CheckResult =
      value instanceof GateThrew
        ? fail(`threw: ${value.message.split('\n')[0] ?? ''}`, value.message.split('\n').slice(1))
        : isCheckResult(value)
          ? value
          : fail('returned something that is not a check result');
    const outcome = { id: gate.id, result, ms };
    results.push(outcome);
    report(out, outcome);
  }
  if (gates.length === 0) out.error(`${label}: no gates selected.`);
  else summarize(out, results, label);
  return { ok: gates.length > 0 && results.every((outcome) => outcome.result.ok), results };
}

/**
 * `bslt gate --self-test`: every registered gate executes (in self-test mode)
 * and returns a check result. A gate whose check fails still passes the
 * self-test; one that throws or returns no result does not.
 */
export async function selfTest(
  gates: readonly Gate[],
  ctx: GateContext,
  out: Output = CONSOLE,
): Promise<SelfTestReport> {
  const registryProblems = validateRegistry(gates, ctx.root);
  if (registryProblems.length > 0) {
    for (const problem of registryProblems) out.error(`registry: ${problem}`);
    return { ok: false, results: [], registryProblems, broken: [] };
  }
  const results: GateOutcome[] = [];
  const broken: string[] = [];
  const selfTestCtx: GateContext = { ...ctx, selfTest: true, changed: undefined };
  for (const gate of gates) {
    const { value, ms } = await execute(gate, selfTestCtx);
    if (value instanceof GateThrew || !isCheckResult(value)) {
      broken.push(gate.id);
      const why =
        value instanceof GateThrew ? `threw: ${value.message}` : 'returned no check result';
      out.error(`BROKEN ${gate.id} (${seconds(ms)}): ${why}`);
      results.push({ id: gate.id, result: fail(why), ms });
      continue;
    }
    results.push({ id: gate.id, result: value, ms });
    out.log(
      `ran  ${gate.id} (${seconds(ms)}) [${gate.lanes.join(', ')}]: ` +
        `${value.ok ? 'passes' : 'FAILS'}: ${value.summary}`,
    );
  }
  out.log('');
  if (broken.length === 0) {
    out.log(
      `Self-test passed: all ${String(gates.length)} registered gates executed and returned a result.`,
    );
  } else {
    out.error(`Self-test failed: ${broken.join(', ')} did not return a result.`);
  }
  return { ok: broken.length === 0, results, registryProblems, broken };
}
