// main/tools/web/prerender.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runWebCli, runWebPrerender } from './prerender';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-web-prerender-'));
  tempDirs.push(dir);
  return dir;
}

describe('bslt web prerender', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when dist/server/serve.js is missing', async () => {
    const webDir = makeTempDir();
    mkdirSync(path.join(webDir, 'dist/client'), { recursive: true });
    writeFileSync(path.join(webDir, 'dist/client/index.html'), '<html></html>', 'utf8');

    await expect(runWebPrerender({ webDir, siteUrl: null })).rejects.toThrow(/serve\.js/u);
  });

  it('fails when dist/server/serve.js does not export prerenderStaticPublicRoutes', async () => {
    const webDir = makeTempDir();
    mkdirSync(path.join(webDir, 'dist/client'), { recursive: true });
    mkdirSync(path.join(webDir, 'dist/server'), { recursive: true });
    writeFileSync(path.join(webDir, 'dist/client/index.html'), '<html></html>', 'utf8');
    writeFileSync(path.join(webDir, 'dist/server/serve.js'), 'export const nope = 1;\n', 'utf8');

    await expect(runWebPrerender({ webDir, siteUrl: null })).rejects.toThrow(
      /prerenderStaticPublicRoutes/u,
    );
  });

  it('fails CLI dispatch on unknown subcommands', async () => {
    expect(await runWebCli(['unknown-subcommand'])).toBe(1);
    expect(await runWebCli([])).toBe(1);
  });

  it('invokes prerenderStaticPublicRoutes from dist/server/serve.js and returns written files', async () => {
    const webDir = makeTempDir();
    mkdirSync(path.join(webDir, 'dist/client'), { recursive: true });
    mkdirSync(path.join(webDir, 'dist/server'), { recursive: true });
    writeFileSync(path.join(webDir, 'dist/client/index.html'), '<html></html>', 'utf8');
    writeFileSync(
      path.join(webDir, 'dist/server/serve.js'),
      `export async function prerenderStaticPublicRoutes({ clientDir, siteUrl }) {
  return ['_spa.html', 'index.html', siteUrl ? 'sitemap.xml' : 'robots.txt'];
}
`,
      'utf8',
    );

    const written = await runWebPrerender({
      webDir,
      siteUrl: 'https://app.bslt.dev',
      quiet: true,
    });
    expect(written).toEqual(['_spa.html', 'index.html', 'sitemap.xml']);
  });

  it('copies docs/reference/openapi.json into dist/client when present relative to webDir', async () => {
    const repoRoot = makeTempDir();
    const webDir = path.join(repoRoot, 'main/apps/web');
    mkdirSync(path.join(webDir, 'dist/client'), { recursive: true });
    mkdirSync(path.join(webDir, 'dist/server'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'docs/reference'), { recursive: true });
    writeFileSync(path.join(webDir, 'dist/client/index.html'), '<html></html>', 'utf8');
    writeFileSync(
      path.join(repoRoot, 'docs/reference/openapi.json'),
      '{"openapi":"3.1.0"}\n',
      'utf8',
    );
    writeFileSync(
      path.join(webDir, 'dist/server/serve.js'),
      `export async function prerenderStaticPublicRoutes() {
  return ['_spa.html', 'index.html'];
}
`,
      'utf8',
    );

    const written = await runWebPrerender({ webDir, siteUrl: null, quiet: true });
    expect(written).toEqual(['_spa.html', 'index.html', 'openapi.json']);
  });
});
