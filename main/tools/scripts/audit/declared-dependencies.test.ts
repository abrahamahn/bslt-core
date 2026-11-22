// main/tools/scripts/audit/declared-dependencies.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  auditDeclaredDependencies,
  collectImports,
  copiedPackageDirs,
  deployedPackages,
  packageNameOf,
  productionPackages,
  run,
  workspacePackages,
} from './declared-dependencies';

const fixtures: string[] = [];

/** Writes a fixture repository (`relative path -> content`) and returns its root. */
function fixtureRepo(files: Readonly<Record<string, string | object>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'declared-deps-'));
  fixtures.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

const WORKSPACE = "packages:\n  - 'apps/*'\n  - 'libs/*'\n  - 'tests'\n";

describe('collectImports', () => {
  it('finds every form of module reference, type-only ones marked', () => {
    const source = [
      '/// <reference types="vite/client" />',
      "import a from 'static-default';",
      "import { b } from '@scope/named/sub/path';",
      "import 'side-effect';",
      "import type { T } from 'types-only';",
      "export { c } from 're-export';",
      "export * from 'star-export';",
      "export type { U } from 'type-re-export';",
      "import x = require('import-equals');",
      "const d = await import('dynamic');",
      "const e = require('commonjs');",
      "const f = require.resolve('resolved');",
      "vi.mock('mocked', () => ({}));",
      "vi.doMock('do-mocked');",
      "const g = await vi.importActual<typeof import('in-type-position')>('actual');",
      "const h = await vi.importMock('import-mock');",
      'const i = await import(`template-literal`);',
      'const notAModule = await import(dynamicName);',
      'const alsoNot = require(`prefix-${name}`);',
    ].join('\n');

    expect(collectImports('file.ts', source)).toEqual([
      { specifier: 'vite/client', typeOnly: true, line: 1 },
      { specifier: 'static-default', typeOnly: false, line: 2 },
      { specifier: '@scope/named/sub/path', typeOnly: false, line: 3 },
      { specifier: 'side-effect', typeOnly: false, line: 4 },
      { specifier: 'types-only', typeOnly: true, line: 5 },
      { specifier: 're-export', typeOnly: false, line: 6 },
      { specifier: 'star-export', typeOnly: false, line: 7 },
      { specifier: 'type-re-export', typeOnly: true, line: 8 },
      { specifier: 'import-equals', typeOnly: false, line: 9 },
      { specifier: 'dynamic', typeOnly: false, line: 10 },
      { specifier: 'commonjs', typeOnly: false, line: 11 },
      { specifier: 'resolved', typeOnly: false, line: 12 },
      { specifier: 'mocked', typeOnly: false, line: 13 },
      { specifier: 'do-mocked', typeOnly: false, line: 14 },
      { specifier: 'actual', typeOnly: false, line: 15 },
      { specifier: 'in-type-position', typeOnly: true, line: 15 },
      { specifier: 'import-mock', typeOnly: false, line: 16 },
      { specifier: 'template-literal', typeOnly: false, line: 17 },
    ]);
  });

  it('treats every reference in a declaration file as type-only', () => {
    expect(collectImports('globals.d.ts', "import 'augmented';")).toEqual([
      { specifier: 'augmented', typeOnly: true, line: 1 },
    ]);
  });
});

describe('packageNameOf', () => {
  it.each([
    ['ws', 'ws'],
    ['lodash/fp', 'lodash'],
    ['@scope/name', '@scope/name'],
    ['@scope/name/deep/sub', '@scope/name'],
    ['pkg/file.svg?url', 'pkg'],
  ])('%s belongs to %s', (specifier, name) => {
    expect(packageNameOf(specifier)).toBe(name);
  });

  it.each([
    'node:fs',
    'node:test',
    'fs',
    'fs/promises',
    'path',
    './relative',
    '../up',
    '/absolute',
    '#app/features/x',
    'virtual:pwa-register',
    '@scope',
    '',
  ])('%s is not a package', (specifier) => {
    expect(packageNameOf(specifier)).toBeUndefined();
  });
});

