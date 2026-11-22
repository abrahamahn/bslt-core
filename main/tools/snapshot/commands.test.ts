// main/tools/snapshot/commands.test.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SNAPSHOT_COMMANDS, snapshotCommand, type SnapshotCommands } from './commands';
import { serializeSnapshot, type SnapshotSpec } from './snapshot-file';

const SPEC: SnapshotSpec = {
  id: 'thing',
  file: 'snapshots/thing.json',
  title: 'The thing',
  sources: 'a test',
};

const roots: string[] = [];

function setup(content: () => Record<string, unknown>): {
  root: string;
  lines: string[];
  run: (argv: readonly string[]) => Promise<number>;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-snapshot-command-'));
  roots.push(root);
  const lines: string[] = [];
  const commands: SnapshotCommands = {
    thing: {
      spec: SPEC,
      needs: 'nothing',
      build: () => Promise.resolve(serializeSnapshot(SPEC, content())),
    },
  };
  const out = {
    log: (message: string) => lines.push(message),
    error: (message: string) => lines.push(message),
  };
  return { root, lines, run: (argv) => snapshotCommand(argv, { commands, root, out }) };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('bslt snapshot', () => {
  it('writes the snapshot file, and says so only when it changed', async () => {
    let value = 1;
    const { root, lines, run } = setup(() => ({ value }));

    expect(await run(['thing'])).toBe(0);
    expect(lines.join('\n')).toContain('wrote snapshots/thing.json');
    expect(JSON.parse(readFileSync(path.join(root, SPEC.file), 'utf8'))).toMatchObject({
      value: 1,
    });

    lines.length = 0;
    expect(await run(['thing'])).toBe(0);
    expect(lines.join('\n')).toContain('snapshots/thing.json is up to date');

    value = 2;
    lines.length = 0;
    expect(await run(['thing'])).toBe(0);
    expect(lines.join('\n')).toContain('wrote snapshots/thing.json');
  });

  it('--check passes on an unchanged surface and writes nothing', async () => {
    const { lines, run } = setup(() => ({ value: 1 }));
    await run(['thing']);
    lines.length = 0;

    expect(await run(['thing', '--check'])).toBe(0);
    expect(lines.join('\n')).toContain('matches snapshots/thing.json');
  });

  it('--check fails on a difference, prints it and how to update, and leaves the file', async () => {
    let value = 1;
    const { root, lines, run } = setup(() => ({ value }));
    await run(['thing']);
    const committed = readFileSync(path.join(root, SPEC.file), 'utf8');
    value = 2;
    lines.length = 0;

    expect(await run(['thing', '--check'])).toBe(1);
    const output = lines.join('\n');
    expect(output).toContain('The thing differs from snapshots/thing.json');
    expect(output).toContain('-   "value": 1');
    expect(output).toContain('+   "value": 2');
    expect(output).toContain('pnpm bslt snapshot thing');
    expect(readFileSync(path.join(root, SPEC.file), 'utf8')).toBe(committed);
  });

  it('refuses an unknown snapshot and an unknown option, naming what exists', async () => {
    const { lines, run } = setup(() => ({}));

    expect(await run(['nothing'])).toBe(1);
    expect(await run([])).toBe(1);
    expect(await run(['thing', '--frobnicate'])).toBe(1);
    expect(lines.join('\n')).toContain('bslt snapshot thing');
    expect(lines.join('\n')).toContain('--frobnicate');
  });

  it('registers the two oracles (the database catalog is `bslt db catalog`)', () => {
    expect(Object.keys(SNAPSHOT_COMMANDS)).toEqual(['api', 'web-routes']);
    for (const [id, command] of Object.entries(SNAPSHOT_COMMANDS)) {
      expect(command.spec.id).toBe(id);
      expect(command.spec.file.startsWith('main/tools/snapshots/')).toBe(true);
    }
  });
});
