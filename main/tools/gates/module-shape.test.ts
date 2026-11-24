// main/tools/gates/module-shape.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run } from './module-shape';

const tempDirs: string[] = [];

function createValidModuleWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-shape-'));
  tempDirs.push(root);

  const modDir = path.join(root, 'main/modules/tasks');
  mkdirSync(path.join(modDir, 'contract'), { recursive: true });
  mkdirSync(path.join(modDir, 'server/migrations'), { recursive: true });
  mkdirSync(path.join(modDir, 'web'), { recursive: true });
  mkdirSync(path.join(modDir, 'i18n'), { recursive: true });

  writeFileSync(
    path.join(modDir, 'package.json'),
    JSON.stringify({ name: '@bslt/tasks', version: '1.0.0', type: 'module' }, null, 2),
  );
  writeFileSync(
    path.join(modDir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { composite: true } }, null, 2),
  );
  writeFileSync(
    path.join(modDir, 'vitest.config.ts'),
    "export const isCI = process.env.CI === 'true';\n",
  );
  writeFileSync(
    path.join(modDir, 'README.md'),
    '# Tasks\n\n<!-- bslt:generated reference -->\ngenerated\n<!-- /bslt:generated -->\n',
  );
  writeFileSync(
    path.join(modDir, 'contract/endpoints.ts'),
    `import { endpoint } from '@bslt/contract';
export const tasksEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/api/tasks',
    auth: 'user',
    response: listSchema,
    summary: 'List tasks.',
  }),
};
`,
  );
  writeFileSync(
    path.join(modDir, 'module.ts'),
    `import { defineModule } from '@bslt/contract';
import { tasksEndpoints } from './contract/endpoints';

export const tasksModule = defineModule({
  id: 'tasks',
  summary: 'Tasks module.',
  status: 'stable',
  dependsOn: [],
  endpoints: tasksEndpoints,
  events: {},
  jobs: {},
  tables: ['tasks'],
});
`,
  );
  writeFileSync(
    path.join(modDir, 'server/index.ts'),
    `import { implementServer } from '@bslt/server-system/module';
import { tasksModule } from '../module';
export const tasksServer = implementServer(tasksModule, {
  create: () => ({}),
  handlers: { list: async () => ({ tasks: [] }) },
});
`,
  );
  writeFileSync(
    path.join(modDir, 'server/migrations/0001_tasks.sql'),
    `CREATE TABLE tasks (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL);\nSELECT sys_apply_rls('tasks', 'owner_user', 'owner_user_id');\n`,
  );
  writeFileSync(
    path.join(modDir, 'server/repository.real-db.test.ts'),
    `describeOwnerIsolation(realDb, [{ table: 'tasks', seedRow: async () => 'id' }]);\n`,
  );
  writeFileSync(
    path.join(modDir, 'i18n/en-US.json'),
    JSON.stringify({ 'tasks.title': 'Tasks', 'tasks.nav': 'Tasks' }, null, 2),
  );
  writeFileSync(
    path.join(modDir, 'web/index.ts'),
    `import { implementWeb, lazyModulePage } from '@bslt/web-platform';
import enUs from '../i18n/en-US.json';
import { tasksModule } from '../module';
export const tasksWeb = implementWeb(tasksModule, {
  routes: [{ path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.title', page: lazyModulePage(() => import('./TasksPage'), 'TasksPage') }],
  nav: [{ to: '/tasks', slot: 'app.primary', label: 'tasks.nav', icon: 'check-square', order: 40 }],
  messages: enUs,
});
`,
  );
  writeFileSync(
    path.join(modDir, 'web/TasksPage.tsx'),
    `import { useModuleMessages } from '@bslt/web-platform';
import enUs from '../i18n/en-US.json';
export function TasksPage() {
  const t = useModuleMessages(enUs);
  return <h1>{t('tasks.title')}</h1>;
}
`,
  );

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('module-shape gate', () => {
  it('passes for a canonical full module and a web: false shell module', () => {
    const root = createValidModuleWorkspace();
    const shellDir = path.join(root, 'main/modules/identity');
    mkdirSync(path.join(shellDir, 'server'), { recursive: true });
    writeFileSync(
      path.join(shellDir, 'package.json'),
      JSON.stringify({ name: '@bslt/identity', version: '1.0.0' }),
    );
    writeFileSync(path.join(shellDir, 'tsconfig.json'), '{}');
    writeFileSync(
      path.join(shellDir, 'README.md'),
      '# Identity\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n',
    );
    writeFileSync(
      path.join(shellDir, 'module.ts'),
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
    writeFileSync(path.join(shellDir, 'server/index.ts'), 'export const identityServer = {};\n');

    const result = run(root);
    expect(result.ok).toBe(true);
  });

  it('fails when an unexpected top-level file or folder appears inside a module', () => {
    const root = createValidModuleWorkspace();
    writeFileSync(path.join(root, 'main/modules/tasks/random-helper.ts'), 'export const x = 1;\n');

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('random-helper.ts'))).toBe(true);
  });

  it('fails when server/migrations contains non-contiguous or malformed migration files, and allows contiguous forward migrations', () => {
    const validRoot = createValidModuleWorkspace();
    writeFileSync(
      path.join(validRoot, 'main/modules/tasks/server/migrations/0002_alter.sql'),
      'ALTER TABLE tasks ADD COLUMN notes text;\n',
    );
    expect(run(validRoot).ok).toBe(true);

    const gapRoot = createValidModuleWorkspace();
    writeFileSync(
      path.join(gapRoot, 'main/modules/tasks/server/migrations/0003_skip.sql'),
      'ALTER TABLE tasks ADD COLUMN notes text;\n',
    );
    const gapResult = run(gapRoot);
    expect(gapResult.ok).toBe(false);
    expect(gapResult.problems?.some((p) => p.includes('0003_skip.sql'))).toBe(true);

    const badNameRoot = createValidModuleWorkspace();
    writeFileSync(
      path.join(badNameRoot, 'main/modules/tasks/server/migrations/notes.sql'),
      'ALTER TABLE tasks ADD COLUMN notes text;\n',
    );
    const badNameResult = run(badNameRoot);
    expect(badNameResult.ok).toBe(false);
    expect(badNameResult.problems?.some((p) => p.includes('notes.sql'))).toBe(true);
  });

  it('fails when i18n/en-US.json contains unprefixed or unused keys', () => {
    const root = createValidModuleWorkspace();
    writeFileSync(
      path.join(root, 'main/modules/tasks/i18n/en-US.json'),
      JSON.stringify(
        {
          'tasks.title': 'Tasks',
          'tasks.nav': 'Tasks',
          'tasks.unusedKey': 'Never referenced',
          'other.badPrefix': 'Wrong prefix',
        },
        null,
        2,
      ),
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('other.badPrefix'))).toBe(true);
    expect(result.problems?.some((p) => p.includes('tasks.unusedKey'))).toBe(true);
  });

  it('fails when web/**/*.tsx contains raw JSX text literals instead of t()', () => {
    const root = createValidModuleWorkspace();
    writeFileSync(
      path.join(root, 'main/modules/tasks/web/TasksPage.tsx'),
      `export function TasksPage() {
  return <h1>Hardcoded Heading</h1>;
}
`,
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('JSX text literal'))).toBe(true);
  });

  it('fails when web/**/*.tsx passes string or template literals inside JSX expression attributes on user-facing props', () => {
    const root = createValidModuleWorkspace();
    writeFileSync(
      path.join(root, 'main/modules/tasks/web/TasksPage.tsx'),
      `import { useModuleMessages } from '@bslt/web-platform';
import enUs from '../i18n/en-US.json';
export function TasksPage() {
  const t = useModuleMessages(enUs);
  const count = 3;
  return (
    <div aria-label={'Hardcoded Aria'} title={\`Count \${String(count)}\`}>
      {t('tasks.title')}
      {t('tasks.nav')}
    </div>
  );
}
`,
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.filter((p) => p.includes('JSX attribute')).length).toBe(2);
  });

  it('fails when module production code reads process.env directly', () => {
    const root = createValidModuleWorkspace();
    writeFileSync(
      path.join(root, 'main/modules/tasks/server/service.ts'),
      `export const secret = process.env['SECRET_KEY'];\n`,
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('process.env'))).toBe(true);
  });

  it('fails when an owner-isolated table lacks a describeOwnerIsolation case', () => {
    const root = createValidModuleWorkspace();
    rmSync(path.join(root, 'main/modules/tasks/server/repository.real-db.test.ts'));

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('describeOwnerIsolation'))).toBe(true);
  });

  it('fails when server registers event subscribers without a runSubscriberTwice test, and passes with one', () => {
    const root = createValidModuleWorkspace();
    writeFileSync(
      path.join(root, 'main/modules/tasks/server/index.ts'),
      `import { implementServer, onFlagged } from '@bslt/server-system/module';
import { tasksModule } from '../module';
export const tasksServer = implementServer(tasksModule, {
  create: () => ({}),
  handlers: { list: async () => ({ tasks: [] }) },
  subscribers: [
    onFlagged('webhook', {
      id: 'fanout',
      handle: async () => {},
    }),
  ],
});
`,
    );

    const missing = run(root);
    expect(missing.ok).toBe(false);
    expect(missing.problems?.some((p) => p.includes('runSubscriberTwice'))).toBe(true);

    writeFileSync(
      path.join(root, 'main/modules/tasks/server/index.test.ts'),
      `import { runSubscriberTwice } from '@bslt/server-system/testing/subscribers';
it('is idempotent', async () => {
  await runSubscriberTwice(async () => {}, event);
});
`,
    );

    const passing = run(root);
    expect(passing.ok).toBe(true);
  });

  it('allows module seeds/ and numbered server/migrations/seeds/*.sql while rejecting unnumbered migration seed files', () => {
    const root = createValidModuleWorkspace();
    mkdirSync(path.join(root, 'main/modules/tasks/seeds'), { recursive: true });
    writeFileSync(path.join(root, 'main/modules/tasks/seeds/template.md'), '# Seed\n');

    mkdirSync(path.join(root, 'main/modules/tasks/server/migrations/seeds'), { recursive: true });
    writeFileSync(path.join(root, 'main/modules/tasks/server/migrations/seeds/bad.txt'), 'invalid');
    const invalid = run(root);
    expect(invalid.ok).toBe(false);
    expect(invalid.problems?.some((p) => p.includes('server/migrations/seeds/bad.txt'))).toBe(true);

    rmSync(path.join(root, 'main/modules/tasks/server/migrations/seeds/bad.txt'));
    writeFileSync(
      path.join(root, 'main/modules/tasks/server/migrations/seeds/0001_templates.sql'),
      '-- seed\n',
    );
    const valid = run(root);
    expect(valid.ok).toBe(true);
  });
});
