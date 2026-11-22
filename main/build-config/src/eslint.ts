// main/build-config/src/eslint.ts
/// <reference types="node" />
/**
 * The repository ESLint preset. The root `eslint.config.ts` and the React
 * packages' `eslint.config.ts` files import it by package name
 * (`@bslt/build-config/eslint`). Paths in it are relative to the repository root.
 */

import { includeIgnoreFile } from '@eslint/compat';
import boundaries from 'eslint-plugin-boundaries';
import importXPlugin from 'eslint-plugin-import-x';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import perfectionistPlugin from 'eslint-plugin-perfectionist';
import reactPlugin from 'eslint-plugin-react';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';
import type { Linter } from 'eslint';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

// This file is main/build-config/src/eslint.ts: the repository root is three levels up.
const tsconfigRootDir: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const gitignorePath = path.resolve(tsconfigRootDir, '.gitignore');
// Resolve workspace projects here: resolver glob expansion depends on lint's cwd
// and can omit that workspace's own config when invoked from inside the package.
const resolverProjects = [
  'tsconfig.json',
  'config/tsconfig.eslint.json',
  'main/build-config/tsconfig.json',
  'main/testing/tsconfig.json',
  'main/tools/tsconfig.json',
  'tests/tsconfig.json',
  ...['main/apps', 'main/kernel', 'main/modules'].flatMap((directory) => {
    const absDir = path.resolve(tsconfigRootDir, directory);
    if (!existsSync(absDir)) return [];
    return readdirSync(absDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const lintCfg = `${directory}/${entry.name}/tsconfig.lint.json`;
        return existsSync(path.resolve(tsconfigRootDir, lintCfg))
          ? lintCfg
          : `${directory}/${entry.name}/tsconfig.json`;
      });
  }),
]
  .map((file) => path.resolve(tsconfigRootDir, file))
  .filter((file) => existsSync(file));

function findNearestProjectConfig(startPath: string): string | null {
  let dir = startPath;
  while (dir.startsWith(tsconfigRootDir)) {
    const lintCfg = path.join(dir, 'tsconfig.lint.json');
    if (existsSync(lintCfg)) {
      return `./${path.relative(tsconfigRootDir, lintCfg).replaceAll(path.sep, '/')}`;
    }
    const baseCfg = path.join(dir, 'tsconfig.json');
    if (existsSync(baseCfg)) {
      return `./${path.relative(tsconfigRootDir, baseCfg).replaceAll(path.sep, '/')}`;
    }
    if (dir === tsconfigRootDir) break;
    dir = path.dirname(dir);
  }
  return null;
}

const activeCwd = path.resolve(process.cwd());
const cwdDefaultProject: string =
  activeCwd === tsconfigRootDir
    ? './tsconfig.json'
    : (findNearestProjectConfig(activeCwd) ?? './tsconfig.json');

const perPackageProjectOverrides: Linter.Config[] =
  activeCwd !== tsconfigRootDir
    ? []
    : [
        { pattern: 'bslt.config.ts', project: './config/tsconfig.eslint.json' },
        ...['main/apps', 'main/kernel', 'main/modules'].flatMap((directory) => {
          const absDir = path.resolve(tsconfigRootDir, directory);
          if (!existsSync(absDir)) return [];
          return readdirSync(absDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .flatMap((entry) => {
              const relLint = `${directory}/${entry.name}/tsconfig.lint.json`;
              const relBase = `${directory}/${entry.name}/tsconfig.json`;
              const chosen = existsSync(path.resolve(tsconfigRootDir, relLint))
                ? `./${relLint}`
                : existsSync(path.resolve(tsconfigRootDir, relBase))
                  ? `./${relBase}`
                  : null;
              return chosen === null
                ? []
                : [
                    {
                      pattern: `${directory}/${entry.name}/**/*.{ts,tsx,cts,mts}`,
                      project: chosen,
                    },
                  ];
            });
        }),
      ].map(({ pattern, project }): Linter.Config => ({
        files: [pattern],
        languageOptions: {
          parserOptions: {
            noWarnOnMultipleProjects: true,
            tsconfigRootDir,
            project: [project],
          },
        },
      }));
const require = createRequire(import.meta.url);
let reactHooksPluginTyped: any = {};
try {
  reactHooksPluginTyped = require('eslint-plugin-react-hooks');
} catch {
  reactHooksPluginTyped = {};
}

const kernelIsomorphicLayers: string[] = ['kernel-schema', 'kernel-contract'];

interface ModuleGraphEntry {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

interface ModuleGraphFile {
  readonly modules?: readonly ModuleGraphEntry[];
}

function loadModuleDependencies(): ReadonlyMap<string, readonly string[]> {
  const graphMap = new Map<string, readonly string[]>();
  const graphPath = path.resolve(tsconfigRootDir, 'main/tools/generated/module-graph.json');
  if (existsSync(graphPath)) {
    try {
      const parsed = JSON.parse(readFileSync(graphPath, 'utf8')) as ModuleGraphFile;
      for (const mod of parsed.modules ?? []) {
        graphMap.set(mod.id, mod.dependsOn);
      }
    } catch {
      // Fallback to directory scan below if JSON is unreadable.
    }
  }
  const modulesDir = path.resolve(tsconfigRootDir, 'main/modules');
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !graphMap.has(entry.name)) {
        graphMap.set(entry.name, []);
      }
    }
  }
  return graphMap;
}

