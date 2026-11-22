// main/tools/cli/scripts.test.ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PATHS } from '../lib/paths';

import { COMMAND_NAMES } from './main';
import { DB_COMMANDS, SCRIPT_COMMANDS } from './scripts';

const rootScripts = (): Record<string, string> =>
  (JSON.parse(readFileSync(PATHS.rootPackageJson, 'utf8')) as { scripts: Record<string, string> })
    .scripts;

/** Every `bslt <command> [<sub>]` call in a script body. */
function bsltCalls(body: string): { command: string; sub: string | undefined }[] {
  return [...body.matchAll(/\bbslt ([a-z-]+)(?: ([a-z-]+))?/gu)].map((match) => ({
    command: match[1] ?? '',
    sub: match[2],
  }));
}

describe('the bslt subcommands', () => {
  it('each document what they do', () => {
    for (const [name, command] of [
      ...Object.entries(DB_COMMANDS),
      ...Object.entries(SCRIPT_COMMANDS),
    ]) {
      expect(command.usage, name).not.toBe('');
    }
  });
});

describe('the root package.json scripts', () => {
  it('stay at 45 or fewer (plan section 14.1)', () => {
    expect(Object.keys(rootScripts()).length).toBeLessThanOrEqual(45);
  });

  it('call only bslt commands that exist', () => {
    for (const [name, body] of Object.entries(rootScripts())) {
      for (const { command, sub } of bsltCalls(body)) {
        expect(COMMAND_NAMES, `${name}: bslt ${command}`).toContain(command);
        if (command === 'db') expect(Object.keys(DB_COMMANDS), name).toContain(sub);
      }
    }
  });

  it('run no repository script by path', () => {
    const byPath = Object.entries(rootScripts()).filter(([, body]) => body.includes('main/tools/'));
    expect(byPath).toEqual([]);
  });
});
