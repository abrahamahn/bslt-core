// main/tools/gates/commands.ts
/**
 * Gates that run an external tool: turbo (lint, type-check, test, build over the
 * package graph) and Prettier.
 *
 * Turbo selects packages from the workspace graph. There is no package list
 * here: a new workspace package is linted, type-checked and tested because it
 * exists, not because someone added a `--filter` for it.
 */
import { spawnSync } from 'node:child_process';

import { gitEnvironment } from '../scripts/git-environment';

import { fail, pass, type ChangeSet, type CheckResult, type GateContext } from './types';

export type TurboTask = 'lint' | 'type-check' | 'test' | 'build';

const PRETTIER_CONFIG = ['--config', 'config/.prettierrc'] as const;
const PRETTIER_LOCAL_CACHE = [
  '--cache',
  '--cache-strategy',
  'content',
  '--cache-location',
  'node_modules/.cache/prettier/.cache',
] as const;

/** Turbo filters for the changed lane: changed packages and their dependents. */
export function turboFilters(changed: ChangeSet): string[] {
  return [`--filter=...[${changed.base}]`];
}

export function turboArgs(task: TurboTask, ctx: GateContext): string[] {
  const args = ['run', task];
  // The merge gate ran lint, type-check and test with --only: each package's own
  // task, without first running the tasks it depends on. A build needs its deps.
  if (task !== 'build') args.push('--only');
  if (ctx.selfTest) return [...args, '--dry=json'];
  const logs = task === 'lint' || task === 'build' || ctx.ci ? 'errors-only' : 'new-only';
  args.push(`--output-logs=${logs}`, '--continue');
  if (ctx.changed !== undefined) args.push(...turboFilters(ctx.changed));
  if (ctx.concurrency !== undefined) args.push(`--concurrency=${String(ctx.concurrency)}`);
  if (task === 'test') args.push('--', '--coverage.enabled=false');
  return args;
}

/** Prettier arguments, or `undefined` when the changed lane has no file to check. */
export function prettierArgs(ctx: GateContext): string[] | undefined {
  if (ctx.selfTest) return [...PRETTIER_CONFIG, '--check', 'package.json'];
  if (ctx.changed !== undefined) {
    if (ctx.changed.files.length === 0) return undefined;
    return [...PRETTIER_CONFIG, '--check', '--ignore-unknown', '--', ...ctx.changed.files];
  }
  return [...PRETTIER_CONFIG, ...(ctx.ci ? ['--no-cache'] : PRETTIER_LOCAL_CACHE), '--check', '.'];
}

interface Spawned {
  readonly status: number | null;
  readonly stdout: string;
  readonly error?: Error | undefined;
}

function spawnPnpmExec(ctx: GateContext, args: readonly string[], capture: boolean): Spawned {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync('pnpm', ['exec', ...args], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: gitEnvironment(),
    maxBuffer: 256 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  return { status: result.status, stdout: result.stdout ?? '', error: result.error };
}

/**
 * The task ids of a `turbo --dry=json` plan.
 *
 * The plan is read from the first line that opens an object. `pnpm exec`
 * prints its own warnings to stdout ahead of it: on a Node.js outside
 * `engines.node`, "WARN Unsupported engine", which has braces of its own
 * further along the line.
 */
export function plannedTasks(stdout: string): string[] {
  const start = stdout.search(/^\{/mu);
  const plan = JSON.parse(start === -1 ? stdout : stdout.slice(start)) as {
    tasks?: { taskId?: string }[];
  };
  return (plan.tasks ?? []).map((task) => task.taskId ?? '');
}

export function runTurbo(task: TurboTask, ctx: GateContext): CheckResult {
  const args = turboArgs(task, ctx);
  if (ctx.selfTest) {
    const result = spawnPnpmExec(ctx, ['turbo', ...args], true);
    if (result.status !== 0)
      return fail(`turbo ${task} --dry=json exited ${String(result.status)}`);
    const tasks = plannedTasks(result.stdout);
    return tasks.length > 0
      ? pass(`turbo plans ${String(tasks.length)} ${task} task(s)`)
      : fail(`turbo plans no ${task} task: the package graph is empty`);
  }
  const scope = ctx.changed === undefined ? 'every package' : 'changed packages and dependents';
  const result = spawnPnpmExec(ctx, ['turbo', ...args], false);
  if (result.error !== undefined) return fail(`cannot start turbo: ${result.error.message}`);
  return result.status === 0
    ? pass(`turbo ${task} passed in ${scope}`)
    : fail(`turbo ${task} failed in ${scope}`);
}

export function runPrettier(ctx: GateContext): CheckResult {
  const args = prettierArgs(ctx);
  if (args === undefined) return pass('no changed files to format-check');
  const result = spawnPnpmExec(ctx, ['prettier', ...args], false);
  if (result.error !== undefined) return fail(`cannot start prettier: ${result.error.message}`);
  const what = ctx.selfTest
    ? 'package.json'
    : ctx.changed === undefined
      ? 'the tree'
      : `${String(ctx.changed.files.length)} changed file(s)`;
  return result.status === 0
    ? pass(`Prettier formatting holds for ${what}`)
    : fail(`Prettier found unformatted files in ${what}; run \`pnpm format\``);
}

/** Runs `pnpm run <script>` (the build, with its postbuild hook). */
export function runRootScript(ctx: GateContext, script: string): CheckResult {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync('pnpm', ['run', script], {
    cwd: ctx.root,
    env: gitEnvironment(),
    stdio: 'inherit',
  });
  if (result.error !== undefined) return fail(`cannot start pnpm: ${result.error.message}`);
  return result.status === 0 ? pass(`pnpm ${script} passed`) : fail(`pnpm ${script} failed`);
}
