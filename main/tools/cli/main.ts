// main/tools/cli/main.ts
/**
 * Command dispatcher for the `bslt` CLI (`main/tools/bin/bslt.ts`).
 *
 * Every repository script runs through here, either as a registered gate
 * (`bslt gate ...`) or as a subcommand that calls the script's exported entry.
 */
import { GATES, REPORTS, findGate, findReport } from '../gates/registry';
import { gatesForLane, runGates, selfTest } from '../gates/runner';
import { changeSetOfRepository, hasMergeBase, readGit } from '../lib/merge-base';
import { REPO_ROOT } from '../lib/paths';
import { snapshotCommand } from '../snapshot/commands';
import { syncTheme } from '../sync/sync-css-theme';
import { syncHeaders } from '../sync/sync-file-headers';
import { syncTsReferences } from '../sync/sync-ts-references';

import { DB_COMMANDS, KEEP_RUNNING, SCRIPT_COMMANDS } from './scripts';

import type { Gate, GateContext } from '../gates/types';

const GATE_USAGE = `Gates:
  bslt gate merge [--changed] [--dry-run] [--concurrency=<n>]
                                    The merge lane (CI); --changed narrows it to the changes since
                                    the merge base with the upstream branch (pre-push)
  bslt gate nightly                 The merge lane plus the build
  bslt gate --self-test             Run every registered gate once, fast, and check it returns a result
  bslt gate --list                  List the registered gates and their lanes
  bslt gate run <id...> [flags]     Run named gates (flags: --update, --include-archive, --verbose)
                                    Turbo gates take --concurrency=<n>`;

export const USAGE = [
  'Usage: bslt <command> [options]',
  '',
  GATE_USAGE,
  '',
  'Other commands:',
  '  bslt pre-push [--dry-run]         The pre-push hook (PRE_PUSH_FAST=1, PRE_PUSH_FULL=1 select a mode)',
  '  bslt sync headers [--check|--staged|--watch] [--quiet]',
  '  bslt sync ts [--check]',
  '  bslt sync theme [--watch] [--quiet]',
  '  bslt sync icons [--check]         Owned SVG icon union and definitions from main/kernel/ui/icons/*.svg',
  '  bslt sync stories [--check]       Generated story index covering every @bslt/ui component export',
  '  bslt sync rows [--check]          Row types, column maps and the RLS structure test, generated',
  '                                    from the database catalog',
  '  bslt sync modules [--check]       Server/web install lists, package deps, tsconfig refs, module',
  '                                    graph and README blocks from bslt.config.ts',
  '  bslt sync openapi [--check]       docs/reference/openapi.json from the contracts and the composed',
  '                                    server',
  '  bslt sync csp [--check]           Caddy security headers + server CSP/Permissions-Policy constants',
  '                                    from bslt.config.ts and module csp manifests',
  '  bslt sync docs [--check]          Reference docs (docs/reference/*.md) and DIRECTION.md status block',
  '  bslt sync permissions [--check]   Append-only org permission bit allocation in bslt.lock.json',
  '  bslt create <dir> [options]       Scaffold a new personalized project directory (create-bslt)',
  '  bslt init [options]               One-click developer quickstart wizard (pnpm quickstart)',
  '  bslt module <subcommand>          list, add <id...>, remove <id...>, release [--out <dir>],',
  '                                    new <id> [--dry-run]',
  '  bslt web prerender [--quiet]      Prerender cacheSeconds=Infinity PublicRoute pages from dist/server/serve.js',
  '  bslt report <id> [args]           Run a report (bslt report --list)',
  '  bslt snapshot <id> [--check]      Rewrite or check an oracle snapshot: api, web-routes',
  '  bslt db <subcommand>              migrate, seed, reset, bootstrap, bootstrap-admin,',
  '                                    bootstrap-roles, backfill-totp, catalog (needs a database),',
  '                                    audit',
  ...Object.entries(SCRIPT_COMMANDS).map(
    ([name, { usage }]) => `  bslt ${name.padEnd(28)} ${usage}`,
  ),
].join('\n');

export type GateCommand =
  | {
      readonly kind: 'lane';
      readonly lane: 'merge' | 'nightly';
      /** Narrow to the changes since the merge base (merge lane only). */
      readonly changed: boolean;
      /** Print the plan instead of running it. */
      readonly dryRun?: true;
      readonly args: readonly string[];
      readonly concurrency?: number;
    }
  | { readonly kind: 'self-test'; readonly args: readonly string[] }
  | { readonly kind: 'list'; readonly args: readonly string[] }
  | {
      readonly kind: 'run';
      readonly ids: readonly string[];
      readonly args: readonly string[];
      readonly concurrency?: number;
    };

