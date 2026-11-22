// main/tools/scripts/audit/bundle-size.test.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { auditBundleSize, run } from './bundle-size';

const tempDirs: string[] = [];

function createFixtureRoot(options?: {
  readonly withDist?: boolean;
  readonly withManifest?: boolean;
  readonly withBudget?: boolean;
  readonly publicJsBytes?: number;
  readonly publicCssBytes?: number;
  readonly spaJsBytes?: number;
  readonly scriptBudgetKb?: number;
  readonly cssBudgetKb?: number;
}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bslt-bundle-size-'));
  tempDirs.push(root);

  if (options?.withBudget !== false) {
    mkdirSync(path.join(root, 'config'), { recursive: true });
    writeFileSync(
      path.join(root, 'config/lighthouse-budget.json'),
      JSON.stringify(
        [
          {
            path: '/*',
            resourceSizes: [
              { resourceType: 'script', budget: options?.scriptBudgetKb ?? 250 },
              { resourceType: 'stylesheet', budget: options?.cssBudgetKb ?? 60 },
              { resourceType: 'total', budget: 320 },
            ],
            resourceCounts: [{ resourceType: 'third-party', budget: 0 }],
            timings: [
              { metric: 'first-contentful-paint', budget: 1800 },
              { metric: 'largest-contentful-paint', budget: 2500 },
            ],
          },
        ],
        null,
        2,
      ),
      'utf8',
    );
  }

  if (options?.withDist !== false) {
    const clientDir = path.join(root, 'main/apps/web/dist/client');
    mkdirSync(path.join(clientDir, 'assets'), { recursive: true });

    // Incompressible payload so gzip size is predictable in tests
    const pubJs = randomBytes(options?.publicJsBytes ?? 4096).toString('base64');
    const pubCss = randomBytes(options?.publicCssBytes ?? 1024).toString('base64');
    const spaJs = randomBytes(options?.spaJsBytes ?? 4096).toString('base64');

    writeFileSync(path.join(clientDir, 'assets/public-aaaa1111.js'), `const a="${pubJs}";\n`);
    writeFileSync(path.join(clientDir, 'assets/public-aaaa1111.css'), `.x{content:"${pubCss}"}\n`);
    writeFileSync(path.join(clientDir, 'assets/main-bbbb2222.js'), `const b="${spaJs}";\n`);

    if (options?.withManifest !== false) {
      mkdirSync(path.join(clientDir, '.vite'), { recursive: true });
      writeFileSync(
        path.join(clientDir, '.vite/manifest.json'),
        JSON.stringify(
          {
            'index.html': {
              file: 'assets/main-bbbb2222.js',
              src: 'index.html',
              isEntry: true,
            },
            'src/entry-public.tsx': {
              file: 'assets/public-aaaa1111.js',
              src: 'src/entry-public.tsx',
              isEntry: true,
              css: ['assets/public-aaaa1111.css'],
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    }
  }

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('bundle-size & public entry Lighthouse budget audit', () => {
  it('fails when dist/client/assets does not exist', () => {
    const root = createFixtureRoot({ withDist: false });
    const result = auditBundleSize(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/no web build output/iu);
  });

  it('fails when config/lighthouse-budget.json is missing', () => {
    const root = createFixtureRoot({ withBudget: false });
    const result = auditBundleSize(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/lighthouse-budget\.json/iu);
  });

  it('fails when .vite/manifest.json or src/entry-public.tsx is missing', () => {
    const root = createFixtureRoot({ withManifest: false });
    const result = auditBundleSize(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/entry-public|manifest/iu);
  });

  it('fails when a single JS chunk exceeds the 250KB gzipped per-chunk limit', () => {
    const root = createFixtureRoot({ spaJsBytes: 280 * 1024 });
    const result = auditBundleSize(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/exceeds 250KB gzipped/iu);
  });

  it('fails when entry-public initial JS exceeds the script budget in config/lighthouse-budget.json', () => {
    const root = createFixtureRoot({ publicJsBytes: 40 * 1024, scriptBudgetKb: 20 });
    const result = auditBundleSize(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/entry-public.*script budget/iu);
  });

  it('fails when entry-public initial CSS exceeds the stylesheet budget in config/lighthouse-budget.json', () => {
    const root = createFixtureRoot({ publicCssBytes: 25 * 1024, cssBudgetKb: 10 });
    const result = auditBundleSize(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/entry-public.*stylesheet budget/iu);
  });

  it('passes on a valid fixture and on the real @bslt/web build output', () => {
    const root = createFixtureRoot();
    expect(auditBundleSize(root).ok).toBe(true);
    expect(run(root).ok).toBe(true);
  });
});
