// main/tools/module/create-bslt.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from './archive';
import { parseCreateBsltArgs, runCreateBslt } from './create-bslt';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createStarterFixture(): string {
  const root = makeTempDir('bslt-create-src-');
  const kernelSql = '-- 0001_sys.sql\nSELECT 1;\n';
  const identitySql = '-- 0001_identity.sql\nSELECT 1;\n';

  mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(path.join(root, 'node_modules/fake-pkg'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/fake-pkg/index.js'), 'export {};\n');
  mkdirSync(path.join(root, 'config/env'), { recursive: true });
  writeFileSync(
    path.join(root, 'config/env/.env.local'),
    'JWT_SECRET=do-not-copy-local-dev-secret\n',
  );
  writeFileSync(
    path.join(root, 'config/env/.env.local.example'),
    [
      'NODE_ENV=development',
      'VITE_APP_NAME=BSLT',
      'POSTGRES_DB=bslt_dev',
      'JWT_SECRET=dev-secret-change-in-production-32chars!',
      'COOKIE_SECRET=dev-cookie-secret-change-in-prod-32c!',
      'OAUTH_TOKEN_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(root, 'config/.prettierrc'),
    JSON.stringify({ singleQuote: true, trailingComma: 'all', printWidth: 100 }, null, 2),
  );
  mkdirSync(path.join(root, 'main/apps/server/src'), { recursive: true });
  mkdirSync(path.join(root, 'main/apps/web/src'), { recursive: true });
  mkdirSync(path.join(root, 'main/kernel/db/sql'), { recursive: true });
  mkdirSync(path.join(root, 'main/modules/identity/server/migrations'), { recursive: true });
  mkdirSync(path.join(root, 'main/modules/identity/dist'), { recursive: true });
  writeFileSync(path.join(root, 'main/modules/identity/dist/stale.js'), 'export {};\n');
  writeFileSync(path.join(root, 'main/kernel/db/sql/0001_sys.sql'), kernelSql);
  writeFileSync(
    path.join(root, 'main/modules/identity/server/migrations/0001_identity.sql'),
    identitySql,
  );
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@bslt/root', version: '1.0.0', private: true }, null, 2),
  );
  writeFileSync(
    path.join(root, 'bslt.config.ts'),
    `// bslt.config.ts
import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule] as const,
  devOnly: [],
  locales: ['en-US', 'ko-KR'],
  brand: {
    accent: 'oklch(0.62 0.19 264)',
    logo: '/brand/logo.svg',
  },
});
`,
  );
  writeFileSync(
    path.join(root, 'bslt.lock.json'),
    JSON.stringify(
      {
        orgPermissionBits: {},
        tombstoned: [],
        migrations: {
          'kernel/0001_sys.sql': sha256Hex(Buffer.from(kernelSql)),
          'identity/0001_identity.sql': sha256Hex(Buffer.from(identitySql)),
        },
      },
      null,
      2,
    ),
  );
  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('bslt create (create-bslt bootstrapper)', () => {
  it('rejects missing target directory, unknown flags, and invalid presets', () => {
    expect(() => parseCreateBsltArgs([])).toThrow(/target-dir/iu);
    expect(() => parseCreateBsltArgs(['--yes'])).toThrow(/target-dir/iu);
    expect(() => parseCreateBsltArgs(['./my-app', '--bogus'])).toThrow(/unknown option/iu);
    expect(() => parseCreateBsltArgs(['./my-app', '--preset', 'invalid'])).toThrow(
      /unknown preset/iu,
    );
  });

  it('rejects target directories that overlap the source repo or already contain files', async () => {
    const sourceRoot = createStarterFixture();
    await expect(
      runCreateBslt({ sourceRoot, targetDir: sourceRoot, initGit: false, yes: true }),
    ).rejects.toThrow(/cannot be the same/iu);

    await expect(
      runCreateBslt({
        sourceRoot,
        targetDir: path.join(sourceRoot, 'nested-app'),
        initGit: false,
        yes: true,
      }),
    ).rejects.toThrow(/outside the source repository/iu);

    const existingDir = makeTempDir('bslt-create-existing-');
    await expect(
      runCreateBslt({ sourceRoot, targetDir: existingDir, initGit: false, yes: true }),
    ).rejects.toThrow(/already exists/iu);

    writeFileSync(path.join(existingDir, 'keep.txt'), 'occupied\n');
    await expect(
      runCreateBslt({ sourceRoot, targetDir: existingDir, force: true, initGit: false, yes: true }),
    ).rejects.toThrow(/not empty/iu);
  });

  it('supports --dry-run without creating the target directory', async () => {
    const sourceRoot = createStarterFixture();
    const parent = makeTempDir('bslt-create-dry-');
    const targetDir = path.join(parent, 'acme-cloud');

    const res = await runCreateBslt({
      sourceRoot,
      targetDir,
      domain: 'acme.dev',
      scope: '@acme',
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
    expect(res.appName).toBe('Acme Cloud');
    expect(res.scopeMigratedTo).toBe('@acme');
    expect(existsSync(targetDir)).toBe(false);
  });

  it('scaffolds a clean personalized project excluding .git, node_modules, dist, and source .env.local', async () => {
    const sourceRoot = createStarterFixture();
    const parent = makeTempDir('bslt-create-out-');
    const targetDir = path.join(parent, 'nova-saas');

    const parsed = parseCreateBsltArgs([
      targetDir,
      '--name',
      'Nova SaaS',
      '--domain',
      'nova.example',
      '--scope',
      '@nova',
      '--preset',
      'ai-saas',
      '--no-git',
      '--no-install',
      '--yes',
    ]);
    expect(parsed.preset).toBe('ai-saas');
    expect(parsed.initGit).toBe(false);

    const res = await runCreateBslt({
      sourceRoot,
      targetDir,
      appName: 'Nova SaaS',
      domain: 'nova.example',
      scope: '@nova',
      initGit: false,
      install: false,
      yes: true,
    });

    expect(res.dryRun).toBe(false);
    expect(res.envFileWritten).toBe(true);
    expect(res.scopeMigratedTo).toBe('@nova');
    expect(existsSync(path.join(targetDir, '.git'))).toBe(false);
    expect(existsSync(path.join(targetDir, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(targetDir, 'main/modules/identity/dist'))).toBe(false);

    const configText = readFileSync(path.join(targetDir, 'bslt.config.ts'), 'utf8');
    expect(configText).toContain("name: 'Nova SaaS'");
    expect(configText).toContain("from '@nova/identity/module'");

    const envLocal = readFileSync(path.join(targetDir, 'config/env/.env.local'), 'utf8');
    expect(envLocal).not.toContain('do-not-copy-local-dev-secret');
    expect(envLocal).toContain('VITE_APP_NAME=Nova SaaS');
    expect(envLocal).toMatch(/^JWT_SECRET=[0-9a-f]{64}$/mu);
  });
});