function splitConcurrency(argv: readonly string[]): {
  rest: string[];
  concurrency: number | undefined;
} {
  let concurrency: number | undefined;
  const rest: string[] = [];
  for (const arg of argv) {
    const match = /^--concurrency=(.*)$/u.exec(arg);
    if (match === null) {
      rest.push(arg);
      continue;
    }
    const value = Number(match[1]);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`--concurrency needs a positive integer, got "${match[1] ?? ''}"`);
    }
    concurrency = value;
  }
  return { rest, concurrency };
}

export function parseGateCommand(argv: readonly string[]): GateCommand {
  const { rest, concurrency } = splitConcurrency(argv);
  const [sub, ...tail] = rest;
  const withConcurrency = concurrency === undefined ? {} : { concurrency };
  if (sub === 'merge' || sub === 'nightly') {
    const unknown = tail.filter((arg) => arg !== '--changed' && arg !== '--dry-run');
    if (unknown.length > 0)
      throw new Error(`bslt gate ${sub}: unknown option(s) ${unknown.join(' ')}`);
    const changed = tail.includes('--changed');
    if (changed && sub !== 'merge') throw new Error('--changed narrows the merge lane only');
    return {
      kind: 'lane',
      lane: sub,
      changed,
      ...(tail.includes('--dry-run') ? { dryRun: true as const } : {}),
      args: [],
      ...withConcurrency,
    };
  }
  if (sub === '--self-test') return { kind: 'self-test', args: tail };
  if (sub === '--list') return { kind: 'list', args: tail };
  if (sub === 'run') {
    const ids = tail.filter((arg) => !arg.startsWith('--'));
    const args = tail.filter((arg) => arg.startsWith('--'));
    if (ids.length === 0) throw new Error('bslt gate run needs at least one gate id');
    const unknown = ids.filter((id) => findGate(id) === undefined);
    if (unknown.length > 0) {
      throw new Error(`unknown gate id(s): ${unknown.join(', ')} (see bslt gate --list)`);
    }
    return { kind: 'run', ids, args, ...withConcurrency };
  }
  throw new Error(`unknown gate subcommand "${sub ?? ''}"`);
}

function baseContext(): GateContext {
  return {
    root: REPO_ROOT,
    ci: process.env['CI'] !== undefined && process.env['CI'] !== '',
    selfTest: false,
  };
}

/** The `--dry-run` plan: the change set, then each gate and the command it would run. */
export function describeLanePlan(gates: readonly Gate[], ctx: GateContext): string[] {
  const lines: string[] = [];
  if (ctx.changed !== undefined) {
    lines.push(
      `merge base ${ctx.changed.base} (${ctx.changed.ref}), ${String(ctx.changed.files.length)} changed file(s)`,
    );
  }
  for (const gate of gates) {
    const command = gate.command?.(ctx);
    lines.push(
      `${gate.id.padEnd(24)} ${command === undefined ? `in-process: ${gate.description}` : command}`,
    );
  }
  return lines;
}

async function gateCommand(argv: readonly string[]): Promise<number> {
  const command = parseGateCommand(argv);
  if (command.kind === 'list') {
    for (const gate of GATES) {
      console.log(`${gate.id.padEnd(26)} ${gate.lanes.join(',').padEnd(22)} ${gate.description}`);
    }
    return 0;
  }
  if (command.kind === 'self-test') {
    return (await selfTest(GATES, baseContext())).ok ? 0 : 1;
  }
  if (command.kind === 'lane') {
    const lane = command.changed ? 'changed' : command.lane;
    const ctx: GateContext = {
      ...baseContext(),
      ...(command.changed ? { changed: changeSetOfRepository() } : {}),
      ...(command.concurrency === undefined ? {} : { concurrency: command.concurrency }),
    };
    const gates = gatesForLane(GATES, lane);
    if (command.dryRun === true) {
      for (const line of describeLanePlan(gates, ctx)) console.log(line);
      return 0;
    }
    if (ctx.changed !== undefined) {
      console.log(
        `Checking changes since ${ctx.changed.ref} at ${ctx.changed.base.slice(0, 12)}: ` +
          `${String(ctx.changed.files.length)} file(s).`,
      );
    }
    return (await runGates(gates, ctx, undefined, `bslt gate ${command.lane}`)).ok ? 0 : 1;
  }
  const gates = command.ids.map((id) => findGate(id)).filter((gate) => gate !== undefined);
  const ctx: GateContext = {
    ...baseContext(),
    args: command.args,
    ...(command.concurrency === undefined ? {} : { concurrency: command.concurrency }),
  };
  return (await runGates(gates, ctx)).ok ? 0 : 1;
}

