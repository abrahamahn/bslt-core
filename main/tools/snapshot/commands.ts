// main/tools/snapshot/commands.ts
/**
 * `bslt snapshot <id> [--check]`: write a committed oracle snapshot, or compare
 * it with what the code gives now.
 *
 * The builders load on demand: the API snapshot imports the server, the web
 * routes the TypeScript compiler. The database catalog is `bslt db catalog`
 * (../catalog/command.ts): it needs a database and attributes what it reads.
 */
import { REPO_ROOT } from '../lib/paths';

import {
  API_SNAPSHOT,
  WEB_ROUTES_SNAPSHOT,
  checkSnapshot,
  writeSnapshot,
  type SnapshotSpec,
} from './snapshot-file';

export interface SnapshotCommand {
  readonly spec: SnapshotSpec;
  /** What the command needs to run, for the usage text. */
  readonly needs: string;
  /** The current content of the snapshot file. */
  build(): Promise<string>;
}

export type SnapshotCommands = Readonly<Record<string, SnapshotCommand>>;

export const SNAPSHOT_COMMANDS: SnapshotCommands = {
  api: {
    spec: API_SNAPSHOT,
    needs: 'no database',
    build: async () => (await import('./api')).buildApiSnapshot(),
  },
  'web-routes': {
    spec: WEB_ROUTES_SNAPSHOT,
    needs: 'no database',
    build: async () => (await import('./web-routes')).buildWebRoutesSnapshot(),
  },
};

interface Output {
  log(message: string): void;
  error(message: string): void;
}

export interface SnapshotCommandOptions {
  readonly commands?: SnapshotCommands;
  readonly root?: string;
  readonly out?: Output;
}

function usage(commands: SnapshotCommands): string[] {
  return [
    'Usage: bslt snapshot <id> [--check]',
    '  Without --check the snapshot file is rewritten; commit it with the change that caused it.',
    '  With --check the file is compared and left alone.',
    '',
    ...Object.entries(commands).map(
      ([id, command]) => `  bslt snapshot ${id.padEnd(12)} ${command.spec.file} (${command.needs})`,
    ),
  ];
}

/**
 * Run `bslt snapshot`.
 *
 * @returns The process exit code.
 */
export async function snapshotCommand(
  argv: readonly string[],
  options: SnapshotCommandOptions = {},
): Promise<number> {
  const commands = options.commands ?? SNAPSHOT_COMMANDS;
  const root = options.root ?? REPO_ROOT;
  const out = options.out ?? console;

  const ids = argv.filter((arg) => !arg.startsWith('--'));
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const unknownFlags = flags.filter((flag) => flag !== '--check');
  const [id] = ids;
  const command = id === undefined ? undefined : commands[id];
  if (command === undefined || ids.length !== 1 || unknownFlags.length > 0) {
    if (unknownFlags.length > 0) {
      out.error(`bslt snapshot: unknown option(s) ${unknownFlags.join(' ')}`);
    } else if (id !== undefined && command === undefined) {
      out.error(`bslt snapshot: unknown snapshot "${id}"`);
    }
    for (const line of usage(commands)) out.error(line);
    return 1;
  }

  const current = await command.build();
  if (flags.includes('--check')) {
    const result = checkSnapshot(command.spec, current, root);
    if (result.ok) {
      out.log(result.summary);
      return 0;
    }
    out.error(result.summary);
    for (const problem of result.problems ?? []) out.error(problem);
    return 1;
  }

  out.log(
    writeSnapshot(command.spec, current, root)
      ? `wrote ${command.spec.file}. Commit it with the change that caused the difference.`
      : `${command.spec.file} is up to date.`,
  );
  return 0;
}
