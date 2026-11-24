// main/tools/module/new.test.ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { serializeCatalog } from '../catalog/file';
import { run as runEventsGate } from '../gates/events';
import { run as runModuleGraphGate } from '../gates/module-graph';
import { run as runModuleShapeGate } from '../gates/module-shape';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';
import { run as runSyncModulesGate, syncModules } from '../sync/modules';
import { run as runSyncRowsGate, syncRows } from '../sync/rows';

import { parseModuleNewArgs, scaffoldModule } from './new';

const tempDirs: string[] = [];

function walkRelativeFiles(absDir: string, prefix = ''): string[] {
  if (!existsSync(absDir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage' ||
      entry.name === '.turbo' ||
      entry.name === '.cache'
    ) {
      continue;
    }
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRelativeFiles(full, rel));
    } else if (entry.isFile()) {
      results.push(rel);
    }
  }
  return results.sort(compareText);
}

function normalizeModuleShape(files: readonly string[], id: string, pageStem: string): string[] {
  return files
    .map((file) =>
      file
        .replace(`server/migrations/0001_${id}.sql`, 'server/migrations/0001_<id>.sql')
        .replace(new RegExp(`^web/${pageStem}Page\\.`, 'u'), 'web/<Page>.'),
    )
    .sort(compareText);
}