async function reportCommand(argv: readonly string[]): Promise<number> {
  const [id, ...args] = argv;
  if (id === undefined || id === '--list') {
    for (const report of REPORTS) console.log(`${report.id.padEnd(26)} ${report.description}`);
    return id === undefined ? 1 : 0;
  }
  const report = findReport(id);
  if (report === undefined) {
    console.error(`bslt report: unknown report "${id}" (see bslt report --list)`);
    return 1;
  }
  return report.run(args);
}

async function syncCommand(argv: readonly string[]): Promise<number> {
  const [what, ...flags] = argv;
  const has = (flag: string): boolean => flags.includes(flag);
  switch (what) {
    case 'headers': {
      const watching = has('--watch');
      const result = syncHeaders({
        check: has('--check'),
        staged: has('--staged'),
        watch: has('--watch'),
        quiet: has('--quiet'),
      });
      if (watching) return KEEP_RUNNING;
      return result.ok ? 0 : 1;
    }
    case 'ts':
      return syncTsReferences({ check: has('--check') }).ok ? 0 : 1;
    case 'theme':
      await syncTheme({ watch: has('--watch'), quiet: has('--quiet') });
      return has('--watch') ? KEEP_RUNNING : 0;
    case 'icons': {
      const { run, syncIcons, GENERATED_ICONS_FILE, SYNC_ICONS_COMMAND } =
        await import('../sync/icons');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        return result.ok ? 0 : 1;
      }
      const { changed, count } = await syncIcons();
      console.log(
        changed
          ? `${SYNC_ICONS_COMMAND}: wrote ${GENERATED_ICONS_FILE} (${String(count)} icons).`
          : `${SYNC_ICONS_COMMAND}: ${String(count)} icons are up to date.`,
      );
      return 0;
    }
    case 'stories': {
      const { run, syncStories, GENERATED_STORIES_FILE, SYNC_STORIES_COMMAND } =
        await import('../sync/stories');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        return result.ok ? 0 : 1;
      }
      const { changed, count } = await syncStories();
      console.log(
        changed
          ? `${SYNC_STORIES_COMMAND}: wrote ${GENERATED_STORIES_FILE} (${String(count)} stories).`
          : `${SYNC_STORIES_COMMAND}: ${String(count)} stories are up to date.`,
      );
      return 0;
    }
    case 'rows': {
      // Loaded on demand: it loads Prettier.
      const { run, syncRows, SYNC_ROWS_COMMAND } = await import('../sync/rows');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        for (const problem of result.problems ?? []) console.error(`  - ${problem}`);
        return result.ok ? 0 : 1;
      }
      const { stale, orphans, total } = await syncRows();
      for (const file of stale) console.log(`wrote ${file}`);
      for (const file of orphans) console.log(`deleted ${file}`);
      console.log(
        stale.length + orphans.length === 0
          ? `${SYNC_ROWS_COMMAND}: ${String(total)} files are up to date.`
          : `${SYNC_ROWS_COMMAND}: ${String(total)} files; commit the changes.`,
      );
      return 0;
    }
    case 'modules': {
      const { run, syncModules, SYNC_MODULES_COMMAND } = await import('../sync/modules');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        for (const problem of result.problems ?? []) console.error(`  - ${problem}`);
        return result.ok ? 0 : 1;
      }
      const { stale, orphans, total } = await syncModules();
      for (const file of stale) console.log(`wrote ${file}`);
      for (const file of orphans) console.log(`deleted ${file}`);
      console.log(
        stale.length + orphans.length === 0
          ? `${SYNC_MODULES_COMMAND}: ${String(total)} files are up to date.`
          : `${SYNC_MODULES_COMMAND}: ${String(total)} files; commit the changes.`,
      );
      return 0;
    }
    case 'openapi': {
      const { run, syncOpenApi, OPENAPI_DOCUMENT } = await import('../sync/openapi');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        for (const problem of result.problems ?? []) console.error(`  ${problem}`);
        return result.ok ? 0 : 1;
      }
      console.log(
        (await syncOpenApi())
          ? `wrote ${OPENAPI_DOCUMENT.file}; commit it with the change that caused the difference.`
          : `${OPENAPI_DOCUMENT.file} is up to date.`,
      );
      return 0;
    }
    case 'csp': {
      const { run, syncCsp, SYNC_CSP_COMMAND } = await import('../sync/csp');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        for (const problem of result.problems ?? []) console.error(`  - ${problem}`);
        return result.ok ? 0 : 1;
      }
      const { changed, stale } = await syncCsp();
      for (const file of stale) console.log(`wrote ${file}`);
      console.log(
        changed
          ? `${SYNC_CSP_COMMAND}: updated ${String(stale.length)} file(s); commit the changes.`
          : `${SYNC_CSP_COMMAND}: security headers are up to date.`,
      );
      return 0;
    }
    case 'docs': {
      const { run, syncDocs, SYNC_DOCS_COMMAND } = await import('../sync/docs');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        for (const problem of result.problems ?? []) console.error(`  - ${problem}`);
        return result.ok ? 0 : 1;
      }
      const { changed, written } = await syncDocs();
      for (const file of written) console.log(`wrote ${file}`);
      console.log(
        changed
          ? `${SYNC_DOCS_COMMAND}: updated ${String(written.length)} file(s); commit the changes.`
          : `${SYNC_DOCS_COMMAND}: reference docs are up to date.`,
      );
      return 0;
    }
    case 'permissions': {
      const { run, syncPermissions, PERMISSION_LOCKFILE, SYNC_PERMISSIONS_COMMAND } =
        await import('../sync/permissions');
      if (has('--check')) {
        const result = await run();
        (result.ok ? console.log : console.error)(result.summary);
        for (const problem of result.problems ?? []) console.error(`  - ${problem}`);
        return result.ok ? 0 : 1;
      }
      const { changed } = await syncPermissions();
      console.log(
        changed
          ? `wrote ${PERMISSION_LOCKFILE}; commit it with the change that caused the difference.`
          : `${SYNC_PERMISSIONS_COMMAND}: ${PERMISSION_LOCKFILE} is up to date.`,
      );
      return 0;
    }
    default:
      console.error(
        `bslt sync: unknown target "${what ?? ''}" (headers, ts, theme, icons, stories, rows, modules, openapi, csp, docs, permissions)`,
      );
      return 1;
  }
}

