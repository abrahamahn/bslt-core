// main/tools/module/release.test.ts
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CORE_MODULE_IDS } from '../gates/optional-module-isolation';
import { REPO_ROOT } from '../lib/paths';

import { extractTarGzToMemory, sha256Hex } from './archive';
import {
  MODULES_CATALOG_FILENAME,
  parseModuleReleaseArgs,
  releaseOptionalModules,
  type ModulesCatalogManifest,
} from './release';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('bslt module release', () => {
  it('rejects unknown CLI flags and missing --out values', () => {
    expect(() => parseModuleReleaseArgs(['--unknown'])).toThrow(/unknown option/iu);
    expect(() => parseModuleReleaseArgs(['--out'])).toThrow(/--out requires/iu);
  });

  it('rejects workspaces missing root package.json or bslt.config.ts', async () => {
    const emptyRoot = makeTempDir('bslt-release-invalid-');
    const outDir = makeTempDir('bslt-release-out-');
    await expect(releaseOptionalModules({ root: emptyRoot, outDir })).rejects.toThrow(
      /bslt\.config\.ts|package\.json/iu,
    );
  });

  it('excludes dist, node_modules, .turbo, and .tsbuildinfo files from packaged archives', async () => {
    const root = makeTempDir('bslt-release-filter-');
    const outDir = makeTempDir('bslt-release-filter-out-');

    mkdirSync(path.join(root, 'main/modules/identity'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/tasks/dist'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/tasks/node_modules/fake'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/tasks/.turbo'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/tasks/server/migrations'), { recursive: true });
    mkdirSync(path.join(root, 'main/kernel/db'), { recursive: true });

    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: '@bslt/root', version: '1.2.3' }, null, 2),
    );
    writeFileSync(
      path.join(root, 'bslt.lock.json'),
      JSON.stringify(
        {
          orgPermissionBits: {},
          tombstoned: [],
          migrations: {
            'tasks/0001_tasks.sql': 'abc123',
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(root, 'main/kernel/db/catalog.snapshot.json'),
      JSON.stringify(
        {
          generated: 'test',
          sources: [
            { id: 'kernel', dependsOn: [] },
            { id: 'identity', dependsOn: [] },
            { id: 'tasks', dependsOn: ['identity'] },
          ],
          roles: [],
          extensions: [],
          schemas: [],
          types: [],
          sequences: [],
          functions: [],
          tables: [],
          views: [],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { tasksModule } from '@bslt/tasks/module';
export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule, tasksModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/identity/module.ts'),
      `import { defineModule } from '@bslt/contract';
export const identityModule = defineModule({
  id: 'identity',
  summary: 'Identity.',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
});
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/tasks/package.json'),
      JSON.stringify({ name: '@bslt/tasks', version: '1.2.3' }, null, 2),
    );
    writeFileSync(
      path.join(root, 'main/modules/tasks/module.ts'),
      `import { defineModule } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
export const tasksModule = defineModule({
  id: 'tasks',
  summary: 'Tasks.',
  status: 'stable',
  dependsOn: [identityModule],
  endpoints: {},
  events: {},
  jobs: {},
  tables: ['tasks'],
});
`,
    );
    writeFileSync(path.join(root, 'main/modules/tasks/dist/stale.js'), 'stale');
    writeFileSync(path.join(root, 'main/modules/tasks/node_modules/fake/index.js'), 'fake');
    writeFileSync(path.join(root, 'main/modules/tasks/.turbo/log'), 'turbo');
    writeFileSync(path.join(root, 'main/modules/tasks/tsconfig.tsbuildinfo'), '{}');

    const result = await releaseOptionalModules({ root, outDir });
    expect(result.catalog.coreVersion).toBe('1.2.3');
    expect(result.catalog.modules.map((m) => m.id)).toEqual(['tasks']);

    const archiveBytes = readFileSync(path.join(outDir, 'tasks-1.2.3.tar.gz'));
    const extracted = extractTarGzToMemory(archiveBytes, {
      expectedSha256: result.catalog.modules[0]?.sha256,
    });
    expect([...extracted.keys()]).toEqual(['module.ts', 'package.json']);
  });

  it('packages all optional modules on disk deterministically with valid SHA-256 checksums and DAG metadata', async () => {
    const outDirA = makeTempDir('bslt-release-main-a-');
    const outDirB = makeTempDir('bslt-release-main-b-');

    await releaseOptionalModules({ root: REPO_ROOT, outDir: outDirA });
    await releaseOptionalModules({ root: REPO_ROOT, outDir: outDirB });

    const catalogJsonA = readFileSync(path.join(outDirA, MODULES_CATALOG_FILENAME), 'utf8');
    const catalogJsonB = readFileSync(path.join(outDirB, MODULES_CATALOG_FILENAME), 'utf8');
    expect(catalogJsonA).toBe(catalogJsonB);

    const expectedOptionalIds = readdirSync(path.join(REPO_ROOT, 'main/modules'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && !CORE_MODULE_IDS.has(entry.name))
      .map((entry) => entry.name)
      .sort();

    const parsed = JSON.parse(catalogJsonA) as ModulesCatalogManifest;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.modules.map((m) => m.id)).toEqual(expectedOptionalIds);

    if (expectedOptionalIds.includes('billing')) {
      const billing = parsed.modules.find((m) => m.id === 'billing');
      expect(billing?.dependsOn).toEqual(['orgs', 'entitlements']);
      expect(Object.keys(billing?.migrationChecksums ?? {})).toContain('billing/0001_billing.sql');
      expect(billing?.catalogFragment.tables.length).toBeGreaterThan(0);
    }

    for (const mod of parsed.modules) {
      const archivePath = path.join(outDirA, mod.archive);
      expect(existsSync(archivePath), mod.archive).toBe(true);
      const bytes = readFileSync(archivePath);
      expect(bytes.length).toBe(mod.bytes);
      expect(sha256Hex(bytes)).toBe(mod.sha256);
    }
  });
});
