// main/tools/gates/tombstones.test.ts
/**
 * The `tombstones` gate: no tombstoned path exists, no tombstoned root script is
 * defined, and no tombstoned symbol appears in tracked text outside history docs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/paths';

import {
  TOMBSTONED_PATTERNS,
  TOMBSTONED_PATHS,
  TOMBSTONED_ROOT_SCRIPTS,
  TOMBSTONED_SYMBOLS,
  findRevivedPathsAndScripts,
  run,
  trackedFilesMatching,
  trackedFilesMentioning,
} from './tombstones';

describe('tombstones', () => {
  it('lists each path, root script and symbol once', () => {
    for (const names of [
      TOMBSTONED_PATHS.map((entry) => entry.path),
      TOMBSTONED_ROOT_SCRIPTS.map((entry) => entry.name),
      TOMBSTONED_SYMBOLS.map((entry) => entry.name),
      TOMBSTONED_PATTERNS.map((entry) => entry.name),
    ]) {
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('passes on this tree', () => {
    const result = run();
    expect(result.problems ?? []).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(TOMBSTONED_SYMBOLS.map((entry) => [entry.name]))(
    '%s appears only in history docs',
    (symbol) => {
      expect(trackedFilesMentioning(symbol)).toEqual([]);
    },
  );

  it('detects a revived path and a revived root script', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'bslt-tombstones-'));
    try {
      const [revivedPath] = TOMBSTONED_PATHS;
      const [revivedScript] = TOMBSTONED_ROOT_SCRIPTS;
      if (revivedPath === undefined || revivedScript === undefined) throw new Error('empty lists');
      mkdirSync(path.join(root, revivedPath.path), { recursive: true });
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { [revivedScript.name]: 'echo back' } }),
      );
      const problems = findRevivedPathsAndScripts(root);
      expect(problems).toEqual([
        expect.stringContaining(revivedPath.path),
        expect.stringContaining(`"${revivedScript.name}"`),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects a revived symbol in tracked text outside the history docs', () => {
    // Guards against a check that can never fail: this test file is tracked and
    // names the export below.
    expect(trackedFilesMentioning('findRevivedPathsAndScripts', REPO_ROOT)).toContain(
      'main/tools/gates/tombstones.test.ts',
    );
  });

  it.each(TOMBSTONED_PATTERNS.map((entry) => [entry.name, entry]))(
    '%s matches no tracked file',
    (_name, entry) => {
      expect(trackedFilesMatching(entry)).toEqual([]);
    },
  );

  it('bans tsconfig paths and baseUrl, and resolve aliases in Vite and Vitest configs', () => {
    const byName = new Map(TOMBSTONED_PATTERNS.map((entry) => [entry.name, entry]));
    const tsconfig = byName.get('tsconfig paths and baseUrl');
    const viteAlias = byName.get('Vite and Vitest resolve aliases');
    if (tsconfig === undefined || viteAlias === undefined) throw new Error('missing pattern');

    const tsconfigPattern = new RegExp(tsconfig.pattern);
    expect(tsconfigPattern.test('    "paths": {')).toBe(true);
    expect(tsconfigPattern.test('    "baseUrl": ".",')).toBe(true);
    expect(tsconfigPattern.test('  "references": [{ "path": "../shared" }]')).toBe(false);
    expect(tsconfig.files).toContain('*tsconfig*.json');

    const aliasPattern = new RegExp(viteAlias.pattern);
    expect(aliasPattern.test("  resolve: { alias: [{ find: '@x', replacement: 'y' }] },")).toBe(
      true,
    );
    expect(aliasPattern.test('    alias: {')).toBe(true);
    expect(aliasPattern.test(' * so no aliases are needed here.')).toBe(false);
  });

  it('bans the otpauth and argon2 packages in code and in manifests', () => {
    const byName = new Map(TOMBSTONED_PATTERNS.map((entry) => [entry.name, entry]));
    const code = byName.get('the otpauth and argon2 npm packages');
    const manifest = byName.get('otpauth or argon2 in a package manifest');
    if (code === undefined || manifest === undefined) throw new Error('missing pattern');
    // Built at runtime: this file is tracked, so a literal import here would trip the gate.
    const single = (name: string): string => `'${name}'`;
    const double = (name: string): string => `"${name}"`;

    const codePattern = new RegExp(code.pattern);
    for (const line of [
      `import { Secret, TOTP } from ${single('otpauth')};`,
      `import type { HashOptions } from ${single('argon2')};`,
      `vi.mock(${single('otpauth')});`,
      `const argon2 = await import(${single('argon2')});`,
      `const otp = require(${double('otpauth')});`,
      `import argon2 from ${single('argon2/argon2.cjs')};`,
    ]) {
      expect(codePattern.test(line), line).toBe(true);
    }
    for (const line of [
      "const config: AuthConfig['argon2'] = ARGON2_DEFAULTS;",
      'const { memoryCost } = config.argon2;',
      "expect(typeof result['otpauthUrl']).toBe('string');",
      "const hash = '$argon2id$v=19$m=19456,t=2,p=1$salt$hash';",
    ]) {
      expect(codePattern.test(line), line).toBe(false);
    }

    const manifestPattern = new RegExp(manifest.pattern);
    expect(manifestPattern.test(`    ${double('argon2')}: "^0.45.2",`)).toBe(true);
    expect(manifestPattern.test(`      ${double('argon2')},`)).toBe(true);
    expect(manifestPattern.test(`    ${double('otpauth')}: "^9.6.0",`)).toBe(true);
    expect(manifestPattern.test('    "@bslt/protocols": "workspace:*",')).toBe(false);
    expect(manifest.files).toEqual(['*package.json']);
  });

  it('detects a pattern match in tracked files', () => {
    // Guards against a check that can never fail: this file is tracked and
    // contains the call below.
    expect(
      trackedFilesMatching({
        name: 'probe',
        files: ['main/tools/gates/*.test.ts'],
        pattern: 'trackedFilesMatching\\(',
        phase: 3,
        note: 'probe',
      }),
    ).toContain('main/tools/gates/tombstones.test.ts');
  });
});
