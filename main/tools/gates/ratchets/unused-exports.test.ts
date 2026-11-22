// main/tools/gates/ratchets/unused-exports.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findUnusedExports } from './unused-exports';

const FILES: Readonly<Record<string, string>> = {
  'pkg/src/a.ts': [
    'export const used = 1;',
    'export const unused = 2;',
    'export type UsedType = string;',
    'export function onlyHere(): void {}',
    'onlyHere();',
    'const local = 1;',
    'export { local as renamed };',
    'export const onlyInTest = 3;',
    'export default function main(): void {}',
  ].join('\n'),
  'pkg/src/a.test.ts': [
    "import { onlyInTest } from './a';",
    'export const helperOfTheTest = onlyInTest;',
  ].join('\n'),
  'pkg/src/b.ts': [
    'export const viaStar = 1;',
    'export const neverImported = 2;',
    'export interface Shape { readonly side: number }',
  ].join('\n'),
  'pkg/src/c.ts': 'export const one = 1;\nexport const two = 2;',
  'pkg/src/d.ts': 'export const lazyOne = 1;',
  'pkg/src/e.ts': 'export const inType = 1;',
  'pkg/src/index.ts': ["export { used, unused } from './a';", "export * from './b';"].join('\n'),
  'app/src/main.ts': [
    "import { used, viaStar } from '../../pkg/src/index';",
    "import * as c from '../../pkg/src/c';",
    "import type { UsedType } from '../../pkg/src/a';",
    "type E = typeof import('../../pkg/src/e');",
    "const lazy = (): Promise<unknown> => import('../../pkg/src/d');",
    'export const result: [number, number, typeof c, UsedType, E | undefined, typeof lazy] = [',
    "  used, viaStar, c, '', undefined, lazy,",
    '];',
  ].join('\n'),
};

let root = '';
let found: string[] = [];

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bslt-unused-exports-'));
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${text}\n`);
  }
  found = findUnusedExports({
    root,
    files: Object.keys(FILES).map((file) => path.join(root, file)),
    isCandidate: (file) => file.startsWith('pkg/src/') && !file.endsWith('.test.ts'),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
      noEmit: true,
    },
  }).map((site) => `${site.file}:${String(site.line)} ${site.text}`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const unused = (): string[] => found;

describe('findUnusedExports', () => {
  it('reports an export no other file imports, once, at its declaration', () => {
    expect(unused()).toEqual([
      'pkg/src/a.ts:2 unused',
      'pkg/src/a.ts:4 onlyHere',
      'pkg/src/a.ts:6 renamed',
      'pkg/src/a.ts:9 default',
      'pkg/src/b.ts:2 neverImported',
      'pkg/src/b.ts:3 Shape',
    ]);
  });

  it('does not count a re-export as a use: `unused` is exported by the index and imported nowhere', () => {
    expect(unused()).toContain('pkg/src/a.ts:2 unused');
  });

  it('counts an import through a barrel, a type import and an import by a test as uses', () => {
    const names = unused().join('\n');
    expect(names).not.toMatch(/ (?:used|viaStar|UsedType|onlyInTest)$/mu);
  });

  it('treats a namespace import, a dynamic import and an import type as using the whole module', () => {
    expect(unused().filter((line) => /\/(?:c|d|e)\.ts/u.test(line))).toEqual([]);
  });

  it('does not report the exports of files that are not candidates', () => {
    expect(unused().filter((line) => !line.startsWith('pkg/src/'))).toEqual([]);
    expect(unused().join('\n')).not.toContain('helperOfTheTest');
  });
});
