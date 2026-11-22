// main/kernel/db/src/migrate/sources.test.ts
/**
 * The migrate entry of the image must find its SQL.
 *
 * The image is built by `pnpm deploy --prod`, which copies of a workspace
 * package what its `files` list names. The baselines are SQL, not compiled
 * output: left out of `files`, the entry starts in the container, reads no
 * source and fails the deploy, and nothing on a laptop shows it. So the
 * package ships them, and the image build reads every source through the
 * package before it is ever deployed.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { KERNEL_SQL_DIR, migrationSources } from './sources';

const PACKAGE_ROOT = path.join(__dirname, '..', '..');
const REPO_ROOT = path.join(PACKAGE_ROOT, '..', '..', '..');

const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  files?: string[];
  exports?: Record<string, unknown>;
};
const dockerfile = readFileSync(path.join(REPO_ROOT, 'infra/docker/Dockerfile'), 'utf8');

describe('@bslt/db and migrated modules ship their migration sources', () => {
  it('lists the kernel baseline in `files`, next to dist', () => {
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', KERNEL_SQL_DIR]));
  });

  it('orders module migration sources topologically in migrationSources()', () => {
    const sources = migrationSources();
    const byId = new Map(sources.map((source) => [source.id, source]));
    const sourceOrder = sources.map((source) => source.id);

    expect(byId.get('identity')).toEqual({
      id: 'identity',
      dir: path.join(REPO_ROOT, 'main/modules/identity/server/migrations'),
      dependsOn: [],
    });
    expect(byId.get('compliance')).toEqual({
      id: 'compliance',
      dir: path.join(REPO_ROOT, 'main/modules/compliance/server/migrations'),
      dependsOn: ['identity'],
    });
    expect(byId.get('audit')).toEqual({
      id: 'audit',
      dir: path.join(REPO_ROOT, 'main/modules/audit/server/migrations'),
      dependsOn: [],
    });
    expect(sourceOrder.indexOf('identity')).toBeLessThan(sourceOrder.indexOf('compliance'));

    // Every installed module source must appear strictly after all of its dependencies
    for (const source of sources) {
      for (const dep of source.dependsOn) {
        if (byId.has(dep)) {
          expect(sourceOrder.indexOf(dep)).toBeLessThan(sourceOrder.indexOf(source.id));
        }
      }
    }

    if (byId.has('billing')) {
      expect(byId.get('billing')).toEqual({
        id: 'billing',
        dir: path.join(REPO_ROOT, 'main/modules/billing/server/migrations'),
        dependsOn: ['entitlements', 'orgs'],
      });
    }
  });

  it('keeps every source directory inside a shipped `files` directory of its owning package', () => {
    const dbShipped = (manifest.files ?? []).map((entry) => path.join(PACKAGE_ROOT, entry));

    for (const source of migrationSources()) {
      const modulePkgPath = path.join(REPO_ROOT, 'main/modules', source.id, 'package.json');
      const shippedDirs = source.dir.startsWith(path.join(REPO_ROOT, 'main/modules', source.id))
        ? (
            (
              JSON.parse(readFileSync(modulePkgPath, 'utf8')) as {
                files?: string[];
              }
            ).files ?? []
          ).map((entry) => path.join(REPO_ROOT, 'main/modules', source.id, entry))
        : dbShipped;
      expect(
        shippedDirs.some((dir) => source.dir === dir || source.dir.startsWith(`${dir}${path.sep}`)),
        source.id,
      ).toBe(true);
    }
  });

  it('resolves the sources relative to the package in the monorepo and inside a pnpm deploy layout', () => {
    // src/migrate/sources.ts and dist/migrate/sources.js are both two levels
    // below the package root.
    expect(migrationSources().map((source) => path.relative(PACKAGE_ROOT, source.dir))).toEqual(
      expect.arrayContaining([
        KERNEL_SQL_DIR,
        path.join('..', '..', 'modules', 'identity', 'server', 'migrations'),
        path.join('..', '..', 'modules', 'compliance', 'server', 'migrations'),
      ]),
    );
    expect(manifest.exports?.['./migrate']).toMatchObject({
      default: './dist/migrate/index.js',
    });

    const tempDeploy = mkdtempSync(path.join(tmpdir(), 'bslt-deploy-sources-'));
    try {
      const pnpmStoreDbRoot = path.join(
        tempDeploy,
        'node_modules/.pnpm/@bslt+db@1.0.0/node_modules/@bslt/db',
      );
      const deployedComplianceMigrations = path.join(
        tempDeploy,
        'node_modules/@bslt/compliance/server/migrations',
      );
      mkdirSync(pnpmStoreDbRoot, { recursive: true });
      mkdirSync(deployedComplianceMigrations, { recursive: true });

      const resolvedCompliance = migrationSources(pnpmStoreDbRoot).find(
        (source) => source.id === 'compliance',
      );
      expect(resolvedCompliance?.dir).toBe(deployedComplianceMigrations);
    } finally {
      rmSync(tempDeploy, { recursive: true, force: true });
    }
  });

  it('discovers newly scaffolded modules with server/migrations and ignores shells without migrations', () => {
    const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'bslt-monorepo-sources-'));
    try {
      const dbPkgRoot = path.join(tempWorkspace, 'main/kernel/db');
      const identityMigrationsDir = path.join(
        tempWorkspace,
        'main/modules/identity/server/migrations',
      );
      const shellModuleDir = path.join(tempWorkspace, 'main/modules/shell');
      const orgsMigrationsDir = path.join(tempWorkspace, 'main/modules/orgs/server/migrations');
      const exampleMigrationsDir = path.join(
        tempWorkspace,
        'main/modules/example/server/migrations',
      );
      mkdirSync(dbPkgRoot, { recursive: true });
      mkdirSync(identityMigrationsDir, { recursive: true });
      mkdirSync(shellModuleDir, { recursive: true });
      mkdirSync(orgsMigrationsDir, { recursive: true });
      mkdirSync(exampleMigrationsDir, { recursive: true });
      writeFileSync(
        path.join(tempWorkspace, 'main/modules/example/module.ts'),
        [
          "import { defineModule } from '@bslt/contract';",
          "import { identityModule } from '@bslt/identity/module';",
          "import { orgsModule } from '@bslt/orgs/module';",
          'export const exampleModule = defineModule({ id: "example", dependsOn: [identityModule, orgsModule] });',
        ].join('\n'),
      );

      const sources = migrationSources(dbPkgRoot);
      const exampleSource = sources.find((source) => source.id === 'example');
      expect(exampleSource).toEqual({
        id: 'example',
        dir: exampleMigrationsDir,
        dependsOn: ['identity', 'orgs'],
      });
      expect(sources.filter((source) => source.id === 'identity')).toHaveLength(1);
      expect(sources.find((source) => source.id === 'shell')).toBeUndefined();
    } finally {
      rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });
});

describe('the server image', () => {
  it('does not copy a migrations directory of its own: the SQL comes with @bslt/db', () => {
    expect(dockerfile).not.toMatch(/COPY .*\/migrations\b/u);
  });

  it('reads every migration source through the package while it is built', () => {
    // A source missing from the image fails the build, not the deploy.
    expect(dockerfile).toContain("await import('@bslt/db')");
    expect(dockerfile).toContain('readSourceFiles');
    expect(dockerfile).toContain('CANNOT READ the migration sources');
  });
});
