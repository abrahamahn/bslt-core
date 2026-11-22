// main/tools/scripts/export/core.test.ts
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run as runModuleGraphGate } from '../../gates/module-graph';
import {
  KNOWN_OPTIONAL_MODULE_IDS,
  run as runOptionalIsolationGate,
} from '../../gates/optional-module-isolation';
import { REPO_ROOT } from '../../lib/paths';
import { run as runSyncModulesGate } from '../../sync/modules';
import { run as runPermissionsGate } from '../../sync/permissions';
import { run as runSyncRowsGate } from '../../sync/rows';

import { exportCoreRepository, parseExportCoreArgs } from './core';

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

describe('bslt export core', () => {
  it('rejects missing --out values and unknown CLI flags', () => {
    expect(() => parseExportCoreArgs(['--out'])).toThrow(/--out requires/iu);
    expect(() => parseExportCoreArgs(['--unknown'])).toThrow(/unknown option/iu);
  });

  it('refuses exporting onto REPO_ROOT itself or nested inside REPO_ROOT source trees', async () => {
    await expect(
      exportCoreRepository({ sourceRoot: REPO_ROOT, outDir: REPO_ROOT, install: false }),
    ).rejects.toThrow(/cannot export.*source repository/iu);
    await expect(
      exportCoreRepository({
        sourceRoot: REPO_ROOT,
        outDir: path.join(REPO_ROOT, 'main/apps'),
        install: false,
      }),
    ).rejects.toThrow(/cannot export.*source repository/iu);
  });

  it('exports Minimal Core from bslt-main while preserving target .git & LICENSE, omitting all 14 optional modules, and passing offline Core gates', async () => {
    const outDir = makeTempDir('bslt-export-core-test-');
    mkdirSync(path.join(outDir, '.git'), { recursive: true });
    writeFileSync(path.join(outDir, '.git/HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(path.join(outDir, 'LICENSE'), 'MIT License - Preserved\n');
    writeFileSync(path.join(outDir, 'stale-legacy-file.txt'), 'should be cleaned');

    const result = await exportCoreRepository({
      sourceRoot: REPO_ROOT,
      outDir,
      install: false,
      verify: false,
    });

    expect(result.coreModules).toEqual(['identity', 'compliance', 'audit']);
    expect(result.devOnlyModules).toEqual(['devtools']);

    // Preserves .git and LICENSE, cleans stale legacy files
    expect(readFileSync(path.join(outDir, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    expect(readFileSync(path.join(outDir, 'LICENSE'), 'utf8')).toBe('MIT License - Preserved\n');
    expect(existsSync(path.join(outDir, 'stale-legacy-file.txt'))).toBe(false);

    // Never exports untracked local env files or optional modules
    expect(existsSync(path.join(outDir, 'config/env/.env.local'))).toBe(false);
    expect(existsSync(path.join(outDir, 'config/env/.env.development'))).toBe(false);
    for (const optId of KNOWN_OPTIONAL_MODULE_IDS) {
      expect(existsSync(path.join(outDir, `main/modules/${optId}`)), optId).toBe(false);
    }

    // Keeps all 4 Core modules + quickstart README
    for (const coreId of ['identity', 'compliance', 'audit', 'devtools']) {
      expect(existsSync(path.join(outDir, `main/modules/${coreId}/module.ts`)), coreId).toBe(true);
    }
    const readme = readFileSync(path.join(outDir, 'README.md'), 'utf8');
    expect(readme).toContain('pnpm quickstart');
    expect(readme).toContain('bslt module add');

    // Offline gates pass directly against the exported Minimal Core tree
    expect(runOptionalIsolationGate(outDir)).toMatchObject({ ok: true });
    expect(runModuleGraphGate(outDir)).toMatchObject({ ok: true });
    expect(await runPermissionsGate({ root: outDir })).toMatchObject({ ok: true });
    expect(await runSyncModulesGate({ root: outDir })).toMatchObject({ ok: true });
    expect(await runSyncRowsGate({ root: outDir })).toMatchObject({ ok: true });
  });
});
