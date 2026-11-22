// main/build-config/src/esm-fix.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fixEsmExtensions } from './esm-fix';

let root: string;

function write(relative: string, content: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'esm-fix-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('fixEsmExtensions', () => {
  it('adds .js to a file import and /index.js to a directory import', () => {
    write('dist/a.js', "import { b } from './b';\nimport './side';\nexport * from './dir';\n");
    write('dist/b.js', 'export const b = 1;\n');
    write('dist/side.js', '');
    write('dist/dir/index.js', 'export const d = 1;\n');

    fixEsmExtensions(['dist'], root);

    expect(read('dist/a.js')).toBe(
      "import { b } from './b.js';\nimport './side.js';\nexport * from './dir/index.js';\n",
    );
  });

  it('rewrites dynamic imports and leaves package and subpath imports alone', () => {
    write(
      'dist/a.js',
      "const m = await import('./lazy');\nimport { x } from '@bslt/db';\nimport { y } from '#app/y';\n",
    );
    write('dist/lazy.js', '');

    fixEsmExtensions(['dist'], root);

    expect(read('dist/a.js')).toBe(
      "const m = await import('./lazy.js');\nimport { x } from '@bslt/db';\nimport { y } from '#app/y';\n",
    );
  });

  it('turns a .js specifier that names a directory into its index.js', () => {
    write('dist/a.js', "import { d } from './dir.js';\n");
    write('dist/dir/index.js', 'export const d = 1;\n');

    fixEsmExtensions(['dist'], root);

    expect(read('dist/a.js')).toBe("import { d } from './dir/index.js';\n");
  });

  it('defaults to dist and skips a directory that does not exist', () => {
    write('dist/a.js', "import './b';\n");
    write('dist/b.js', '');

    expect(() => fixEsmExtensions([], root)).not.toThrow();
    expect(() => fixEsmExtensions(['missing'], root)).not.toThrow();
    expect(read('dist/a.js')).toBe("import './b.js';\n");
  });
});
