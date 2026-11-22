// main/tools/scripts/audit/esm-dist.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run } from './esm-dist';

const roots: string[] = [];

function createDistFixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-esm-dist-'));
  roots.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(root, relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('esm-dist audit', () => {
  it('fails when a production dist file imports a devDependency or leaked path alias', () => {
    const root = createDistFixture({
      'main/kernel/server/package.json': JSON.stringify({
        name: '@bslt/server-system',
        type: 'module',
        dependencies: { pino: '^10.0.0' },
        devDependencies: { vitest: '^5.0.0' },
      }),
      'main/kernel/server/dist/index.js': "import { describe } from 'vitest';\n",
    });

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('1 ESM dist issue');
  });

  it('fails when a dist/testing file imports an undeclared path alias', () => {
    const root = createDistFixture({
      'main/kernel/server/package.json': JSON.stringify({
        name: '@bslt/server-system',
        type: 'module',
        dependencies: { pino: '^10.0.0' },
        devDependencies: { vitest: '^5.0.0' },
      }),
      'main/kernel/server/dist/testing/real-db/index.js': "import { x } from '@internal/leaked';\n",
    });

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('1 ESM dist issue');
  });

  it('fails when a dist file uses an extensionless relative import', () => {
    const root = createDistFixture({
      'main/kernel/server/package.json': JSON.stringify({
        name: '@bslt/server-system',
        type: 'module',
        dependencies: {},
      }),
      'main/kernel/server/dist/helper.js': 'export const ok = true;\n',
      'main/kernel/server/dist/index.js': "import { ok } from './helper';\nexport { ok };\n",
    });

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('1 ESM dist issue');
  });

  it('allows devDependencies inside dist/testing/** test-support subpaths while enforcing runtime deps elsewhere', () => {
    const root = createDistFixture({
      'main/kernel/server/package.json': JSON.stringify({
        name: '@bslt/server-system',
        type: 'module',
        dependencies: { pino: '^10.0.0' },
        devDependencies: { vitest: '^5.0.0' },
      }),
      'main/kernel/server/dist/index.js': "import pino from 'pino';\nexport { pino };\n",
      'main/kernel/server/dist/testing/real-db/index.js':
        "import { describe } from 'vitest';\nexport { describe };\n",
    });

    const result = run(root);
    expect(result).toEqual({
      ok: true,
      summary: '1 dist directories are valid ESM',
    });
  });

  it('allows explicit-extension bundler query asset imports (e.g. .md?raw) while still rejecting extensionless ?raw imports', () => {
    const badRoot = createDistFixture({
      'main/modules/compliance/package.json': JSON.stringify({
        name: '@bslt/compliance',
        type: 'module',
        dependencies: {},
      }),
      'main/modules/compliance/dist/web/page.js':
        "import doc from '../seeds/legal/cookie?raw';\nexport { doc };\n",
    });
    expect(run(badRoot).ok).toBe(false);

    const goodRoot = createDistFixture({
      'main/modules/compliance/package.json': JSON.stringify({
        name: '@bslt/compliance',
        type: 'module',
        dependencies: {},
      }),
      'main/modules/compliance/dist/web/page.js':
        "import doc from '../seeds/legal/cookie-policy.md?raw';\nexport { doc };\n",
    });
    expect(run(goodRoot)).toEqual({
      ok: true,
      summary: '1 dist directories are valid ESM',
    });
  });
});