const moduleDependencies = loadModuleDependencies();
const allModuleIds = [...moduleDependencies.keys()].sort();
const allModuleElementTypes = allModuleIds.map((id) => `module-${id}`);
const kernelModuleAllowLayers: string[] = [
  'kernel-schema',
  'kernel-contract',
  'kernel-protocols',
  'server-db',
  'server-storage',
  'server-system',
  'server-realtime',
  'server-comms',
  'client-engine',
  'client-react',
  'client-ui',
  'kernel-web',
];

const boundarySeverity: 'warn' | 'error' =
  process.env['BSLT_BOUNDARY_LEVEL'] === 'warn' ? 'warn' : 'error';

let jsConfigs: any = {};
try {
  jsConfigs = require('@eslint/js').configs;
} catch {
  jsConfigs = {};
}

// Shared no-restricted-syntax selectors. Flat config REPLACES (not merges) a rule
// when a later block matches the same file, so every block that sets
// no-restricted-syntax for a file tree must spread the bans it still wants.
export const exportAllBan = {
  selector: 'ExportAllDeclaration',
  message:
    'Wildcard exports (export *) are banned — list named exports explicitly so the public API is auditable.',
};
export const rawFormElementBans = [
  {
    selector: 'JSXOpeningElement[name.name="button"]',
    message: 'Use <Button> from @bslt/ui instead of raw <Button>.',
  },
  {
    selector: 'JSXOpeningElement[name.name="input"]',
    message: 'Use <Input>/<Checkbox>/<Radio> from @bslt/ui instead of raw <input>.',
  },
  {
    selector: 'JSXOpeningElement[name.name="select"]',
    message: 'Use <Select> from @bslt/ui instead of raw <select>.',
  },
  {
    selector: 'JSXOpeningElement[name.name="textarea"]',
    message: 'Use <TextArea> from @bslt/ui instead of raw <textarea>.',
  },
  {
    selector: 'JSXOpeningElement[name.name="img"]',
    message: 'Use <Image> from @bslt/ui instead of raw <img>.',
  },
];
const setIntervalInServerBans = [
  {
    selector: 'CallExpression[callee.name="setInterval"]',
    message:
      'setInterval is restricted to kernel runtimes (main/kernel/*). Declare module.cron or enqueue a job onto sys_jobs instead (plan section 8.4).',
  },
  {
    selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="setInterval"]',
    message:
      'setInterval is restricted to kernel runtimes (main/kernel/*). Declare module.cron or enqueue a job onto sys_jobs instead (plan section 8.4).',
  },
];

// Global no-restricted-imports bans (section 5d). Flat config REPLACES (not
// merges) a rule when a later block matches the same file, so any later block
// that sets no-restricted-imports must re-spread these.
const subpathImportBanPaths = [
  {
    name: '@bslt/server-system',
    message:
      'Import from a scoped subpath (e.g. @bslt/server-system/security, /routing, /config) instead of the root barrel.',
  },
  {
    name: '@bslt/server-system/system',
    message: 'Use @bslt/server-system/runtime. The old /system subpath is deprecated.',
  },
  {
    name: '@bslt/server-system/storage',
    message: 'Use @bslt/storage. Storage is a separate package.',
  },
  {
    name: '@bslt/server-system/adapters/observability',
    message: 'Use @bslt/server-system/observability. The adapters subpath is deprecated.',
  },
  {
    name: '@bslt/server-system/adapters/storage',
    message: 'Use @bslt/storage. Storage is a separate package.',
  },
];
const subpathImportBanPatterns: Array<{ regex: string; message: string }> = [];