async function dbCommand(argv: readonly string[]): Promise<number> {
  const [sub, ...rest] = argv;
  const command = sub === undefined ? undefined : DB_COMMANDS[sub];
  if (command === undefined) {
    console.error(`bslt db: unknown subcommand "${sub ?? ''}"\n`);
    for (const [name, { usage }] of Object.entries(DB_COMMANDS)) {
      console.error(`  bslt db ${name.padEnd(16)} ${usage}`);
    }
    return 1;
  }
  return command.run(rest);
}

async function prePushCommand(argv: readonly string[]): Promise<number> {
  const { prePushArgs, resolveMode } = await import('../scripts/dev/pre-push');
  const mode = resolveMode(process.env);
  const baseAvailable = mode !== 'changed' || hasMergeBase(readGit);
  if (!baseAvailable) {
    console.log(
      'Pre-push checks (changed mode: no merge base in shallow/single-branch clone; running full merge lane)',
    );
  } else {
    console.log(`Pre-push checks (${mode} mode)`);
  }
  const args = prePushArgs(mode, { hasMergeBase: baseAvailable });
  return main(argv.includes('--dry-run') && args[1] !== 'run' ? [...args, '--dry-run'] : args);
}

const COMMANDS: Readonly<Record<string, (argv: readonly string[]) => Promise<number>>> = {
  ...Object.fromEntries(Object.entries(SCRIPT_COMMANDS).map(([name, { run }]) => [name, run])),
  db: dbCommand,
  create: async (argv) => (await import('../module/create-bslt')).runCreateBsltCli(argv),
  init: async (argv) => (await import('../module/init')).runQuickstartCli(argv),
  module: async (argv) => (await import('../module/manage')).runModuleCli(argv),
  web: async (argv) => (await import('../web/prerender')).runWebCli(argv),
  'pre-push': prePushCommand,
  gate: gateCommand,
  report: reportCommand,
  snapshot: (argv) => snapshotCommand(argv),
  sync: syncCommand,
};

/** The top-level `bslt` commands. */
export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS);

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }
  const handler = COMMANDS[command];
  if (handler === undefined) {
    console.error(`bslt: unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  try {
    return await handler(rest);
  } catch (error) {
    console.error(`bslt ${command}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