async function createTempWorkspace(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'bslt-module-new-'));
  tempDirs.push(dir);

  mkdirSync(path.join(dir, 'config'), { recursive: true });
  writeFileSync(
    path.join(dir, 'config/.prettierrc'),
    JSON.stringify({ singleQuote: true, trailingComma: 'all', printWidth: 100 }, null, 2),
  );
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: '@bslt/root',
        private: true,
        devDependencies: {
          '@bslt/build-config': 'workspace:*',
          '@bslt/tools': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  mkdirSync(path.join(dir, 'main/apps/server/src'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/apps/server/package.json'),
    JSON.stringify(
      {
        name: '@bslt/server',
        version: '1.0.0',
        dependencies: { '@bslt/db': 'workspace:*', '@bslt/server-system': 'workspace:*' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, 'main/apps/server/tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { composite: true }, references: [{ path: '../../kernel/server' }] },
      null,
      2,
    ),
  );

  mkdirSync(path.join(dir, 'main/apps/web/src'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/apps/web/package.json'),
    JSON.stringify(
      {
        name: '@bslt/web',
        version: '1.0.0',
        dependencies: { '@bslt/client-engine': 'workspace:*', '@bslt/react': 'workspace:*' },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, 'main/apps/web/tsconfig.json'),
    JSON.stringify(
      { compilerOptions: { composite: true }, references: [{ path: '../../kernel/react' }] },
      null,
      2,
    ),
  );

  mkdirSync(path.join(dir, 'main/modules/identity/server'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/modules/identity/package.json'),
    JSON.stringify({ name: '@bslt/identity', version: '1.0.0', type: 'module' }, null, 2),
  );
  writeFileSync(
    path.join(dir, 'main/modules/identity/tsconfig.json'),
    JSON.stringify({ compilerOptions: { composite: true } }, null, 2),
  );
  writeFileSync(
    path.join(dir, 'main/modules/identity/README.md'),
    '# `@bslt/identity`\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n',
  );
  writeFileSync(
    path.join(dir, 'main/modules/identity/module.ts'),
    `import { defineModule } from '@bslt/contract';

export const identityModule = defineModule({
  id: 'identity',
  summary: 'Identity shell.',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});
`,
  );
  writeFileSync(
    path.join(dir, 'main/modules/identity/server/index.ts'),
    `import { implementServer } from '@bslt/server-system/module';
import { identityModule } from '../module';

export const identityServer = implementServer(identityModule, {
  migrations: new URL('./migrations/', import.meta.url),
  create: () => ({}),
  handlers: {},
});
`,
  );

  mkdirSync(path.join(dir, 'main/kernel/db'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/kernel/db/catalog.snapshot.json'),
    serializeCatalog({
      sources: [
        { id: 'kernel', dependsOn: [] },
        { id: 'identity', dependsOn: [] },
      ],
      roles: [],
      extensions: [],
      schemas: [],
      types: [],
      sequences: [],
      functions: [],
      tables: [
        {
          schema: 'public',
          name: 'identity_users',
          source: 'identity',
          kind: 'table',
          owner: 'bslt_owner',
          comment: 'rls:owner_user',
          rowSecurity: { enabled: true, forced: true },
          partition: null,
          columns: ['id uuid NOT NULL DEFAULT uuid_generate_v4()'],
          constraints: ['identity_users_pkey PRIMARY KEY (id)'],
          indexes: [
            'CREATE UNIQUE INDEX identity_users_pkey ON public.identity_users USING btree (id)',
          ],
          policies: [
            {
              name: 'rls_user_select',
              command: 'SELECT',
              permissive: true,
              roles: ['authenticated'],
              using: '(id = sys_current_user_id())',
              withCheck: null,
            },
          ],
          triggers: [],
          grants: ['authenticated: SELECT'],
          columnGrants: [],
        },
      ],
      views: [],
    }),
  );

  writeFileSync(
    path.join(dir, 'bslt.config.ts'),
    `// bslt.config.ts
import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: {
    accent: 'oklch(0.62 0.19 264)',
    logo: '/brand/logo.svg',
  },
});
`,
  );

  await syncModules({ root: dir });
  await syncRows({ root: dir });

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

describe('bslt module new', () => {
  it('scaffolds example with the exact file shape of main/modules/tasks and passes module gates', async () => {
    const root = await createTempWorkspace();
    const result = await scaffoldModule('example', { root });

    expect(result.moduleDir).toBe('main/modules/example');

    const exampleFiles = normalizeModuleShape(
      walkRelativeFiles(path.join(root, 'main/modules/example')),
      'example',
      'Example',
    );
    const tasksDir = path.join(REPO_ROOT, 'main/modules/tasks');
    if (existsSync(tasksDir)) {
      const tasksFiles = normalizeModuleShape(walkRelativeFiles(tasksDir), 'tasks', 'Tasks');
      expect(exampleFiles).toEqual(tasksFiles);
    } else {
      expect(exampleFiles.length).toBeGreaterThanOrEqual(20);
    }

    expect(runModuleShapeGate(root)).toMatchObject({ ok: true });
    expect(runModuleGraphGate(root)).toMatchObject({ ok: true });
    expect(runEventsGate(root)).toMatchObject({ ok: true });
    expect(await runSyncModulesGate({ root })).toMatchObject({ ok: true });
    expect(await runSyncRowsGate({ root })).toMatchObject({ ok: true });

    const configText = readFileSync(path.join(root, 'bslt.config.ts'), 'utf8');
    expect(configText).toContain("import { exampleModule } from '@bslt/example/module';");
    expect(configText).toContain('installedModules: [identityModule, exampleModule] as const');
  });

  it('supports --dry-run without creating files or mutating bslt.config.ts', async () => {
    const root = await createTempWorkspace();
    const beforeConfig = readFileSync(path.join(root, 'bslt.config.ts'), 'utf8');

    const result = await scaffoldModule('example', { root, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.files.length).toBeGreaterThanOrEqual(25);
    expect(existsSync(path.join(root, 'main/modules/example'))).toBe(false);
    expect(readFileSync(path.join(root, 'bslt.config.ts'), 'utf8')).toBe(beforeConfig);
  });

  it('parses valid CLI arguments for bslt module new including --scope user|org', () => {
    expect(parseModuleNewArgs(['new', 'example'])).toEqual({
      id: 'example',
      scope: 'user',
      dryRun: false,
      install: true,
    });
    expect(
      parseModuleNewArgs(['new', 'example', '--scope', 'org', '--dry-run', '--no-install']),
    ).toEqual({
      id: 'example',
      scope: 'org',
      dryRun: true,
      install: false,
    });
    expect(parseModuleNewArgs(['new', 'projects', '--scope=org']).scope).toBe('org');
    expect(() => parseModuleNewArgs(['new', 'projects', '--scope', 'global'])).toThrow(
      /invalid --scope/iu,
    );
  });

  it('scaffolds an org-scoped module with owner_org RLS, orgsModule dependency, and ORG_REQUIRED guard', async () => {
    const root = await createTempWorkspace();
    const res = await scaffoldModule('projects', { root, scope: 'org', dryRun: true });
    expect(res.scope).toBe('org');
    expect(res.files).toContain('main/modules/projects/server/migrations/0001_projects.sql');

    // Add minimal orgs stub so syncModules/syncRows succeeds when writing org-scoped module
    mkdirSync(path.join(root, 'main/modules/orgs/server/migrations'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/orgs/web'), { recursive: true });
    writeFileSync(
      path.join(root, 'main/modules/orgs/module.ts'),
      "import { defineModule } from '@bslt/contract';\nexport const orgsModule = defineModule({ id: 'orgs', summary: 'orgs', status: 'stable', dependsOn: [], endpoints: {}, events: {}, jobs: {}, tables: ['orgs'] });\n",
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/server/index.ts'),
      'export const orgsServer = {};\n',
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/README.md'),
      '# `@bslt/orgs`\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n',
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/web/index.ts'),
      'export const orgsWeb = {};\n',
    );
    const catalogPath = path.join(root, 'main/kernel/db/catalog.snapshot.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      sources: { id: string; dependsOn: string[] }[];
    };
    catalog.sources.push({ id: 'orgs', dependsOn: ['identity'] });
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
    const cfg = readFileSync(path.join(root, 'bslt.config.ts'), 'utf8');
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      cfg
        .replace(
          "import { identityModule } from '@bslt/identity/module';",
          "import { identityModule } from '@bslt/identity/module';\nimport { orgsModule } from '@bslt/orgs/module';",
        )
        .replace(
          'installedModules: [identityModule]',
          'installedModules: [identityModule, orgsModule]',
        ),
    );

    const written = await scaffoldModule('projects', { root, scope: 'org' });
    expect(written.scope).toBe('org');
    const sql = readFileSync(
      path.join(root, 'main/modules/projects/server/migrations/0001_projects.sql'),
      'utf8',
    );
    expect(sql).toContain('org_id uuid');
    expect(sql).toContain('REFERENCES orgs(id)');
    expect(sql).toContain("'owner_org', 'org_id'");

    const manifest = readFileSync(path.join(root, 'main/modules/projects/module.ts'), 'utf8');
    expect(manifest).toContain('dependsOn: [orgsModule]');
    expect(manifest).toContain("permissions: ['projects.manage']");

    const serverIndex = readFileSync(
      path.join(root, 'main/modules/projects/server/index.ts'),
      'utf8',
    );
    expect(serverIndex).toContain('requireActingOrgId(req)');
    expect(serverIndex).toContain('ORG_REQUIRED');
  });

  it('rejects empty or whitespace-only module ids', async () => {
    const root = await createTempWorkspace();
    await expect(scaffoldModule('', { root })).rejects.toThrow(/lowercase/iu);
    await expect(scaffoldModule('   ', { root })).rejects.toThrow(/lowercase/iu);
  });

  it('rejects uppercase, hyphenated, underscored, or digit-leading module ids', async () => {
    const root = await createTempWorkspace();
    await expect(scaffoldModule('Example', { root })).rejects.toThrow(/lowercase/iu);
    await expect(scaffoldModule('my-module', { root })).rejects.toThrow(/lowercase/iu);
    await expect(scaffoldModule('my_module', { root })).rejects.toThrow(/lowercase/iu);
    await expect(scaffoldModule('2fast', { root })).rejects.toThrow(/lowercase/iu);
  });

  it('rejects reserved kernel, infrastructure, and workspace package ids', async () => {
    const root = await createTempWorkspace();
    for (const reserved of [
      'kernel',
      'sys',
      'contract',
      'schema',
      'db',
      'server',
      'web',
      'tools',
      'ui',
    ]) {
      await expect(scaffoldModule(reserved, { root })).rejects.toThrow(/reserved/iu);
    }
  });

  it('rejects scaffolding over an already existing module directory', async () => {
    const root = await createTempWorkspace();
    await expect(scaffoldModule('identity', { root })).rejects.toThrow(/already exists|reserved/iu);
    await scaffoldModule('example', { root });
    await expect(scaffoldModule('example', { root })).rejects.toThrow(/already exists/iu);
  });

  it('rejects scaffolding when bslt.config.ts is missing', async () => {
    const root = await createTempWorkspace();
    rmSync(path.join(root, 'bslt.config.ts'));
    await expect(scaffoldModule('example', { root })).rejects.toThrow(/bslt\.config\.ts/iu);
  });

  it('rejects malformed bslt.config.ts without installedModules array', async () => {
    const root = await createTempWorkspace();
    writeFileSync(path.join(root, 'bslt.config.ts'), 'export default {};\n');
    await expect(scaffoldModule('example', { root })).rejects.toThrow(/bslt\.config\.ts/iu);
  });

  it('rejects unknown module subcommands or missing module id in parseModuleNewArgs', () => {
    expect(() => parseModuleNewArgs([])).toThrow(/subcommand/iu);
    expect(() => parseModuleNewArgs(['delete', 'example'])).toThrow(/subcommand/iu);
    expect(() => parseModuleNewArgs(['new'])).toThrow(/module id/iu);
  });

  it('rejects unknown CLI flags or extra positional arguments in parseModuleNewArgs', () => {
    expect(() => parseModuleNewArgs(['new', 'example', '--unknown'])).toThrow(/unknown option/iu);
    expect(() => parseModuleNewArgs(['new', 'example', 'extra'])).toThrow(/unexpected argument/iu);
  });
});
