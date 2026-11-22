// main/tools/gates/module-graph.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { run } from './module-graph';

const tempDirs: string[] = [];

function writeModule(
  root: string,
  id: string,
  dependsOn: readonly string[],
  tables: readonly string[] = [],
): void {
  const dir = path.join(root, 'main/modules', id);
  mkdirSync(dir, { recursive: true });
  const imports = dependsOn
    .map((dep) => `import { ${dep}Module } from '@bslt/${dep}/module';`)
    .join('\n');
  const depsList = dependsOn.map((dep) => `${dep}Module`).join(', ');
  const tablesList = tables.map((t) => `'${t}'`).join(', ');

  writeFileSync(
    path.join(dir, 'module.ts'),
    `import { defineModule } from '@bslt/contract';
${imports}
export const ${id}Module = defineModule({
  id: '${id}',
  summary: '${id} summary.',
  status: 'stable',
  dependsOn: [${depsList}],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [${tablesList}],
  web: false,
});
`,
  );
  writeFileSync(
    path.join(dir, 'README.md'),
    `# ${id}\n\n<!-- bslt:generated reference -->\n<!-- /bslt:generated -->\n`,
  );
}

function writeConfigAndGraph(
  root: string,
  installedIds: readonly string[],
  graphEntries: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>,
): void {
  const imports = installedIds
    .map((id) => `import { ${id}Module } from '@bslt/${id}/module';`)
    .join('\n');
  const list = installedIds.map((id) => `${id}Module`).join(', ');
  writeFileSync(
    path.join(root, 'bslt.config.ts'),
    `import { defineConfig } from '@bslt/contract';
${imports}
export default defineConfig({
  name: 'BSLT',
  installedModules: [${list}] as const,
  devOnly: [],
  locales: ['en-US'],
  brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
});
`,
  );

  mkdirSync(path.join(root, 'main/tools/generated'), { recursive: true });
  writeFileSync(
    path.join(root, 'main/tools/generated/module-graph.json'),
    JSON.stringify({ modules: graphEntries }, null, 2),
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('module-graph gate', () => {
  it('passes for an acyclic DAG whose module-graph.json and bslt.config.ts agree', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-graph-'));
    tempDirs.push(root);

    writeModule(root, 'identity', []);
    writeModule(root, 'tasks', ['identity'], ['tasks']);
    writeModule(root, 'audit', []);
    writeConfigAndGraph(
      root,
      ['identity', 'tasks', 'audit'],
      [
        { id: 'audit', dependsOn: [] },
        { id: 'identity', dependsOn: [] },
        { id: 'tasks', dependsOn: ['identity'] },
      ],
    );

    const result = run(root);
    expect(result.ok).toBe(true);
  });

  it('fails when modules form a dependency cycle', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-graph-'));
    tempDirs.push(root);

    writeModule(root, 'alpha', ['beta']);
    writeModule(root, 'beta', ['alpha']);
    writeConfigAndGraph(
      root,
      ['alpha', 'beta'],
      [
        { id: 'alpha', dependsOn: ['beta'] },
        { id: 'beta', dependsOn: ['alpha'] },
      ],
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => /cycle/iu.test(p))).toBe(true);
  });

  it('fails when any module lists a projection module in dependsOn', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-graph-'));
    tempDirs.push(root);

    writeModule(root, 'webhooks', []);
    writeModule(root, 'tasks', ['webhooks']);
    writeConfigAndGraph(
      root,
      ['webhooks', 'tasks'],
      [
        { id: 'tasks', dependsOn: ['webhooks'] },
        { id: 'webhooks', dependsOn: [] },
      ],
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('webhooks'))).toBe(true);
  });

  it('fails when main/tools/generated/module-graph.json drifts from module.ts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-graph-'));
    tempDirs.push(root);

    writeModule(root, 'identity', []);
    writeModule(root, 'tasks', ['identity']);
    writeConfigAndGraph(
      root,
      ['identity', 'tasks'],
      [
        { id: 'identity', dependsOn: [] },
        { id: 'tasks', dependsOn: [] },
      ],
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('module-graph.json'))).toBe(true);
  });

  it('fails when bslt.config.ts omits or misorders a required dependency', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-graph-'));
    tempDirs.push(root);

    writeModule(root, 'identity', []);
    writeModule(root, 'tasks', ['identity']);
    writeConfigAndGraph(
      root,
      ['tasks'],
      [
        { id: 'identity', dependsOn: [] },
        { id: 'tasks', dependsOn: ['identity'] },
      ],
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('identity'))).toBe(true);
  });

  it('fails when a module table has a catalog foreign key to a module not in dependsOn', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bslt-module-graph-'));
    tempDirs.push(root);

    writeModule(root, 'identity', [], ['users']);
    writeModule(root, 'tasks', [], ['tasks']);
    writeConfigAndGraph(
      root,
      ['identity', 'tasks'],
      [
        { id: 'identity', dependsOn: [] },
        { id: 'tasks', dependsOn: [] },
      ],
    );

    mkdirSync(path.join(root, 'main/kernel/db'), { recursive: true });
    writeFileSync(
      path.join(root, 'main/kernel/db/catalog.snapshot.json'),
      JSON.stringify(
        {
          generated: '@generated',
          sources: [
            { id: 'kernel', dependsOn: [] },
            { id: 'identity', dependsOn: [] },
            { id: 'tasks', dependsOn: [] },
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
              name: 'users',
              source: 'identity',
              kind: 'table',
              owner: 'bslt_owner',
              comment: 'rls:admin_or_self',
              rowSecurity: { enabled: true, forced: true },
              partition: null,
              columns: ['id uuid NOT NULL'],
              constraints: ['users_pkey PRIMARY KEY (id)'],
              indexes: [],
              policies: [],
              triggers: [],
              grants: [],
              columnGrants: [],
            },
            {
              schema: 'public',
              name: 'tasks',
              source: 'tasks',
              kind: 'table',
              owner: 'bslt_owner',
              comment: 'rls:owner_user',
              rowSecurity: { enabled: true, forced: true },
              partition: null,
              columns: ['id uuid NOT NULL', 'owner_user_id uuid NOT NULL'],
              constraints: [
                'tasks_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE',
                'tasks_pkey PRIMARY KEY (id)',
              ],
              indexes: [],
              policies: [],
              triggers: [],
              grants: [],
              columnGrants: [],
            },
          ],
          views: [],
        },
        null,
        2,
      ),
    );

    const result = run(root);
    expect(result.ok).toBe(false);
    expect(result.problems?.some((p) => p.includes('tasks_owner_user_id_fkey'))).toBe(true);
    expect(result.problems?.some((p) => p.includes('tasks.dependsOn'))).toBe(true);
  });
});
