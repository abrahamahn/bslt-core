// main/apps/server/src/bootstrap/self-alias.test.ts
/**
 * The server may not import its own source through a TypeScript path alias.
 *
 * The web app can, and does, because Vite resolves aliases at bundle time. The
 * server is not bundled: `tsc` emits JavaScript that Node runs directly, and it
 * does not rewrite path aliases. So `import { ServerRuntime } from
 * '@/bootstrap/runtime'` survives into `dist/src/main.js` verbatim, and Node
 * throws ERR_MODULE_NOT_FOUND on the entrypoint's first import.
 *
 * That is exactly what shipped. The production image could not boot — the CMD
 * died before a single line of the app ran — and it went unnoticed because the
 * one place the image is exercised (docker-compose.demo.yml) overrides the CMD
 * and bind-mounts a runtime ESM resolve hook to paper over it. The workaround
 * was load-bearing, and the thing it worked around was never fixed.
 *
 * An alias is invisible in review, type-checks perfectly, and passes every unit
 * test, because none of those run the emitted JavaScript. This test does the one
 * thing that catches it: it reads the config and the imports.
 */

import { readFile, readdir } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(APP_ROOT, 'src');

async function tsFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await tsFiles(full, found);
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('the server does not alias its own source', () => {
  it('declares no path alias pointing back into this app', async () => {
    const raw = await readFile(path.join(APP_ROOT, 'tsconfig.json'), 'utf8');
    // tsconfig permits comments, so strip them — but only where the delimiter
    // opens a comment. A naive /\*...\*/ matches the `/*` inside the glob
    // "../../shared/src/modules/*" and runs to the `*/` in "**/*.test.ts",
    // swallowing the whole paths block and leaving JSON that does not parse.
    // Requiring the delimiter to follow whitespace or a line start is enough,
    // because a glob's `/*` always follows a path segment.
    const stripped = raw
      .replace(/(^|\s)\/\*[\s\S]*?\*\//gu, '$1')
      .replace(/(^|\s)\/\/.*$/gmu, '$1');
    const config = JSON.parse(stripped) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = config.compilerOptions?.paths ?? {};

    const selfReferential = Object.entries(paths)
      .filter(([, targets]) =>
        targets.some((target) => !target.startsWith('../') && !target.startsWith('..\\')),
      )
      .map(([alias, targets]) => `${alias} -> ${targets.join(', ')}`);

    // Aliases to *other* workspace packages (../../shared/...) are fine: those
    // resolve as real node_modules packages at runtime. Only aliases into this
    // app's own tree have nothing to resolve to once tsc has emitted.
    expect(selfReferential).toEqual([]);
  });

  it('imports its own modules relatively, never through an alias', async () => {
    const offenders: string[] = [];

    for (const file of await tsFiles(SRC)) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(
        /from\s+'(@\/[^']*|@(?:health|routes|shared)(?:\/[^']*)?)'/gu,
      )) {
        offenders.push(`${path.relative(APP_ROOT, file)}: ${match[1] ?? ''}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