describe('workspace and image discovery', () => {
  const repo = (): string =>
    fixtureRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'package.json': { name: '@fx/root', private: true },
      'apps/server/package.json': {
        name: '@fx/server',
        dependencies: { '@fx/lib': 'workspace:*' },
      },
      'apps/web/package.json': { name: '@fx/web' },
      'libs/lib/package.json': {
        name: '@fx/lib',
        dependencies: { '@fx/leaf': 'workspace:*' },
        devDependencies: { '@fx/dev-only': 'workspace:*' },
      },
      'libs/leaf/package.json': { name: '@fx/leaf' },
      'libs/dev-only/package.json': { name: '@fx/dev-only' },
      'libs/capability/package.json': { name: '@fx/capability' },
      'libs/no-manifest/README': 'not a package',
      'tests/package.json': { name: '@fx/tests' },
      'infra/Dockerfile': [
        'FROM node AS build',
        'RUN pnpm install --frozen-lockfile && \\',
        '    pnpm --filter "@fx/server..." build && \\',
        '    pnpm --filter @fx/server deploy --prod --legacy /app/out',
        'RUN for p in capability; do \\',
        '      cp -r "libs/$p/dist" "/app/out/node_modules/@fx/$p/"; \\',
        '    done',
      ].join('\n'),
      'infra/Dockerfile.web': 'FROM node\nRUN pnpm --filter @fx/web build\nFROM nginx\n',
    });

  it('lists the pnpm workspace packages, not the root', () => {
    expect(workspacePackages(repo()).map((pkg) => `${pkg.name} ${pkg.dir}`)).toEqual([
      '@fx/server apps/server',
      '@fx/web apps/web',
      '@fx/capability libs/capability',
      '@fx/dev-only libs/dev-only',
      '@fx/leaf libs/leaf',
      '@fx/lib libs/lib',
      '@fx/tests tests',
    ]);
  });

  it('reads the deployed and the hand-copied packages from the Dockerfiles', () => {
    const root = repo();
    expect(deployedPackages(root)).toEqual(['@fx/server']);
    expect(copiedPackageDirs(root)).toEqual(['libs/capability']);
  });

  it('ships the deployed packages, their production workspace dependencies and the copies', () => {
    expect([...productionPackages(repo())].sort()).toEqual([
      '@fx/capability',
      '@fx/leaf',
      '@fx/lib',
      '@fx/server',
    ]);
  });
});