export const baseConfig = [
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      '**/.github/**',
      '**/vite*.config.ts',
      '**/vitest.config.*',
      '**/drizzle.config.ts',
      '**/playwright*.config.ts',
      '**/eslint.config.ts',
      // The preset itself (it was the root eslint.config.ts until Phase 3).
      'main/build-config/src/eslint.ts',
      '**/*.d.ts',
      'main/kernel/db/src/**/*.js',
      'main/kernel/db/src/**/*.js.map',
      'main/kernel/react/src/theme/index.ts',
      'main/kernel/ui/src/types/index.ts',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
    ],
  },

  // 1. BASE JS RECOMMENDED
  jsConfigs.recommended ? { ...jsConfigs.recommended } : {},

  // 2. MONOREPO BOUNDARY ENFORCEMENT (DAG Mirror)
  {
    files: [
      'bslt.config.ts',
      'main/kernel/*/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/modules/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/apps/*/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/testing/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'tests/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
    ],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': tsconfigRootDir,
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: resolverProjects,
          // Workspace packages resolve through their `exports` `source` condition
          // (tsconfig `customConditions`), so boundaries see the source file a
          // specifier names, not a `dist` that may not be built. `types` is left
          // out: the web app's `#app/*` import lists its TypeScript candidates
          // under `types` (TypeScript does not probe extensions there), and this
          // resolver would take only the first; it probes the extensionless
          // `default` target instead, as Vite does.
          conditionNames: ['source', 'import', 'require', 'node', 'default'],
        },
      },
      'boundaries/elements': [
        // Isomorphic & Wire Kernel Primitives
        { type: 'kernel-schema', pattern: 'main/kernel/schema', mode: 'folder' },
        { type: 'kernel-contract', pattern: 'main/kernel/contract', mode: 'folder' },
        { type: 'kernel-protocols', pattern: 'main/kernel/protocols', mode: 'folder' },

        // Server Kernel Packages
        { type: 'server-db', pattern: 'main/kernel/db', mode: 'folder' },
        { type: 'server-storage', pattern: 'main/kernel/storage', mode: 'folder' },
        { type: 'server-system', pattern: 'main/kernel/server', mode: 'folder' },
        { type: 'server-realtime', pattern: 'main/kernel/realtime', mode: 'folder' },
        { type: 'server-comms', pattern: 'main/kernel/comms', mode: 'folder' },

        // Client & Web Kernel Packages
        { type: 'client-engine', pattern: 'main/kernel/client', mode: 'folder' },
        { type: 'client-react', pattern: 'main/kernel/react', mode: 'folder' },
        { type: 'client-ui', pattern: 'main/kernel/ui', mode: 'folder' },
        { type: 'kernel-web', pattern: 'main/kernel/web', mode: 'folder' },

        // Install Config & Native Modules (DAG enforced per module)
        { type: 'bslt-config', pattern: 'bslt.config.ts', mode: 'full' },
        ...allModuleIds.flatMap((id) => [
          {
            type: `module-${id}-test`,
            pattern: `main/modules/${id}/**/*.{test,spec}.{ts,tsx}`,
            mode: 'full' as const,
          },
          {
            type: `module-${id}`,
            pattern: `main/modules/${id}`,
            mode: 'folder' as const,
          },
        ]),

        // Consumers (Apps)
        { type: 'app-server', pattern: 'main/apps/server', mode: 'folder' },
        { type: 'app-web', pattern: 'main/apps/web', mode: 'folder' },
        // Testing kit (@bslt/testing): buildTestApp, describeRealDb, fakes
        { type: 'testing', pattern: 'main/testing', mode: 'folder' },
        // Repository tooling (@bslt/tools). A target only: its own files are
        // not under these rules. The real-DB suites read the catalog with it.
        { type: 'tools', pattern: 'main/tools', mode: 'folder' },
        // Tests (Integration & E2E)
        { type: 'tests', pattern: 'tests', mode: 'folder' },
        // Reader-facing copy (the file-owned legal documents). It lives in docs/
        // so it can be reviewed as prose, and the web app pulls it in as `?raw`
        // markdown — content, never code, so nothing may import *out* of it.
        { type: 'docs-content', pattern: 'docs', mode: 'folder' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        boundarySeverity,
        {
          default: 'disallow',
          message: 'Import is not allowed by boundary rules. See DAG in docs/architecture.',
          rules: [
            // Kernel foundation rules
            { from: 'kernel-schema', allow: [] },
            { from: 'kernel-contract', allow: ['kernel-schema'] },
            // Node built-ins only (plan section 4.3).
            { from: 'kernel-protocols', allow: [] },

            // Server kernel package boundaries
            {
              from: 'server-db',
              allow: [...kernelIsomorphicLayers, 'kernel-protocols'],
            },
            {
              from: 'server-storage',
              allow: [...kernelIsomorphicLayers, 'kernel-protocols'],
            },
            {
              from: 'server-comms',
              allow: [...kernelIsomorphicLayers, 'kernel-protocols'],
            },
            {
              from: 'server-system',
              allow: [...kernelIsomorphicLayers, 'kernel-protocols', 'server-db'],
            },
            {
              from: 'server-realtime',
              allow: [...kernelIsomorphicLayers, 'kernel-protocols', 'server-db', 'server-system'],
            },
            {
              from: 'app-server',
              allow: [
                ...kernelIsomorphicLayers,
                'bslt-config',
                ...allModuleElementTypes,
                'server-db',
                'server-comms',
                'server-realtime',
                'server-storage',
                'server-system',
              ],
            },

            // Native module DAG rules: modules import ONLY kernel packages + self + dependsOn modules
            { from: 'bslt-config', allow: ['kernel-contract', ...allModuleElementTypes] },
            ...allModuleIds.flatMap((id) => {
              const depTypes = (moduleDependencies.get(id) ?? []).map((dep) => `module-${dep}`);
              return [
                {
                  from: `module-${id}`,
                  allow: [...kernelModuleAllowLayers, `module-${id}`, ...depTypes],
                },
                {
                  from: `module-${id}-test`,
                  allow: [
                    'testing',
                    ...kernelModuleAllowLayers,
                    `module-${id}`,
                    `module-${id}-test`,
                    ...depTypes,
                  ],
                },
              ];
            }),

            // Client & web kernel package boundaries
            { from: 'client-engine', allow: [...kernelIsomorphicLayers] },
            { from: 'client-react', allow: [...kernelIsomorphicLayers, 'client-engine'] },
            {
              from: 'client-ui',
              allow: [...kernelIsomorphicLayers, 'client-engine', 'client-react'],
            },
            {
              from: 'kernel-web',
              allow: [...kernelIsomorphicLayers, 'client-engine', 'client-react', 'client-ui'],
            },
            {
              from: 'app-web',
              allow: [
                ...kernelIsomorphicLayers,
                'bslt-config',
                ...allModuleElementTypes,
                'client-engine',
                'client-react',
                'client-ui',
                'kernel-web',
                'docs-content',
              ],
            },

            // Testing kit: boots the production server (app-server) on a test
            // database and fakes its external ports. Server side only.
            {
              from: 'testing',
              allow: [
                ...kernelIsomorphicLayers,
                'app-server',
                'bslt-config',
                ...allModuleElementTypes,
                'server-db',
                'server-system',
              ],
            },

            // Tests (cross-domain reaching)
            {
              from: 'tests',
              allow: [
                'testing',
                'tools',
                'bslt-config',
                ...allModuleElementTypes,
                'app-web',
                'app-server',
                'client-engine',
                'client-react',
                'client-ui',
                'kernel-protocols',
                'kernel-web',
                'server-comms',
                'server-db',
                'server-realtime',
                'server-storage',
                'server-system',
                ...kernelIsomorphicLayers,
              ],
            },
          ],
        },
      ],
      'boundaries/no-unknown': boundarySeverity,
    },
  },

  // 3. TYPESCRIPT TYPE-AWARE LOGIC
  // Test files are intentionally excluded from composite build tsconfigs so they
  // don't generate .d.ts output. Type-aware rules are disabled for test files in
  // section 6 which also sets project: false to skip project lookup for them.
  ...tseslint.configs.strictTypeChecked.map((config: any) => ({
    ...config,
    files: ['**/*.{ts,tsx,cts,mts}'],
    ignores: [
      ...(Array.isArray(config.ignores) ? config.ignores : []),
      'main/kernel/react/src/theme/index.ts',
      'main/kernel/ui/src/types/index.ts',
    ],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        noWarnOnMultipleProjects: true,
        tsconfigRootDir,
        project: [cwdDefaultProject],
      },
    },
  })),
  ...perPackageProjectOverrides,
  {
    files: ['**/*.{ts,tsx,cts,mts}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'unused-imports': unusedImportsPlugin as any,
      'import-x': importXPlugin as any,
      perfectionist: perfectionistPlugin as any,
    },
    rules: {
      // --- LOGIC & PERFORMANCE (The BSLT Core) ---
      'no-sync': 'error', // No blocking the event loop in infra code
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      'no-console': 'warn',

      // --- VELOCITY OVER STYLE (AI-Friendly) ---
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'unused-imports/no-unused-imports': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // --- IMPORT GOVERNANCE ---
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // 2b. IMPORT-ORDER CLASSIFICATION PIN FOR @bslt/db SELF-IMPORTS
  // Inside the db package, a value import of `@bslt/db/*` resolves to in-project
  // source locally (→ classified `internal`) but falls back to `external` in CI
  // (where the workspace symlink exists), so import-x/order disagreed between
  // environments and no static order satisfied both (see package-exports.test.ts).
  // Pin @bslt/* to `internal` BY NAME here so classification is identical
  // everywhere. Settings merge across matching flat-config blocks, so the db
  // files keep the resolver/boundaries settings from block 2 above.
  {
    files: [
      'bslt.config.ts',
      'main/kernel/db/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/modules/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
    ],
    settings: {
      'import-x/internal-regex': '^@bslt/',
    },
  },

  // 3a. Legacy Alias Ban
  // Legacy package aliases are disallowed after module split:
  // - @bslt/engine/* -> @bslt/client-engine/*
  // - @bslt/websocket -> @bslt/realtime/websocket
  {
    files: ['**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@bslt/(engine|websocket)(?:/.*)?$',
              message:
                'Legacy alias import is not allowed. Use @bslt/client-engine/* or @bslt/realtime/websocket.',
            },
          ],
        },
      ],
    },
  },

  // 3b. EXPORT-ALL BAN IN CLEANED APP/PACKAGE SURFACES
  {
    files: [
      'main/apps/web/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/modules/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/kernel/client/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/kernel/react/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
      'main/kernel/ui/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}',
    ],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': ['error', exportAllBan],
    },
  },

  // 4. REACT & UI LAYER
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: { 'react-hooks': reactHooksPluginTyped },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Ensure we use the design system instead of raw HTML
      'no-restricted-syntax': ['error', ...rawFormElementBans, exportAllBan],
    },
  },

  // 4b. DESIGN SYSTEM INTERNALS: raw form primitives are the UI package's job.
  // Later block replaces #4's rule for these files; keep the button and img
  // bans (ui composes its own <Button>/<Image>), but the image primitives
  // themselves are exempted below.
  {
    files: ['main/kernel/ui/src/**/*.{tsx,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message: 'Use <Button> from @bslt/ui instead of raw <Button>.',
        },
        {
          selector: 'JSXOpeningElement[name.name="img"]',
          message: 'Use <Image> from @bslt/ui instead of raw <img>.',
        },
      ],
    },
  },

  // 4c. IMAGE PRIMITIVES: <Image> and <Avatar> are the sanctioned wrappers
  // around a raw <img>, so the img ban does not apply to them (keep button).
  {
    files: ['main/kernel/ui/src/components/Image.tsx', 'main/kernel/ui/src/elements/Avatar.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message: 'Use <Button> from @bslt/ui instead of raw <Button>.',
        },
      ],
    },
  },

  // 5c. SERVER/SYSTEM: NO INTERNAL INDEX BARREL IMPORTS
  // Inside a feature folder, nothing imports ./index — the barrel is for external consumers only.
  // This prevents hidden circular dependencies and enforces explicit dependency paths.
  {
    files: ['main/kernel/server/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Matches ./index, ../index, ./providers/index, ../../cache/index, etc.
              regex: '^\\.{1,2}(?:\\/[^/]+)*\\/index$',
              message:
                'Do not import from internal index barrels. Import from the concrete module file instead. Barrels are for external consumers only.',
            },
          ],
        },
      ],
    },
  },

  // 5e. SERVER PACKAGES: MUST NOT IMPORT APP-COMPOSITION CONFIG
  // Server packages consume kernel config contracts, not app wiring internals.
  {
    files: [
      'main/kernel/{db,server,storage,comms,realtime}/src/**/*.{ts,tsx,js,jsx,cts,mts,cjs,mjs}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/apps\\/server\\/src\\/config(?:\\/|$)/]',
          message:
            'Server packages must not import app composition config internals (main/apps/server/src/config). Use @bslt/server-system/config contracts and package-local wiring.',
        },
        {
          selector: 'ImportDeclaration[source.value=/^@\\/config(?:\\/|$)/]',
          message:
            'Server packages must not import @/config (apps/server alias). Use kernel contracts or package-local config adapters.',
        },
        {
          selector: 'ImportDeclaration[source.value=/^@bslt\\/server\\/config(?:\\/|$)/]',
          message:
            'Server packages must not import app-level server config paths. Keep app wiring in main/apps/server only.',
        },
        {
          selector:
            'ImportDeclaration[source.value=/^\\.\\.(?:\\/\\.\\.)+\\/kernel\\/(?:db|server|realtime|comms|storage)\\/src(?:\\/|$)/]',
          message:
            'Do not traverse into a sibling server package src tree. Import through the published package contract instead.',
        },
        exportAllBan,
      ],
    },
  },

  {
    files: ['main/apps/*/src/**/*.{ts,tsx,js,jsx,cts,mts,cjs,mjs}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value=/^\\.\\.(?:\\/\\.\\.)+\\/kernel\\/(?:db|server|realtime|comms|storage)\\/src(?:\\/|$)/]',
          message:
            'Do not traverse into a server package src tree from app code. Import through the published package contract instead.',
        },
        ...rawFormElementBans,
        exportAllBan,
      ],
    },
  },

  // 5e′. KERNEL-ONLY setInterval IN SERVER PRODUCTION CODE (plan section 8.4)
  {
    files: ['main/modules/*/server/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}'],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': ['error', exportAllBan, ...setIntervalInServerBans],
    },
  },
  {
    files: ['main/apps/server/src/**/*.{ts,tsx,js,jsx,cts,mts,cjs,mjs}'],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value=/^\\.\\.(?:\\/\\.\\.)+\\/kernel\\/(?:db|server|realtime|comms|storage)\\/src(?:\\/|$)/]',
          message:
            'Do not traverse into a server package src tree from app code. Import through the published package contract instead.',
        },
        ...rawFormElementBans,
        exportAllBan,
        ...setIntervalInServerBans,
      ],
    },
  },

  // 5d. SERVER/SYSTEM: ENFORCE SUBPATH IMPORTS
  // Consumers must import scoped modules (e.g. @bslt/server-system/security)
  // instead of the root barrel to keep boundaries explicit.
  {
    files: ['**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}'],
    ignores: ['main/kernel/server/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: subpathImportBanPaths,
          patterns: subpathImportBanPatterns,
        },
      ],
    },
  },

  // 5g. ISOMORPHIC KERNEL PACKAGES ARE FRAMEWORK-FREE AND RUNTIME-AGNOSTIC
  // main/kernel/{schema,contract} must run in any JS runtime: no React, no Node builtins.
  {
    files: ['main/kernel/{schema,contract}/src/**/*.{js,jsx,ts,tsx,cts,mts,cjs,mjs}'],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...subpathImportBanPaths,
            {
              name: 'react',
              message: 'Isomorphic kernel packages are framework-free. No React imports.',
            },
            {
              name: 'react-dom',
              message: 'Isomorphic kernel packages are framework-free. No React DOM imports.',
            },
          ],
          patterns: [
            ...subpathImportBanPatterns,
            {
              regex: '^(react|react-dom)(/.*)?$',
              message:
                'Isomorphic kernel packages are framework-free. React must not be imported here.',
            },
            {
              regex: '^node:',
              message:
                'Isomorphic kernel packages must stay runtime-agnostic. Node builtins are not allowed.',
            },
            {
              regex:
                '^(assert|async_hooks|buffer|child_process|cluster|crypto|dgram|diagnostics_channel|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|stream|string_decoder|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)(/.*)?$',
              message:
                'Isomorphic kernel packages must stay runtime-agnostic. Bare Node builtins are not allowed.',
            },
          ],
        },
      ],
    },
  },

  // 5h. ACCESSIBILITY & MODULE JSX LITERALS (Phase 17, plan section 12.7)
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: {
      'bslt-a11y': {
        rules: {
          // Replaces jsx-a11y/label-has-associated-control because eslint-plugin-jsx-a11y@6.10.2
          // calls minimatch.default() in CJS, which throws under our CVE-pinned minimatch@11 override.
          'label-has-associated-control': {
            meta: {
              type: 'problem',
              docs: {
                description:
                  'Enforce that every <label> has accessible text and either htmlFor or a nested control.',
              },
              schema: [],
            },
            create(context) {
              const controlNames = new Set([
                'input',
                'meter',
                'output',
                'progress',
                'select',
                'textarea',
                'Checkbox',
                'Input',
                'PasswordInput',
                'Radio',
                'Select',
                'Switch',
                'TextArea',
              ]);

              interface JsxAttrLike {
                readonly type: string;
                readonly name?: { readonly type: string; readonly name?: string };
                readonly value?: {
                  readonly type: string;
                  readonly value?: unknown;
                  readonly expression?: { readonly type: string; readonly value?: unknown };
                } | null;
              }

              interface JsxNodeLike {
                readonly type: string;
                readonly value?: unknown;
                readonly openingElement?: {
                  readonly name?: { readonly type: string; readonly name?: string };
                  readonly attributes?: readonly JsxAttrLike[];
                };
                readonly children?: readonly JsxNodeLike[];
              }

              function getAttr(
                attrs: readonly JsxAttrLike[],
                attrName: string,
              ): JsxAttrLike | undefined {
                return attrs.find(
                  (attr) =>
                    attr.type === 'JSXAttribute' &&
                    attr.name?.type === 'JSXIdentifier' &&
                    attr.name.name === attrName,
                );
              }

              function hasNonEmptyAttr(attrs: readonly JsxAttrLike[], attrName: string): boolean {
                if (attrs.some((attr) => attr.type === 'JSXSpreadAttribute')) return true;
                const attr = getAttr(attrs, attrName);
                if (!attr || !attr.value) return false;
                if (attr.value.type === 'Literal') {
                  return typeof attr.value.value === 'string' && attr.value.value.trim().length > 0;
                }
                if (attr.value.type === 'JSXExpressionContainer') {
                  const expr = attr.value.expression;
                  if (!expr || expr.type === 'JSXEmptyExpression') return false;
                  if (expr.type === 'Literal') {
                    return typeof expr.value === 'string' && expr.value.trim().length > 0;
                  }
                  return true;
                }
                return false;
              }

              function containsControl(node: JsxNodeLike, depth: number): boolean {
                if (depth > 6) return false;
                for (const child of node.children ?? []) {
                  if (child.type === 'JSXElement' && child.openingElement) {
                    const elName = child.openingElement.name?.name;
                    if (elName !== undefined && controlNames.has(elName)) {
                      return true;
                    }
                    if (containsControl(child, depth + 1)) {
                      return true;
                    }
                  } else if (child.type === 'JSXFragment' && containsControl(child, depth + 1)) {
                    return true;
                  }
                }
                return false;
              }

              function hasAccessibleText(node: JsxNodeLike, depth: number): boolean {
                if (depth > 6) return false;
                const attrs = node.openingElement?.attributes ?? [];
                if (
                  hasNonEmptyAttr(attrs, 'aria-label') ||
                  hasNonEmptyAttr(attrs, 'aria-labelledby')
                ) {
                  return true;
                }
                for (const child of node.children ?? []) {
                  if (child.type === 'JSXText') {
                    if (typeof child.value === 'string' && child.value.trim().length > 0) {
                      return true;
                    }
                  } else if (child.type === 'JSXExpressionContainer') {
                    return true;
                  } else if (child.type === 'JSXElement' && child.openingElement) {
                    const elName = child.openingElement.name?.name ?? '';
                    if (
                      elName.length > 0 &&
                      elName[0] === elName[0]?.toUpperCase() &&
                      !controlNames.has(elName) &&
                      (child.children?.length ?? 0) === 0
                    ) {
                      return true;
                    }
                    if (controlNames.has(elName)) {
                      const childAttrs = child.openingElement.attributes ?? [];
                      if (
                        hasNonEmptyAttr(childAttrs, 'label') ||
                        hasNonEmptyAttr(childAttrs, 'aria-label') ||
                        hasNonEmptyAttr(childAttrs, 'aria-labelledby')
                      ) {
                        return true;
                      }
                    }
                    if (hasAccessibleText(child, depth + 1)) {
                      return true;
                    }
                  } else if (child.type === 'JSXFragment' && hasAccessibleText(child, depth + 1)) {
                    return true;
                  }
                }
                return false;
              }

              return {
                JSXElement(rawNode) {
                  const node = rawNode as unknown as JsxNodeLike;
                  if (node.openingElement?.name?.name !== 'label') return;
                  const attrs = node.openingElement.attributes ?? [];
                  if (!hasAccessibleText(node, 0)) {
                    context.report({
                      node: rawNode,
                      message: 'A form label must have accessible text.',
                    });
                    return;
                  }
                  const hasHtmlFor = hasNonEmptyAttr(attrs, 'htmlFor');
                  if (!hasHtmlFor && !containsControl(node, 0)) {
                    context.report({
                      node: rawNode,
                      message:
                        'A form label must be associated with a control via htmlFor or nesting.',
                    });
                  }
                },
              };
            },
          },
        },
      },
      'jsx-a11y': jsxA11yPlugin,
      react: reactPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
      'jsx-a11y': {
        components: {
          Button: 'button',
          IconButton: 'button',
          Input: 'input',
          PasswordInput: 'input',
          TextArea: 'textarea',
          Select: 'select',
          Image: 'img',
        },
      },
    },
    rules: {
      ...(jsxA11yPlugin.flatConfigs.recommended.rules ?? {}),
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'bslt-a11y/label-has-associated-control': 'error',
      'jsx-a11y/anchor-is-valid': [
        'error',
        {
          components: ['Link'],
          specialLink: ['to'],
        },
      ],
      'jsx-a11y/anchor-has-content': [
        'error',
        {
          components: ['Link'],
        },
      ],
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        {
          tags: [],
          roles: ['tabpanel', 'separator'],
        },
      ],
    },
  },
  {
    // WAI-ARIA 1.2 section 5.3 makes role="separator" with aria-valuenow an interactive
    // window splitter widget; aria-query@5.3.2 classifies separator as structure-only.
    files: [
      'main/kernel/ui/src/layouts/shells/ResizablePanel.tsx',
      'src/layouts/shells/ResizablePanel.tsx',
    ],
    rules: {
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
    },
  },
  {
    files: ['main/modules/**/web/**/*.{tsx,jsx}'],
    ignores: ['**/*.{spec,test}.{ts,tsx,js,jsx}', '**/__tests__/**'],
    plugins: {
      react: reactPlugin,
    },
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...rawFormElementBans,
        exportAllBan,
        {
          selector:
            'JSXAttribute[name.name=/^(aria-label|title|placeholder|label|description)$/][value.type="Literal"]',
          message:
            'User-facing JSX attributes in module web views must use t(...) instead of string literals.',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(aria-label|title|placeholder|label|description)$/] > JSXExpressionContainer[expression.type="Literal"]',
          message:
            'User-facing JSX attributes in module web views must use t(...) instead of string literals.',
        },
      ],
    },
  },

  // 6. TEST RELAXATION (Fast Loop support)
  // Test files are excluded from composite build tsconfigs (no .d.ts output needed).
  // Use project: false to skip project lookup — prevents "file not found in any project" errors.
  // disableTypeChecked turns off all type-aware rules (they require project info to run).
  // Non-type-aware rules (import order, unused imports) still apply normally.
  {
    files: [
      '**/__tests__/**/*',
      '**/*.{spec,test}.{ts,tsx}',
      '**/*.e2e.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
      // The testing kit is test support code: vitest spies and loose doubles.
      'main/testing/**/*.{ts,tsx}',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        noWarnOnMultipleProjects: true,
        project: false,
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      ...Object.fromEntries(
        Object.keys(jsxA11yPlugin.flatConfigs.recommended.rules ?? {}).map((ruleName) => [
          ruleName,
          'off',
        ]),
      ),
      'bslt-a11y/label-has-associated-control': 'off',
      // Non-type-aware rules that are intentionally relaxed in tests:
      '@typescript-eslint/no-explicit-any': 'off', // mock patterns require any
      '@typescript-eslint/no-non-null-assertion': 'off', // common in test assertions
      'no-console': 'off',
      // Raw HTML is acceptable in test render helpers (not shipped to users)
      'no-restricted-syntax': 'off',
      'react/jsx-no-literals': 'off',
    },
  },

  // 6a. Pass-through Index Barrels
  // These files only pass through exports and do not benefit from type-aware lint.
  // Keep parser in non-project mode to avoid false "not in project" errors.
  {
    files: ['main/kernel/react/src/theme/index.ts', 'main/kernel/ui/src/types/index.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        noWarnOnMultipleProjects: true,
        project: false,
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
    },
  },

  // 6b. Service worker runtime globals
  {
    files: ['main/apps/web/public/sw.js'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        Response: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        self: 'readonly',
      },
    },
  },

  // 6b′. Pre-paint theme script: browser globals, ES5 (no optional catch binding)
  {
    files: ['main/apps/web/public/theme-init.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },

  // 6c. CLI entrypoints
  // migrate.ts runs standalone (container/CI) before any pino logger exists
  // and wires `logger: console` into the migration runner, so console is its
  // only output channel.
  {
    files: ['main/apps/server/src/migrate.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // 6d. TOOLS (CLI scripts, audits, codegen)
  // main/tools was previously lint-excluded entirely. It now gets the
  // practical correctness rules (unused vars/imports, import hygiene,
  // restricted-import bans, no export *) but not the type-aware stack:
  // scripts run directly via tsx, do synchronous IO by design, and use the
  // console as their output channel.
  {
    files: [
      'main/tools/**/*.{ts,tsx,cts,mts,js,cjs,mjs}',
      'main/build-config/**/*.{ts,tsx,cts,mts,js,cjs,mjs}',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        noWarnOnMultipleProjects: true,
        project: false,
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // CLI scripts do synchronous IO by design (no event loop to block).
      'no-sync': 'off',
      // These scripts ARE their console output — an audit that finds nothing prints
      // "passed", one that finds something prints the findings and exits 1. The rule
      // was held at 'warn' only to keep 21 per-file `eslint-disable no-console`
      // directives exact, while 54 other files under main/tools simply carried the
      // warning. That is not a policy, it is a split. And it was load-bearing in the
      // wrong direction: lint-staged runs eslint with `--max-warnings=0`, so every
      // one of those 54 files was uncommittable through the pre-commit hook.
      //
      // Off here, and the 21 directives are deleted rather than left to rot —
      // reportUnusedDisableDirectives would flag them anyway.
      'no-console': 'off',
    },
  },

  // 7. OPERATIONAL OVERRIDES
  {
    linterOptions: {
      noInlineConfig: false, // Allow local bypasses for v1.0.0 speed
      reportUnusedDisableDirectives: true,
    },
  },
] satisfies Linter.Config[];

export default baseConfig;
