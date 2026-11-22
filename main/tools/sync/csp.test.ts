// main/tools/sync/csp.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CADDY_GENERATED_END_MARKER,
  CADDY_GENERATED_START_MARKER,
  GENERATED_CADDY_SNIPPET_FILE,
  GENERATED_SECURITY_HEADERS_TS_FILE,
  buildMergedEdgeCsp,
  run,
  syncCsp,
} from './csp';

const tempDirs: string[] = [];

function createTempRoot(options?: {
  readonly bsltConfig?: string;
  readonly modules?: Readonly<Record<string, string>>;
  readonly caddyfile?: string | null;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bslt-sync-csp-'));
  tempDirs.push(root);

  fs.mkdirSync(path.join(root, 'infra/runtime/caddy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'main/kernel/web/src/ssr'), { recursive: true });

  if (options?.bsltConfig !== undefined) {
    fs.writeFileSync(path.join(root, 'bslt.config.ts'), options.bsltConfig, 'utf8');
  } else {
    fs.writeFileSync(
      path.join(root, 'bslt.config.ts'),
      [
        "import { defineConfig } from '@bslt/contract';",
        "import { filesModule } from '@bslt/files/module';",
        'export default defineConfig({ installedModules: [filesModule] });',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  const modules = options?.modules ?? {
    files: [
      "import { defineModule } from '@bslt/contract';",
      'export const filesModule = defineModule({',
      "  id: 'files',",
      "  summary: 'Files',",
      "  status: 'stable',",
      '  dependsOn: [],',
      '  csp: {',
      '    "img-src": ["\'self\'", "data:", "blob:"],',
      '    "media-src": ["\'self\'", "blob:"],',
      '  },',
      '  endpoints: {},',
      '  events: {},',
      '  jobs: {},',
      '  tables: [],',
      '});',
      '',
    ].join('\n'),
  };

  for (const [id, source] of Object.entries(modules)) {
    const dir = path.join(root, 'main/modules', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'module.ts'), source, 'utf8');
  }

  if (options?.caddyfile !== null) {
    fs.writeFileSync(
      path.join(root, 'infra/runtime/caddy/Caddyfile'),
      options?.caddyfile ??
        [
          '{$DOMAIN:localhost} {',
          `\t${CADDY_GENERATED_START_MARKER}`,
          '\theader {',
          '\t\t-Server',
          '\t}',
          `\t${CADDY_GENERATED_END_MARKER}`,
          '\thandle {',
          '\t\treverse_proxy web:80',
          '\t}',
          '}',
          '',
        ].join('\n'),
      'utf8',
    );
  }

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('bslt sync csp', () => {
  it('throws when bslt.config.ts is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bslt-sync-csp-missing-'));
    tempDirs.push(root);
    await expect(syncCsp({ root })).rejects.toThrow(/bslt\.config\.ts/iu);
  });

  it("forbids modules from touching script-src and rejects 'unsafe-inline' / 'unsafe-eval' in allowed directives", async () => {
    const scriptSrcRoot = createTempRoot({
      modules: {
        files: [
          "import { defineModule } from '@bslt/contract';",
          'export const filesModule = defineModule({',
          "  id: 'files',",
          "  csp: { 'script-src': ['https://cdn.example.com'] },",
          '});',
        ].join('\n'),
      },
    });
    await expect(syncCsp({ root: scriptSrcRoot })).rejects.toThrow(/unsupported csp directive/iu);

    const unsafeInlineRoot = createTempRoot({
      modules: {
        files: [
          "import { defineModule } from '@bslt/contract';",
          'export const filesModule = defineModule({',
          "  id: 'files',",
          "  csp: { 'connect-src': [\"'unsafe-inline'\"] },",
          '});',
        ].join('\n'),
      },
    });
    await expect(syncCsp({ root: unsafeInlineRoot })).rejects.toThrow(/unsafe or wildcard/iu);
  });

  it('rejects module csp containing wildcard (*) or semicolon/whitespace injection', async () => {
    const wildcardRoot = createTempRoot({
      modules: {
        files: [
          "import { defineModule } from '@bslt/contract';",
          'export const filesModule = defineModule({',
          "  id: 'files',",
          "  csp: { 'img-src': ['*'] },",
          '});',
        ].join('\n'),
      },
    });
    await expect(syncCsp({ root: wildcardRoot })).rejects.toThrow(/wildcard|unsafe/iu);

    const injectedRoot = createTempRoot({
      modules: {
        files: [
          "import { defineModule } from '@bslt/contract';",
          'export const filesModule = defineModule({',
          "  id: 'files',",
          "  csp: { 'img-src': ['https://cdn.example.com; script-src *'] },",
          '});',
        ].join('\n'),
      },
    });
    await expect(syncCsp({ root: injectedRoot })).rejects.toThrow(/whitespace or semicolons/iu);
  });

  it('rejects unsupported CSP directive names in module manifests', async () => {
    const root = createTempRoot({
      modules: {
        files: [
          "import { defineModule } from '@bslt/contract';",
          'export const filesModule = defineModule({',
          "  id: 'files',",
          "  csp: { 'unknown-directive': ['https://cdn.example.com'] },",
          '});',
        ].join('\n'),
      },
    });
    await expect(syncCsp({ root })).rejects.toThrow(/unsupported csp directive/iu);
  });

  it('throws when Caddyfile is missing the @generated markers', async () => {
    const root = createTempRoot({
      caddyfile: '{$DOMAIN:localhost} {\n\treverse_proxy web:80\n}\n',
    });
    await expect(syncCsp({ root })).rejects.toThrow(/generated.*marker/iu);
  });

  it('fails check when generated files are missing or drifted and passes after syncCsp', async () => {
    const root = createTempRoot();

    const missing = await run({ root });
    expect(missing.ok).toBe(false);

    const written = await syncCsp({ root });
    expect(written.changed).toBe(true);

    const snippet = fs.readFileSync(path.join(root, GENERATED_CADDY_SNIPPET_FILE), 'utf8');
    const tsFile = fs.readFileSync(path.join(root, GENERATED_SECURITY_HEADERS_TS_FILE), 'utf8');
    const caddyfile = fs.readFileSync(path.join(root, 'infra/runtime/caddy/Caddyfile'), 'utf8');

    expect(snippet).toContain(
      '# @generated by bslt sync csp from bslt.config.ts and module csp manifests. Do not edit.',
    );
    expect(snippet).toContain("media-src 'self' blob:;");
    expect(tsFile).toContain(
      '// @generated by bslt sync csp from bslt.config.ts and module csp manifests. Do not edit.',
    );
    expect(tsFile).toContain('GENERATED_EDGE_CSP');
    expect(tsFile).toContain('GENERATED_PERMISSIONS_POLICY');
    expect(caddyfile).toContain("media-src 'self' blob:;");

    const clean = await run({ root });
    expect(clean.ok).toBe(true);

    // Drift in Caddyfile fails the gate
    fs.writeFileSync(
      path.join(root, 'infra/runtime/caddy/Caddyfile'),
      caddyfile.replace("media-src 'self' blob:;", "media-src 'self';"),
      'utf8',
    );
    const driftedCaddy = await run({ root });
    expect(driftedCaddy.ok).toBe(false);
    expect(driftedCaddy.summary).toMatch(/out of date/iu);
  });

  it('merges installedModules csp deterministically while keeping script-src free of unsafe-inline', () => {
    const root = createTempRoot();
    const { edgeCsp } = buildMergedEdgeCsp(root);
    expect(edgeCsp).toContain("default-src 'self';");
    expect(edgeCsp).toContain("img-src 'self' data: blob:;");
    expect(edgeCsp).toContain("media-src 'self' blob:;");
    expect(edgeCsp).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