describe('auditDeclaredDependencies', () => {
  function problems(root: string): string[] {
    return auditDeclaredDependencies(root).map(
      (finding) =>
        `${finding.file}:${String(finding.line)} ${finding.problem} ${finding.dependency}`,
    );
  }

  const base = {
    'pnpm-workspace.yaml': WORKSPACE,
    'package.json': { name: '@fx/root', private: true, devDependencies: { hoisted: '1.0.0' } },
  };

  it('fails an import whose package the importing package does not declare', () => {
    const root = fixtureRepo({
      ...base,
      'libs/lib/package.json': {
        name: '@fx/lib',
        dependencies: { 'in-deps': '1.0.0' },
        devDependencies: { 'in-dev': '1.0.0' },
        peerDependencies: { 'in-peer': '1.0.0' },
        optionalDependencies: { 'in-optional': '1.0.0' },
      },
      'libs/lib/src/index.ts': [
        "import a from 'in-deps/sub';",
        "import b from 'in-peer';",
        "import c from 'in-optional';",
        "import d from 'undeclared';",
        "import e from 'hoisted';",
        "import { readFileSync } from 'node:fs';",
        "import { join } from 'path';",
        "import self from '@fx/lib/other';",
        "import local from './local';",
      ].join('\n'),
      'libs/lib/src/index.test.ts': [
        "import { it } from 'in-dev';",
        "vi.mock('mocked-undeclared');",
        "const actual = await vi.importActual('@fx/other');",
      ].join('\n'),
      'libs/lib/vitest.config.ts': "import { defineConfig } from 'config-undeclared';",
    });

    expect(problems(root)).toEqual([
      'libs/lib/src/index.test.ts:2 undeclared mocked-undeclared',
      'libs/lib/src/index.test.ts:3 undeclared @fx/other',
      'libs/lib/src/index.ts:4 undeclared undeclared',
      // Declared by the repository root only: resolvable by hoisting, not declared.
      'libs/lib/src/index.ts:5 undeclared hoisted',
      'libs/lib/vitest.config.ts:1 undeclared config-undeclared',
    ]);
  });

  it('accepts @types/<name> for a type-only import, and only for one', () => {
    const root = fixtureRepo({
      ...base,
      'libs/lib/package.json': {
        name: '@fx/lib',
        devDependencies: { '@types/sock': '8.0.0', '@types/scope__pkg': '1.0.0' },
      },
      'libs/lib/src/index.ts': [
        "import type { WebSocket } from 'sock';",
        "import type { Thing } from '@scope/pkg';",
        "import { WebSocketServer } from 'sock';",
      ].join('\n'),
    });

    expect(problems(root)).toEqual(['libs/lib/src/index.ts:3 undeclared sock']);
  });

  it('checks #imports against the package imports map', () => {
    const root = fixtureRepo({
      ...base,
      'apps/web/package.json': {
        name: '@fx/web',
        imports: { '#app/*': './src/*', '#config': './src/config.ts' },
      },
      'apps/web/src/main.ts': [
        "import { a } from '#app/features/a';",
        "import config from '#config';",
        "import missing from '#missing/thing';",
      ].join('\n'),
    });

    expect(problems(root)).toEqual([
      'apps/web/src/main.ts:3 unmapped-subpath-import #missing/thing',
    ]);
  });

  it('skips build output, node_modules and nested packages', () => {
    const root = fixtureRepo({
      ...base,
      'libs/lib/package.json': { name: '@fx/lib' },
      'libs/lib/dist/index.js': "import 'undeclared-in-dist';",
      'libs/lib/node_modules/x/index.js': "import 'undeclared-in-node-modules';",
      'libs/lib/fixtures/nested/package.json': { name: 'nested' },
      'libs/lib/fixtures/nested/index.ts': "import 'undeclared-in-nested';",
    });

    expect(problems(root)).toEqual([]);
  });

  it('requires production source of a shipped package to declare runtime imports for production', () => {
    const root = fixtureRepo({
      ...base,
      'infra/Dockerfile': [
        'RUN pnpm --filter @fx/server deploy --prod /app/out',
        'RUN for p in capability; do cp -r "libs/$p/dist" /app/out; done',
      ].join('\n'),
      'apps/server/package.json': {
        name: '@fx/server',
        dependencies: { '@fx/lib': 'workspace:*' },
      },
      'apps/server/src/main.ts': "import '@fx/lib';",
      'libs/lib/package.json': {
        name: '@fx/lib',
        devDependencies: { 'dev-only': '1.0.0', '@types/dev-only': '1.0.0', vitest: '1.0.0' },
      },
      'libs/lib/src/index.ts': [
        "import type { Shape } from 'dev-only';",
        "import { value } from 'dev-only';",
      ].join('\n'),
      'libs/lib/src/index.test.ts': "import { it } from 'vitest';",
      'libs/lib/src/__tests__/helper.ts': "import { vi } from 'vitest';",
      'libs/lib/src/testing/mocks.ts': "import { vi } from 'vitest';",
      'libs/capability/package.json': {
        name: '@fx/capability',
        peerDependencies: { sock: '^8.0.0', 'peer-pkg': '^5.0.0' },
        peerDependenciesMeta: { sock: { optional: true } },
        devDependencies: { sock: '8.0.0' },
      },
      'libs/capability/src/index.ts': [
        "import { WebSocketServer } from 'sock';",
        "import peerPkg from 'peer-pkg';",
      ].join('\n'),
      // Not shipped: the web image is a static bundle.
      'apps/web/package.json': { name: '@fx/web', devDependencies: { react: '19.0.0' } },
      'apps/web/src/main.tsx': "import { createRoot } from 'react';",
    });

    expect(problems(root)).toEqual([
      'libs/capability/src/index.ts:1 dev-only-in-production sock',
      'libs/lib/src/index.ts:2 dev-only-in-production dev-only',
    ]);
  });

  it('treats module.ts, contract/ and server/ as shipped server sources, while web/ stays bundler-only', () => {
    const root = fixtureRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'package.json': { name: '@fx/root' },
      'infra/Dockerfile': 'RUN pnpm --filter @fx/server deploy --prod /app/out',
      'apps/server/package.json': {
        name: '@fx/server',
        dependencies: { '@fx/tasks': 'workspace:*' },
      },
      'apps/server/src/main.ts': "import '@fx/tasks';",
      'libs/tasks/package.json': {
        name: '@fx/tasks',
        devDependencies: { 'server-only-dev': '1.0.0', react: '19.0.0' },
      },
      'libs/tasks/module.ts': 'export const tasksModule = {};',
      'libs/tasks/server/index.ts': "import 'server-only-dev';",
      'libs/tasks/web/TasksPage.tsx':
        "import { useState } from 'react'; export const x = useState;",
    });

    expect(problems(root)).toEqual([
      'libs/tasks/server/index.ts:1 dev-only-in-production server-only-dev',
    ]);
  });

  it('fails when a Dockerfile deploys a package the workspace does not have', () => {
    const root = fixtureRepo({
      ...base,
      'infra/Dockerfile': 'RUN pnpm --filter @fx/gone deploy --prod /app/out',
    });

    expect(problems(root)).toEqual(['infra/Dockerfile:1 unknown-image-package @fx/gone']);
  });
});

describe('run', () => {
  it('passes on a clean fixture and lists each finding on a dirty one', () => {
    const clean = fixtureRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'package.json': { name: '@fx/root' },
      'libs/lib/package.json': { name: '@fx/lib', dependencies: { sock: '8.0.0' } },
      'libs/lib/src/index.ts': "import 'sock';",
    });
    expect(run(clean).ok).toBe(true);

    writeFileSync(path.join(clean, 'libs/lib/src/extra.ts'), "import 'left-pad';\n");
    const result = run(clean);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "libs/lib/src/extra.ts:1 imports 'left-pad', but @fx/lib (libs/lib/package.json) does not declare left-pad",
    ]);
  });
});
