// main/tools/sync/modules.test.ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run, syncModules } from './modules';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bslt-sync-modules-'));
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
          '@bslt/obsolete': 'workspace:*',
          '@bslt/tools': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  // App skeletons
  mkdirSync(path.join(dir, 'main/apps/server/src'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/apps/server/package.json'),
    JSON.stringify(
      {
        name: '@bslt/server',
        version: '1.0.0',
        dependencies: {
          '@bslt/db': 'workspace:*',
          '@bslt/server-system': 'workspace:*',
          '@bslt/obsolete': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, 'main/apps/server/tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: { composite: true },
        references: [{ path: '../../kernel/server' }, { path: '../../modules/obsolete' }],
      },
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
        dependencies: {
          '@bslt/client-engine': 'workspace:*',
          '@bslt/react': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, 'main/apps/web/tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: { composite: true },
        references: [{ path: '../../kernel/react' }],
      },
      null,
      2,
    ),
  );

  // Module 1: identity (shell, web: false)
  mkdirSync(path.join(dir, 'main/modules/identity/server'), { recursive: true });
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
  create: () => ({}),
  handlers: {},
});
`,
  );
  writeFileSync(
    path.join(dir, 'main/modules/identity/README.md'),
    `# Identity\n\nHand intro.\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
  );

  // Module 2: tasks (depends on identity, has contract + server + web)
  mkdirSync(path.join(dir, 'main/modules/tasks/contract'), { recursive: true });
  mkdirSync(path.join(dir, 'main/modules/tasks/server'), { recursive: true });
  mkdirSync(path.join(dir, 'main/modules/tasks/web'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/modules/tasks/contract/endpoints.ts'),
    `import { endpoint } from '@bslt/contract';

export const tasksEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/api/tasks',
    auth: 'user',
    response: tasksListSchema,
    summary: 'List tasks for the current user.',
  }),
};
`,
  );
  writeFileSync(
    path.join(dir, 'main/modules/tasks/module.ts'),
    `import { defineModule } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { tasksEndpoints } from './contract';

export const tasksModule = defineModule({
  id: 'tasks',
  summary: 'User-owned task list.',
  status: 'stable',
  dependsOn: [identityModule],
  endpoints: tasksEndpoints,
  events: {},
  jobs: {},
  tables: ['tasks'],
});
`,
  );
  writeFileSync(
    path.join(dir, 'main/modules/tasks/server/index.ts'),
    `import { implementServer } from '@bslt/server-system/module';
import { tasksModule } from '../module';
export const tasksServer = implementServer(tasksModule, {
  create: () => ({}),
  handlers: { list: async () => ({ tasks: [] }) },
});
`,
  );
  writeFileSync(
    path.join(dir, 'main/modules/tasks/web/index.ts'),
    `import { implementWeb } from '@bslt/web-platform';
import { tasksModule } from '../module';
export const tasksWeb = implementWeb(tasksModule, {
  routes: [],
  messages: {},
});
`,
  );
  writeFileSync(
    path.join(dir, 'main/modules/tasks/README.md'),
    `# Tasks\n\nReference module.\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
  );

  // Uninstalled module directory to verify obsolete workspace cleanup
  mkdirSync(path.join(dir, 'main/modules/obsolete/server'), { recursive: true });
  writeFileSync(
    path.join(dir, 'main/modules/obsolete/module.ts'),
    `import { defineModule } from '@bslt/contract';
export const obsoleteModule = defineModule({
  id: 'obsolete',
  summary: 'Uninstalled module.',
  status: 'experimental',
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
    path.join(dir, 'main/modules/obsolete/README.md'),
    `# Obsolete\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
  );

  writeFileSync(
    path.join(dir, 'bslt.config.ts'),
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

describe('bslt sync modules', () => {
  it('generates server/web module bindings, module-graph.json, package.json deps, tsconfig refs, and README blocks', async () => {
    const root = createTempWorkspace();
    const result = await syncModules({ root });
    expect(result.stale.length).toBeGreaterThan(0);

    const serverModules = readFileSync(
      path.join(root, 'main/apps/server/src/generated/modules.ts'),
      'utf8',
    );
    expect(serverModules).toContain('export const installedModules: readonly [');
    expect(serverModules).toContain(
      'export const installedServerModules: ServerImpls<typeof installedModules> =',
    );
    expect(serverModules).toContain('satisfies ServerImpls<typeof installedModules>');
    expect(serverModules).toContain('identityServer');
    expect(serverModules).toContain('tasksServer');

    const webModules = readFileSync(
      path.join(root, 'main/apps/web/src/generated/modules.ts'),
      'utf8',
    );
    expect(webModules).toContain('export const installedModules: readonly [');
    expect(webModules).toContain(
      'export const installedWebModules: WebImpls<typeof installedModules> =',
    );
    expect(webModules).toContain('satisfies WebImpls<typeof installedModules>');
    expect(webModules).toContain('null');
    expect(webModules).toContain('tasksWeb');
    expect(webModules).not.toContain('identityWeb');

    const graph = JSON.parse(
      readFileSync(path.join(root, 'main/tools/generated/module-graph.json'), 'utf8'),
    ) as { modules: Array<{ id: string; dependsOn: string[] }> };
    expect(graph.modules).toEqual([
      { id: 'identity', dependsOn: [] },
      { id: 'obsolete', dependsOn: [] },
      { id: 'tasks', dependsOn: ['identity'] },
    ]);

    const serverPkg = JSON.parse(
      readFileSync(path.join(root, 'main/apps/server/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(serverPkg.dependencies['@bslt/identity']).toBe('workspace:*');
    expect(serverPkg.dependencies['@bslt/tasks']).toBe('workspace:*');
    expect(serverPkg.dependencies['@bslt/obsolete']).toBeUndefined();

    const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(rootPkg.devDependencies['@bslt/contract']).toBe('workspace:*');
    expect(rootPkg.devDependencies['@bslt/identity']).toBe('workspace:*');
    expect(rootPkg.devDependencies['@bslt/tasks']).toBe('workspace:*');
    expect(rootPkg.devDependencies['@bslt/obsolete']).toBeUndefined();

    const serverTsconfig = JSON.parse(
      readFileSync(path.join(root, 'main/apps/server/tsconfig.json'), 'utf8'),
    ) as { references: Array<{ path: string }> };
    expect(serverTsconfig.references).toEqual([
      { path: '../../kernel/server' },
      { path: '../../modules/identity' },
      { path: '../../modules/tasks' },
    ]);

    const tasksReadme = readFileSync(
      path.join(dirOf(root, 'main/modules/tasks/README.md')),
      'utf8',
    );
    expect(tasksReadme).toContain('Reference module.');
    expect(tasksReadme).toContain('/api/tasks');
    expect(tasksReadme).toContain('`tasks`');
  });

  it('is idempotent and passes check mode when up to date', async () => {
    const root = createTempWorkspace();
    await syncModules({ root });
    const second = await syncModules({ root, check: true });
    expect(second.stale).toEqual([]);
    expect(second.orphans).toEqual([]);

    const gateResult = await run({ root });
    expect(gateResult.ok).toBe(true);
  });

  it('fails check mode when a generated file drifts from bslt.config.ts', async () => {
    const root = createTempWorkspace();
    await syncModules({ root });
    writeFileSync(
      path.join(root, 'main/apps/server/src/generated/modules.ts'),
      '// drifted hand edit\n',
    );

    const gateResult = await run({ root });
    expect(gateResult.ok).toBe(false);
    expect(gateResult.problems?.some((line) => line.includes('generated/modules.ts'))).toBe(true);
  });

  it('fails check mode and deletes orphan files in generated directories', async () => {
    const root = createTempWorkspace();
    await syncModules({ root });
    const orphanPath = path.join(root, 'main/apps/server/src/generated/orphan.ts');
    writeFileSync(orphanPath, 'export const stray = 1;\n');

    const gateResult = await run({ root });
    expect(gateResult.ok).toBe(false);
    expect(gateResult.problems?.some((line) => line.includes('orphan.ts'))).toBe(true);

    const cleaned = await syncModules({ root });
    expect(cleaned.orphans).toEqual(['main/apps/server/src/generated/orphan.ts']);
  });

  it('rejects bslt.config.ts when a module precedes its dependsOn dependency', async () => {
    const root = createTempWorkspace();
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { tasksModule } from '@bslt/tasks/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [tasksModule, identityModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );

    await expect(syncModules({ root })).rejects.toThrow(/dependsOn.*identity/iu);
  });

  it('rejects bslt.config.ts when an installed module directory does not exist', async () => {
    const root = createTempWorkspace();
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { ghostModule } from '@bslt/ghost/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [ghostModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );

    await expect(syncModules({ root })).rejects.toThrow(/ghost/iu);
  });

  it('rejects duplicate entries in installedModules', async () => {
    const root = createTempWorkspace();
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule, identityModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );

    await expect(syncModules({ root })).rejects.toThrow(/duplicate.*identity/iu);
  });

  it('rejects a module README.md that lacks the generated reference markers', async () => {
    const root = createTempWorkspace();
    writeFileSync(path.join(root, 'main/modules/tasks/README.md'), '# Tasks without markers\n');

    await expect(syncModules({ root })).rejects.toThrow(/bslt:generated reference/iu);
  });

  it('renders event names and (webhook) markers in generated module README blocks', async () => {
    const root = createTempWorkspace();
    writeFileSync(
      path.join(root, 'main/modules/tasks/contract/events.ts'),
      `import { event } from '@bslt/contract';
export const tasksEvents = {
  created: event('tasks.task.created', payloadSchema, { webhook: true }),
  archived: event('tasks.task.archived', payloadSchema),
};
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/tasks/module.ts'),
      `import { defineModule } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { tasksEndpoints } from './contract';
import { tasksEvents } from './contract/events';

export const tasksModule = defineModule({
  id: 'tasks',
  summary: 'User-owned task list.',
  status: 'stable',
  dependsOn: [identityModule],
  endpoints: tasksEndpoints,
  events: tasksEvents,
  jobs: {},
  tables: ['tasks'],
});
`,
    );

    await syncModules({ root });
    const tasksReadme = readFileSync(path.join(root, 'main/modules/tasks/README.md'), 'utf8');
    expect(tasksReadme).toContain('`tasks.task.created` (webhook)');
    expect(tasksReadme).toContain('`tasks.task.archived`');
    expect(tasksReadme).not.toContain('`tasks.task.archived` (webhook)');
  });

  it('emits devOnlyModules/devOnlyServerModules/devOnlyWebModules separately from installedModules and rejects invalid devOnly configs', async () => {
    const root = createTempWorkspace();
    mkdirSync(path.join(root, 'main/modules/devtools/server'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/devtools/web'), { recursive: true });
    writeFileSync(
      path.join(root, 'main/modules/devtools/module.ts'),
      `import { defineModule } from '@bslt/contract';
export const devtoolsModule = defineModule({
  id: 'devtools',
  summary: 'Developer route explorer and UI catalog.',
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
      path.join(root, 'main/modules/devtools/server/index.ts'),
      `import { implementServer } from '@bslt/server-system/module';
import { devtoolsModule } from '../module';
export const devtoolsServer = implementServer(devtoolsModule, {
  create: () => ({}),
  handlers: {},
});
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/devtools/web/index.ts'),
      `import { implementWeb } from '@bslt/web-platform';
import { devtoolsModule } from '../module';
export const devtoolsWeb = implementWeb(devtoolsModule, {
  routes: [],
  messages: {},
});
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/devtools/README.md'),
      `# Devtools\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
    );

    // Failure 1: module listed in both installedModules and devOnly
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { devtoolsModule } from '@bslt/devtools/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule, devtoolsModule] as const,
  devOnly: [devtoolsModule],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );
    await expect(syncModules({ root })).rejects.toThrow(/duplicate.*devtools/iu);

    // Failure 2: duplicate entry inside devOnly
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { devtoolsModule } from '@bslt/devtools/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule] as const,
  devOnly: [devtoolsModule, devtoolsModule],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );
    await expect(syncModules({ root })).rejects.toThrow(/duplicate.*devtools/iu);

    // Failure 3: devOnly module depends on an uninstalled module
    writeFileSync(
      path.join(root, 'main/modules/devtools/module.ts'),
      `import { defineModule } from '@bslt/contract';
import { obsoleteModule } from '@bslt/obsolete/module';
export const devtoolsModule = defineModule({
  id: 'devtools',
  summary: 'Developer route explorer and UI catalog.',
  status: 'stable',
  dependsOn: [obsoleteModule],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
});
`,
    );
    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { devtoolsModule } from '@bslt/devtools/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule] as const,
  devOnly: [devtoolsModule],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );
    await expect(syncModules({ root })).rejects.toThrow(/obsolete.*installedModules/iu);

    // Valid devOnly setup: absent from installedModules, emitted in devOnlyModules
    writeFileSync(
      path.join(root, 'main/modules/devtools/module.ts'),
      `import { defineModule } from '@bslt/contract';
export const devtoolsModule = defineModule({
  id: 'devtools',
  summary: 'Developer route explorer and UI catalog.',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
});
`,
    );
    await syncModules({ root });
    const serverModules = readFileSync(
      path.join(root, 'main/apps/server/src/generated/modules.ts'),
      'utf8',
    );
    const webModules = readFileSync(
      path.join(root, 'main/apps/web/src/generated/modules.ts'),
      'utf8',
    );
    expect(serverModules).toContain('export const devOnlyModules: readonly [');
    expect(serverModules).toContain(
      'export const devOnlyServerModules: ServerImpls<typeof devOnlyModules> =',
    );
    expect(serverModules).toContain('devtoolsServer');
    expect(webModules).toContain('export const devOnlyModules: readonly [');
    expect(webModules).toContain(
      'export const devOnlyWebModules: WebImpls<typeof devOnlyModules> =',
    );
    expect(webModules).toContain('devtoolsWeb');
  });

  it('emits Minimal Core no-op fallbacks when optional modules are absent and delegates when installed', async () => {
    const root = createTempWorkspace();
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          name: '@bslt/root',
          private: true,
          scripts: {
            postbuild:
              'bslt-esm-fix main/kernel/schema/dist main/modules/identity/dist main/modules/obsolete/dist main/apps/server/dist && bslt gate run esm-dist',
          },
          devDependencies: {
            '@bslt/build-config': 'workspace:*',
            '@bslt/obsolete': 'workspace:*',
            '@bslt/tools': 'workspace:*',
          },
        },
        null,
        2,
      ),
    );
    mkdirSync(path.join(root, 'tests'), { recursive: true });
    writeFileSync(
      path.join(root, 'tests/package.json'),
      JSON.stringify(
        {
          name: '@bslt/tests',
          private: true,
          devDependencies: {
            '@bslt/identity': 'workspace:*',
            '@bslt/obsolete': 'workspace:*',
            '@bslt/testing': 'workspace:*',
          },
        },
        null,
        2,
      ),
    );

    await syncModules({ root });

    const coreServer = readFileSync(
      path.join(root, 'main/apps/server/src/generated/modules.ts'),
      'utf8',
    );
    expect(coreServer).toContain('export function resolveActingOrg(');
    expect(coreServer).not.toContain('@bslt/orgs/server');

    const coreWeb = readFileSync(path.join(root, 'main/apps/web/src/generated/modules.ts'), 'utf8');
    expect(coreWeb).toContain('export const hasFilesModule: boolean = false;');
    expect(coreWeb).toContain('export const hasAdminModule: boolean = false;');
    expect(coreWeb).toContain('export const hasOrgsModule: boolean = false;');
    expect(coreWeb).toContain('export const hasBillingModule: boolean = false;');
    expect(coreWeb).toContain('export function OptionalImpersonationBanner(');
    expect(coreWeb).toContain('export function OptionalOrgSwitcher(');
    expect(coreWeb).toContain('export function OptionalHeaderNotifications(');
    expect(coreWeb).toContain('export function OptionalAvatarUpload(');
    expect(coreWeb).toContain('export function OptionalNotificationPreferencesForm(');
    expect(coreWeb).toContain('export function useOptionalMyAvatar(');
    expect(coreWeb).toContain('export function useOptionalAdminHealth(');
    expect(coreWeb).toContain('export function useOptionalAdminPlans(');
    expect(coreWeb).toContain('export function useOptionalAdminOrgs(');
    expect(coreWeb).not.toContain('@bslt/admin/web');
    expect(coreWeb).not.toContain('@bslt/files/web');
    expect(coreWeb).not.toContain('@bslt/notifications/web');
    expect(coreWeb).not.toContain('@bslt/orgs/web');
    expect(coreWeb).not.toContain('@bslt/billing/web');

    const corePublicWeb = readFileSync(
      path.join(root, 'main/apps/web/src/generated/public-modules.ts'),
      'utf8',
    );
    expect(corePublicWeb).toContain('export const installedPublicSsrModules = [');
    expect(corePublicWeb).toContain(
      'export const installedPublicSsrRoutes: readonly PublicRoute<unknown>[] = [',
    );

    const syncedRootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: { postbuild: string };
    };
    expect(syncedRootPkg.scripts.postbuild).toBe(
      'bslt-esm-fix main/kernel/schema/dist main/modules/identity/dist main/modules/tasks/dist main/apps/server/dist && bslt gate run esm-dist',
    );

    const syncedTestsPkg = JSON.parse(
      readFileSync(path.join(root, 'tests/package.json'), 'utf8'),
    ) as { devDependencies: Record<string, string> };
    expect(syncedTestsPkg.devDependencies['@bslt/identity']).toBe('workspace:*');
    expect(syncedTestsPkg.devDependencies['@bslt/obsolete']).toBeUndefined();

    // Now install orgs + status (with public-routes) and verify delegating bindings
    mkdirSync(path.join(root, 'main/modules/orgs/server'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/orgs/web'), { recursive: true });
    writeFileSync(
      path.join(root, 'main/modules/orgs/module.ts'),
      `import { defineModule } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
export const orgsModule = defineModule({
  id: 'orgs',
  summary: 'Organizations.',
  status: 'stable',
  dependsOn: [identityModule],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
});
`,
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/server/index.ts'),
      `export const orgsServer = {};\nexport const resolveActingOrg = async () => null;\n`,
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/web/index.ts'),
      `export const orgsWeb = {};\nexport const OrgSwitcher = () => null;\nexport const useAdminOrgs = () => ({ tenants: [], total: 0, isLoading: false, error: null, refresh: async () => {} });\n`,
    );
    writeFileSync(
      path.join(root, 'main/modules/orgs/README.md'),
      `# Orgs\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
    );

    mkdirSync(path.join(root, 'main/modules/status/server'), { recursive: true });
    mkdirSync(path.join(root, 'main/modules/status/web'), { recursive: true });
    writeFileSync(
      path.join(root, 'main/modules/status/module.ts'),
      `import { defineModule } from '@bslt/contract';
export const statusModule = defineModule({
  id: 'status',
  summary: 'Public status.',
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
      path.join(root, 'main/modules/status/server/index.ts'),
      `export const statusServer = {};\n`,
    );
    writeFileSync(
      path.join(root, 'main/modules/status/web/public-routes.tsx'),
      `export const statusPublicRoutes = [];\n`,
    );
    writeFileSync(
      path.join(root, 'main/modules/status/web/index.ts'),
      `export const statusWeb = {};\nexport { statusPublicRoutes } from './public-routes';\n`,
    );
    writeFileSync(
      path.join(root, 'main/modules/status/README.md'),
      `# Status\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
    );

    writeFileSync(
      path.join(root, 'bslt.config.ts'),
      `import { defineConfig } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';
import { orgsModule } from '@bslt/orgs/module';
import { statusModule } from '@bslt/status/module';

export default defineConfig({
  name: 'BSLT',
  installedModules: [identityModule, orgsModule, statusModule] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
    );

    await syncModules({ root });

    const withOrgsServer = readFileSync(
      path.join(root, 'main/apps/server/src/generated/modules.ts'),
      'utf8',
    );
    expect(withOrgsServer).toContain(
      "import { orgsServer, resolveActingOrg } from '@bslt/orgs/server';",
    );
    expect(withOrgsServer).toContain('export { resolveActingOrg };');

    const withOrgsWeb = readFileSync(
      path.join(root, 'main/apps/web/src/generated/modules.ts'),
      'utf8',
    );
    expect(withOrgsWeb).toContain('export const hasOrgsModule: boolean = true;');
    expect(withOrgsWeb).toContain('OrgSwitcher as OptionalOrgSwitcher');
    expect(withOrgsWeb).toContain('useAdminOrgs as useOptionalAdminOrgs');

    const withStatusPublic = readFileSync(
      path.join(root, 'main/apps/web/src/generated/public-modules.ts'),
      'utf8',
    );
    expect(withStatusPublic).toContain("import { statusModule } from '@bslt/status/module';");
    expect(withStatusPublic).toContain("import { statusPublicRoutes } from '@bslt/status/web';");
  });
});

function dirOf(root: string, rel: string): string {
  return path.join(root, rel);
}
