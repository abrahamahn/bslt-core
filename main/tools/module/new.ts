// main/tools/module/new.ts
/**
 * `bslt module new <id>`: scaffolds a full-stack native module under
 * `main/modules/<id>/` with the canonical reference shape (`module.ts`,
 * `contract/`, `server/`, `web/`, `i18n/`, tests, and real-DB RLS isolation),
 * registers it in `bslt.config.ts`, and syncs generated composition artifacts
 * (restructure plan, sections 15.3 and 17.2 Phase 8).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { orderSources, type MigrationSource } from '@bslt/db';

import { DB_CATALOG, loadCatalog, serializeCatalog } from '../catalog/file';
import { REPO_ROOT } from '../lib/paths';
import { compareText } from '../snapshot/snapshot-file';
import { syncModules } from '../sync/modules';
import { syncRows } from '../sync/rows';
import { syncHeaders } from '../sync/sync-file-headers';
import { syncTsReferences } from '../sync/sync-ts-references';

import type { Attributed, AttributedCatalog } from '../catalog/attribute';
import type { CatalogTable } from '../catalog/read';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*$/u;

const RESERVED_MODULE_IDS: ReadonlySet<string> = new Set([
  'api',
  'buildconfig',
  'client',
  'comms',
  'contract',
  'core',
  'db',
  'kernel',
  'media',
  'profiles',
  'protocols',
  'react',
  'realtime',
  'root',
  'schema',
  'server',
  'shared',
  'storage',
  'sys',
  'testing',
  'tools',
  'ui',
  'web',
  'workers',
]);

export const MODULE_NEW_USAGE = [
  'Usage:',
  '  pnpm bslt module new <id> [--scope <user|org>] [--dry-run] [--no-install]',
  '',
  'Examples:',
  '  pnpm bslt module new notes',
  '  pnpm bslt module new projects --scope org',
  '  pnpm bslt module new notes --dry-run',
].join('\n');

type ModuleOwnerScope = 'user' | 'org';

export interface ParsedModuleNewArgs {
  readonly id: string;
  readonly scope: ModuleOwnerScope;
  readonly dryRun: boolean;
  readonly install: boolean;
}

export interface ScaffoldModuleOptions {
  readonly root?: string;
  readonly scope?: ModuleOwnerScope;
  readonly dryRun?: boolean;
}

export interface ScaffoldModuleResult {
  readonly id: string;
  readonly scope: ModuleOwnerScope;
  readonly moduleDir: string;
  readonly dryRun: boolean;
  readonly files: readonly string[];
}

function parseModuleScope(raw: string): ModuleOwnerScope {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'user' || normalized === 'org') {
    return normalized;
  }
  throw new Error(`bslt module new: invalid --scope "${raw}" (expected "user" or "org")`);
}

export function parseModuleNewArgs(argv: readonly string[]): ParsedModuleNewArgs {
  const [sub, ...rest] = argv;
  if (sub !== 'new') {
    throw new Error(
      `bslt module: unknown or missing subcommand "${sub ?? ''}" (expected "bslt module new <id>")`,
    );
  }

  let dryRun = false;
  let install = true;
  let scope: ModuleOwnerScope = 'user';
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--no-install') {
      install = false;
    } else if (arg === '--scope') {
      const nextVal = rest[i + 1];
      if (nextVal === undefined || nextVal.startsWith('-')) {
        throw new Error('bslt module new: --scope requires "user" or "org"');
      }
      scope = parseModuleScope(nextVal);
      i += 1;
    } else if (arg.startsWith('--scope=')) {
      scope = parseModuleScope(arg.slice('--scope='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`bslt module new: unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0 || positionals[0] === undefined) {
    throw new Error('bslt module new requires a lowercase alphanumeric module id');
  }
  if (positionals.length > 1) {
    throw new Error(`bslt module new: unexpected argument "${positionals[1] ?? ''}"`);
  }

  return { id: positionals[0], scope, dryRun, install };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function validateModuleId(id: string, root: string): void {
  const trimmed = id.trim();
  if (trimmed !== id || !MODULE_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid module id "${id}": must match /^[a-z][a-z0-9]*$/ (lowercase ASCII letter followed by lowercase letters or digits).`,
    );
  }
  if (RESERVED_MODULE_IDS.has(id)) {
    throw new Error(`Module id "${id}" is reserved by a kernel or workspace package.`);
  }
  const moduleDir = path.join(root, 'main/modules', id);
  if (existsSync(moduleDir)) {
    throw new Error(`Module directory "main/modules/${id}" already exists.`);
  }
}

function patchBsltConfig(configContent: string, id: string): string {
  const importLine = `import { ${id}Module } from '@bslt/${id}/module';`;
  const moduleVar = `${id}Module`;

  if (!configContent.includes('defineConfig') || !configContent.includes('installedModules:')) {
    throw new Error('bslt.config.ts must export defineConfig({ installedModules: [...] })');
  }

  const lines = configContent.split('\n');
  const importIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^import\s+\{[^}]+\}\s+from\s+'@bslt\/[^']+';$/u.test(line.trim())) {
      importIndices.push(i);
    }
  }
  if (importIndices.length === 0) {
    throw new Error('bslt.config.ts is missing @bslt/* imports');
  }

  const existingImports = importIndices.map((idx) => (lines[idx] ?? '').trim());
  if (!existingImports.includes(importLine)) {
    const allImports = [...existingImports, importLine].sort((a, b) => {
      const specA = /from\s+'([^']+)'/u.exec(a)?.[1] ?? a;
      const specB = /from\s+'([^']+)'/u.exec(b)?.[1] ?? b;
      return compareText(specA, specB);
    });
    const firstIdx = importIndices[0] ?? 0;
    const lastIdx = importIndices[importIndices.length - 1] ?? firstIdx;
    lines.splice(firstIdx, lastIdx - firstIdx + 1, ...allImports);
  }

  const withImport = lines.join('\n');
  const installedRegex = /(installedModules:\s*\[)([\s\S]*?)(\]\s*(?:as\s+const)?)/u;
  const match = installedRegex.exec(withImport);
  if (match === null) {
    throw new Error('bslt.config.ts is missing an installedModules array literal');
  }

  const currentList = (match[2] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (!currentList.includes(moduleVar)) {
    currentList.push(moduleVar);
  }

  return withImport.replace(installedRegex, `$1${currentList.join(', ')}$3`);
}

function buildModuleCatalogTable(
  id: string,
  scope: ModuleOwnerScope = 'user',
): Attributed<CatalogTable> {
  const isOrg = scope === 'org';
  const ownerColumn = isOrg ? 'org_id' : 'owner_user_id';
  const rlsClass = isOrg ? 'owner_org' : 'owner_user';
  const rlsFn = isOrg ? 'sys_current_org_id()' : 'sys_current_user_id()';
  const policyPrefix = isOrg ? 'rls_org' : 'rls_user';
  const fkeyClause = isOrg
    ? `${id}_org_id_fkey FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE`
    : `${id}_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES identity_users(id) ON DELETE CASCADE`;

  const constraints = [
    fkeyClause,
    `${id}_pkey PRIMARY KEY (id)`,
    `${id}_title_check CHECK (((char_length(TRIM(BOTH FROM title)) > 0) AND (char_length(title) <= 120)))`,
  ].sort(compareText);

  const indexes = [
    `CREATE INDEX idx_${id}_owner_created ON public.${id} USING btree (${ownerColumn}, created_at DESC)`,
    `CREATE INDEX idx_${id}_owner_open ON public.${id} USING btree (${ownerColumn}, created_at DESC) WHERE (completed = false)`,
    `CREATE UNIQUE INDEX ${id}_pkey ON public.${id} USING btree (id)`,
  ].sort(compareText);

  return {
    schema: 'public',
    name: id,
    source: id,
    kind: 'table',
    owner: 'bslt_owner',
    comment: `rls:${rlsClass}`,
    rowSecurity: {
      enabled: true,
      forced: true,
    },
    partition: null,
    columns: [
      'id uuid NOT NULL DEFAULT uuid_generate_v4()',
      `${ownerColumn} uuid NOT NULL`,
      'title text NOT NULL',
      'completed boolean NOT NULL DEFAULT false',
      'created_at timestamp with time zone NOT NULL DEFAULT now()',
      'updated_at timestamp with time zone NOT NULL DEFAULT now()',
    ],
    constraints,
    indexes,
    policies: [
      {
        name: `${policyPrefix}_delete`,
        command: 'DELETE',
        permissive: true,
        roles: ['authenticated'],
        using: `(${ownerColumn} = ${rlsFn})`,
        withCheck: null,
      },
      {
        name: `${policyPrefix}_insert`,
        command: 'INSERT',
        permissive: true,
        roles: ['authenticated'],
        using: null,
        withCheck: `(${ownerColumn} = ${rlsFn})`,
      },
      {
        name: `${policyPrefix}_select`,
        command: 'SELECT',
        permissive: true,
        roles: ['authenticated'],
        using: `(${ownerColumn} = ${rlsFn})`,
        withCheck: null,
      },
      {
        name: `${policyPrefix}_update`,
        command: 'UPDATE',
        permissive: true,
        roles: ['authenticated'],
        using: `(${ownerColumn} = ${rlsFn})`,
        withCheck: `(${ownerColumn} = ${rlsFn})`,
      },
    ],
    triggers: [
      `CREATE TRIGGER update_${id}_updated_at BEFORE UPDATE ON public.${id} FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column()`,
    ],
    grants: ['authenticated: DELETE, INSERT, SELECT, UPDATE'],
    columnGrants: [],
  };
}

function updateCatalogWithModule(root: string, id: string, scope: ModuleOwnerScope = 'user'): void {
  const catalogPath = path.join(root, DB_CATALOG.file);
  if (!existsSync(catalogPath)) return;

  const current = loadCatalog(root);
  const depOwner = scope === 'org' ? 'orgs' : 'identity';
  const rawSources: MigrationSource[] = [
    ...current.sources
      .filter((source) => source.id !== id)
      .map((source) => ({ id: source.id, dir: source.id, dependsOn: source.dependsOn })),
    { id, dir: id, dependsOn: [depOwner] },
  ];
  const orderedSources = orderSources(rawSources).map((source) => ({
    id: source.id,
    dependsOn: source.dependsOn,
  }));

  const nextTables = [
    ...current.tables.filter((table) => table.name !== id),
    buildModuleCatalogTable(id, scope),
  ].sort((a, b) => compareText(a.name, b.name));

  const nextCatalog: AttributedCatalog = {
    ...current,
    sources: orderedSources,
    tables: nextTables,
  };

  writeFileSync(catalogPath, serializeCatalog(nextCatalog));
}

function renderScaffoldFiles(id: string, scope: ModuleOwnerScope = 'user'): Map<string, string> {
  const isOrg = scope === 'org';
  const ownerColumn = isOrg ? 'org_id' : 'owner_user_id';
  const ownerCamel = isOrg ? 'orgId' : 'ownerUserId';
  const rlsClass = isOrg ? 'owner_org' : 'owner_user';
  const scopeLabel = isOrg ? 'Organization-owned' : 'User-owned';
  const Pascal = capitalize(id);
  const UPPER = id.toUpperCase();
  const base = `main/modules/${id}`;
  const files = new Map<string, string>();

  files.set(
    `${base}/package.json`,
    JSON.stringify(
      {
        name: `@bslt/${id}`,
        version: '1.0.0',
        type: 'module',
        description: `${scopeLabel} ${id} module`,
        author: 'Abraham Joongwhan Ahn',
        sideEffects: false,
        license: 'MIT',
        repository: {
          type: 'git',
          url: 'https://github.com/bslt/bslt.git',
          directory: base,
        },
        exports: {
          './module': {
            source: './module.ts',
            types: './dist/module.d.ts',
            default: './dist/module.js',
          },
          './contract': {
            source: './contract/index.ts',
            types: './dist/contract/index.d.ts',
            default: './dist/contract/index.js',
          },
          './server': {
            source: './server/index.ts',
            types: './dist/server/index.d.ts',
            default: './dist/server/index.js',
          },
          './web': {
            source: './web/index.ts',
            types: './dist/web/index.d.ts',
            default: './dist/web/index.js',
          },
          './package.json': './package.json',
        },
        files: ['dist', 'server/migrations'],
        scripts: {
          build:
            'rm -rf dist node_modules/.cache/typescript/*.tsbuildinfo && tsc -p tsconfig.json && bslt-esm-fix dist',
          test: 'vitest run --reporter=dot --silent=passed-only',
          lint: `eslint . --cache --cache-location ../../../node_modules/.cache/eslint/.eslintcache-bslt-${id} --report-unused-disable-directives --max-warnings 0`,
          'type-check': 'tsc -p tsconfig.lint.json',
          clean: 'rm -rf dist node_modules/.cache/typescript/*.tsbuildinfo',
        },
        dependencies: {
          '@bslt/contract': 'workspace:*',
          '@bslt/db': 'workspace:*',
          ...(isOrg ? { '@bslt/orgs': 'workspace:*' } : { '@bslt/identity': 'workspace:*' }),
          '@bslt/schema': 'workspace:*',
          '@bslt/server-system': 'workspace:*',
        },
        devDependencies: {
          '@bslt/build-config': 'workspace:*',
          '@bslt/client-engine': 'workspace:*',
          '@bslt/react': 'workspace:*',
          '@bslt/ui': 'workspace:*',
          '@bslt/web-platform': 'workspace:*',
          '@testing-library/jest-dom': '^7.0.1',
          '@testing-library/react': '^16.3.3',
          '@testing-library/user-event': '^14.6.8',
          '@types/react': '^19.3.0',
          '@types/react-dom': '^19.3.0',
          react: '^19.3.1',
          'react-dom': '^19.3.1',
          typescript: '^5.9.3',
          vite: '^8.3.6',
          vitest: '^5.1.0',
        },
        peerDependencies: {
          '@bslt/client-engine': 'workspace:*',
          '@bslt/react': 'workspace:*',
          '@bslt/ui': 'workspace:*',
          '@bslt/web-platform': 'workspace:*',
          react: '^19.2.3',
          'react-dom': '^19.2.3',
        },
        peerDependenciesMeta: {
          '@bslt/client-engine': { optional: true },
          '@bslt/react': { optional: true },
          '@bslt/ui': { optional: true },
          '@bslt/web-platform': { optional: true },
          react: { optional: true },
          'react-dom': { optional: true },
        },
        publishConfig: {
          access: 'public',
        },
      },
      null,
      2,
    ),
  );

  files.set(
    `${base}/tsconfig.json`,
    JSON.stringify(
      {
        extends: '../../../config/tsconfig.base.json',
        compilerOptions: {
          outDir: './dist',
          rootDir: '.',
          jsx: 'react-jsx',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          types: ['node'],
          tsBuildInfoFile: `./node_modules/.cache/typescript/tsconfig.${id}.tsbuildinfo`,
        },
        include: [
          'module.ts',
          'contract/**/*.ts',
          'server/**/*.ts',
          'web/**/*.ts',
          'web/**/*.tsx',
          'i18n/**/*.json',
        ],
        exclude: [
          'node_modules',
          'dist',
          'vitest.config.ts',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          '**/*.spec.tsx',
          '**/*.real-db.test.ts',
          '**/__tests__/**',
        ],
        references: [
          { path: '../../kernel/client' },
          { path: '../../kernel/contract' },
          { path: '../../kernel/db' },
          { path: '../../kernel/react' },
          { path: '../../kernel/schema' },
          { path: '../../kernel/server' },
          { path: '../../kernel/ui' },
          { path: '../../kernel/web' },
          { path: '../identity' },
        ],
      },
      null,
      2,
    ),
  );

  files.set(
    `${base}/tsconfig.lint.json`,
    JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          composite: false,
          noEmit: true,
          types: ['@testing-library/jest-dom', 'node'],
        },
        include: [
          'module.ts',
          'contract/**/*.ts',
          'server/**/*.ts',
          'web/**/*.ts',
          'web/**/*.tsx',
          'i18n/**/*.json',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.real-db.test.ts',
        ],
        exclude: ['node_modules', 'dist', 'vitest.config.ts'],
      },
      null,
      2,
    ),
  );

  files.set(
    `${base}/vitest.config.ts`,
    `// ${base}/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

const isCI = process.env.CI === 'true';

export default defineVitestConfig({
  test: {
    name: '@bslt/${id}',
    environment: 'jsdom',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.real-db.test.ts'],
    testTimeout: 10000,
    pool: isCI ? 'forks' : 'threads',
    maxConcurrency: isCI ? 1 : 4,
    fileParallelism: !isCI,
    minWorkers: 1,
    maxWorkers: isCI ? 1 : 4,
  },
});
`,
  );

  files.set(
    `${base}/README.md`,
    `# \`@bslt/${id}\`

User-owned ${id} module.

<!-- bslt:generated reference -->
<!-- /bslt:generated -->
`,
  );

  files.set(
    `${base}/module.ts`,
    `// ${base}/module.ts
import { defineModule } from '@bslt/contract';
${isOrg ? "import { orgsModule } from '@bslt/orgs/module';" : "import { identityModule } from '@bslt/identity/module';"}

import { ${id}Endpoints, ${id}Events } from './contract';

export const ${id}Module = defineModule({
  id: '${id}',
  summary: '${scopeLabel} ${id} module.',
  status: 'stable',
  dependsOn: [${isOrg ? 'orgsModule' : 'identityModule'}],${isOrg ? `\n  permissions: ['${id}.manage'],` : ''}
  endpoints: ${id}Endpoints,
  events: ${id}Events,
  jobs: {},
  tables: ['${id}'],
});
`,
  );

  files.set(
    `${base}/module.test.ts`,
    `// ${base}/module.test.ts
import { describe, expect, it } from 'vitest';

import { defineModule } from '@bslt/contract';
import { identityModule } from '@bslt/identity/module';

import { ${id}Module } from './module';

describe('${id}Module', () => {
  it('declares id, identity dependency, ${id} table, endpoints, and events', () => {
    expect(${id}Module.id).toBe('${id}');
    expect(${id}Module.status).toBe('stable');
    expect(${id}Module.dependsOn).toEqual([identityModule]);
    expect(${id}Module.tables).toEqual(['${id}']);
    expect(Object.keys(${id}Module.endpoints)).toEqual(['list', 'create', 'update', 'delete']);
    expect(Object.keys(${id}Module.events)).toEqual(['created', 'updated', 'deleted']);
  });

  it('freezes the module manifest against mutation', () => {
    expect(Object.isFrozen(${id}Module)).toBe(true);
    expect(() => {
      (${id}Module as { id: string }).id = 'mutated';
    }).toThrow(TypeError);
  });

  it('rejects tables that do not carry the module prefix', () => {
    expect(() =>
      defineModule({
        id: '${id}',
        summary: 'Bad table test',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: ['unrelated_table'],
      }),
    ).toThrow(/must equal "${id}" or start with "${id}_"/iu);
  });

  it('rejects invalid module identifiers', () => {
    expect(() =>
      defineModule({
        id: '${Pascal}Invalid',
        summary: 'Bad id test',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
      }),
    ).toThrow();
  });
});
`,
  );

  files.set(
    `${base}/contract/schemas.ts`,
    `// ${base}/contract/schemas.ts
import {
  array,
  boolean,
  isoDateTimeSchema,
  object,
  optional,
  refine,
  string,
  uuidSchema,
  type Infer,
} from '@bslt/schema';

const titleSchema = string({
  label: 'title',
  trim: true,
  min: 1,
  max: 120,
});

export const ${id}ItemSchema = object({
  id: uuidSchema,
  ownerId: uuidSchema,
  title: titleSchema,
  completed: boolean({ label: 'completed' }),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const create${Pascal}RequestSchema = object({
  title: titleSchema,
});

export const update${Pascal}RequestSchema = refine(
  object({
    title: optional(titleSchema),
    completed: optional(boolean({ label: 'completed' })),
  }),
  (val) => val.title !== undefined || val.completed !== undefined,
  'at least one field is required',
);

export const ${id}ListResponseSchema = object({
  items: array(${id}ItemSchema),
});

export const ${id}MutationResponseSchema = object({
  item: ${id}ItemSchema,
});

export type ${Pascal}Item = Infer<typeof ${id}ItemSchema>;
export type Create${Pascal}Request = Infer<typeof create${Pascal}RequestSchema>;
export type Update${Pascal}Request = Infer<typeof update${Pascal}RequestSchema>;
export type ${Pascal}ListResponse = Infer<typeof ${id}ListResponseSchema>;
export type ${Pascal}MutationResponse = Infer<typeof ${id}MutationResponseSchema>;
`,
  );

  files.set(
    `${base}/contract/schemas.test.ts`,
    `// ${base}/contract/schemas.test.ts
import { describe, expect, it } from 'vitest';

import {
  create${Pascal}RequestSchema,
  ${id}ItemSchema,
  ${id}ListResponseSchema,
  ${id}MutationResponseSchema,
  update${Pascal}RequestSchema,
} from './index';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const OWNER_UUID = '22222222-2222-4222-8222-222222222222';
const VALID_ISO = '2026-01-01T00:00:00.000Z';

describe('${id} contract schemas', () => {
  it('parses and trims a valid Create${Pascal}Request', () => {
    expect(create${Pascal}RequestSchema.parse({ title: '  Ship module  ' })).toEqual({
      title: 'Ship module',
    });
  });

  it('parses valid Update${Pascal}Request variants', () => {
    expect(update${Pascal}RequestSchema.parse({ title: '  Rename  ' })).toEqual({ title: 'Rename' });
    expect(update${Pascal}RequestSchema.parse({ completed: true })).toEqual({ completed: true });
    expect(update${Pascal}RequestSchema.parse({ title: 'Both', completed: false })).toEqual({
      title: 'Both',
      completed: false,
    });
  });

  it('parses valid item, list response, and mutation response payloads', () => {
    const validItem = {
      id: VALID_UUID,
      ownerId: OWNER_UUID,
      title: 'Verify schemas',
      completed: false,
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    };
    expect(${id}ItemSchema.parse(validItem)).toEqual(validItem);
    expect(${id}ListResponseSchema.parse({ items: [validItem] })).toEqual({ items: [validItem] });
    expect(${id}MutationResponseSchema.parse({ item: validItem })).toEqual({ item: validItem });
  });

  it('rejects empty or whitespace-only titles', () => {
    expect(() => create${Pascal}RequestSchema.parse({ title: '' })).toThrow();
    expect(() => create${Pascal}RequestSchema.parse({ title: '     ' })).toThrow();
  });

  it('rejects titles exceeding 120 characters', () => {
    expect(() => create${Pascal}RequestSchema.parse({ title: 'x'.repeat(121) })).toThrow();
  });

  it('rejects unknown extra fields on strict request objects', () => {
    expect(() =>
      create${Pascal}RequestSchema.parse({ title: 'Valid', injected: true }),
    ).toThrow();
    expect(() =>
      update${Pascal}RequestSchema.parse({ completed: true, extra: 'nope' }),
    ).toThrow();
  });

  it('rejects Update${Pascal}Request when neither title nor completed is provided', () => {
    expect(() => update${Pascal}RequestSchema.parse({})).toThrow(/at least one field/iu);
    expect(() =>
      update${Pascal}RequestSchema.parse({ title: undefined, completed: undefined }),
    ).toThrow(/at least one field/iu);
  });

  it('rejects invalid UUIDs on item id or ownerId', () => {
    expect(() =>
      ${id}ItemSchema.parse({
        id: 'not-a-uuid',
        ownerId: OWNER_UUID,
        title: 'Entry',
        completed: false,
        createdAt: VALID_ISO,
        updatedAt: VALID_ISO,
      }),
    ).toThrow();
    expect(() =>
      ${id}ItemSchema.parse({
        id: VALID_UUID,
        ownerId: 'not-a-uuid',
        title: 'Entry',
        completed: false,
        createdAt: VALID_ISO,
        updatedAt: VALID_ISO,
      }),
    ).toThrow();
  });

  it('rejects invalid ISO timestamps on createdAt or updatedAt', () => {
    expect(() =>
      ${id}ItemSchema.parse({
        id: VALID_UUID,
        ownerId: OWNER_UUID,
        title: 'Entry',
        completed: false,
        createdAt: 'yesterday',
        updatedAt: VALID_ISO,
      }),
    ).toThrow();
  });

  it('rejects non-boolean completed values', () => {
    expect(() => update${Pascal}RequestSchema.parse({ completed: 'true' })).toThrow();
  });
});
`,
  );

  files.set(
    `${base}/contract/errors.ts`,
    `// ${base}/contract/errors.ts
import { defineErrors } from '@bslt/contract';

export const ${id}Errors = defineErrors('${id}', {${isOrg ? '\n  ORG_REQUIRED: 400,' : ''}
  ${UPPER}_NOT_FOUND: 404,
});
`,
  );

  files.set(
    `${base}/contract/errors.test.ts`,
    `// ${base}/contract/errors.test.ts
import { describe, expect, it } from 'vitest';

import { defineErrors, lookupErrorCode } from '@bslt/contract';

import { ${id}Errors } from './errors';

describe('${id}Errors', () => {
  it('registers ${id}.${UPPER}_NOT_FOUND with status 404', () => {
    expect(${id}Errors.${UPPER}_NOT_FOUND).toBe('${id}.${UPPER}_NOT_FOUND');
    expect(lookupErrorCode(${id}Errors.${UPPER}_NOT_FOUND)).toMatchObject({
      code: '${id}.${UPPER}_NOT_FOUND',
      status: 404,
      kind: 'not_found',
    });
  });

  it('returns undefined when looking up an unregistered ${id} error code', () => {
    expect(lookupErrorCode('${id}.UNKNOWN_ERROR')).toBeUndefined();
  });

  it('rejects re-registering ${id}.${UPPER}_NOT_FOUND with a conflicting HTTP status', () => {
    expect(() => defineErrors('${id}', { ${UPPER}_NOT_FOUND: 400 })).toThrow(/already registered/iu);
  });

  it('rejects invalid uppercase namespace identifiers', () => {
    expect(() => defineErrors('${Pascal}', { BAD_KEY: 404 })).toThrow();
  });

  it('rejects non-SCREAMING_SNAKE_CASE error keys', () => {
    expect(() => defineErrors('${id}bad', { notFound: 404 })).toThrow();
  });
});
`,
  );

  files.set(
    `${base}/contract/endpoints.ts`,
    `// ${base}/contract/endpoints.ts
import { emptyBodySchema, endpoint } from '@bslt/contract';
import { object, uuidSchema } from '@bslt/schema';

import { ${id}Errors } from './errors';
import {
  create${Pascal}RequestSchema,
  ${id}ListResponseSchema,
  ${id}MutationResponseSchema,
  update${Pascal}RequestSchema,
} from './schemas';

export const ${id}Endpoints = {
  list: endpoint({
    method: 'GET',
    path: '/api/${id}',
    auth: 'user',
    response: ${id}ListResponseSchema,
    persist: true,
    summary: 'List ${id} items owned by the authenticated user',
  }),
  create: endpoint({
    method: 'POST',
    path: '/api/${id}/create',
    auth: 'user',
    body: create${Pascal}RequestSchema,
    response: ${id}MutationResponseSchema,
    invalidates: ['list'],
    summary: 'Create a ${id} item for the authenticated user',
  }),
  update: endpoint({
    method: 'POST',
    path: '/api/${id}/:id/update',
    auth: 'user',
    params: object({ id: uuidSchema }),
    body: update${Pascal}RequestSchema,
    response: ${id}MutationResponseSchema,
    errors: [${id}Errors.${UPPER}_NOT_FOUND],
    invalidates: ['list'],
    summary: 'Update an owned ${id} item',
  }),
  delete: endpoint({
    method: 'POST',
    path: '/api/${id}/:id/delete',
    auth: 'user',
    params: object({ id: uuidSchema }),
    body: emptyBodySchema,
    response: ${id}MutationResponseSchema,
    errors: [${id}Errors.${UPPER}_NOT_FOUND],
    invalidates: ['list'],
    summary: 'Delete an owned ${id} item',
  }),
} as const;
`,
  );

  files.set(
    `${base}/contract/endpoints.test.ts`,
    `// ${base}/contract/endpoints.test.ts
import { describe, expect, it } from 'vitest';

import { ${id}Endpoints, ${id}Errors } from './index';

describe('${id}Endpoints', () => {
  it('declares list, create, update, and delete endpoints with expected HTTP contracts', () => {
    expect(${id}Endpoints.list).toMatchObject({
      method: 'GET',
      path: '/api/${id}',
      auth: 'user',
      persist: true,
    });
    expect(${id}Endpoints.create).toMatchObject({
      method: 'POST',
      path: '/api/${id}/create',
      auth: 'user',
      invalidates: ['list'],
    });
    expect(${id}Endpoints.update).toMatchObject({
      method: 'POST',
      path: '/api/${id}/:id/update',
      auth: 'user',
      errors: [${id}Errors.${UPPER}_NOT_FOUND],
      invalidates: ['list'],
    });
    expect(${id}Endpoints.delete).toMatchObject({
      method: 'POST',
      path: '/api/${id}/:id/delete',
      auth: 'user',
      errors: [${id}Errors.${UPPER}_NOT_FOUND],
      invalidates: ['list'],
    });
  });

  it('accepts valid UUID path params on update and delete', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(${id}Endpoints.update.params?.parse({ id })).toEqual({ id });
    expect(${id}Endpoints.delete.params?.parse({ id })).toEqual({ id });
  });

  it('rejects non-UUID path params on update and delete', () => {
    expect(() => ${id}Endpoints.update.params?.parse({ id: '123' })).toThrow();
    expect(() => ${id}Endpoints.delete.params?.parse({ id: 'bad-id' })).toThrow();
  });

  it('rejects unexpected body fields on delete emptyBodySchema', () => {
    expect(() => ${id}Endpoints.delete.body?.parse({ extra: 1 })).toThrow();
  });

  it('rejects invalid request bodies on create and update', () => {
    expect(() => ${id}Endpoints.create.body?.parse({})).toThrow();
    expect(() => ${id}Endpoints.update.body?.parse({})).toThrow();
  });
});
`,
  );

  files.set(
    `${base}/contract/events.ts`,
    `// ${base}/contract/events.ts
import { event } from '@bslt/contract';
import { boolean, object, string } from '@bslt/schema';

const ${id}LifecyclePayloadSchema = object({
  itemId: string({ min: 1 }),
  userId: string({ min: 1 }),
});

const ${id}UpdatedPayloadSchema = object({
  itemId: string({ min: 1 }),
  userId: string({ min: 1 }),
  completed: boolean(),
});

export const ${id}Events = {
  created: event('${id}.item.created', ${id}LifecyclePayloadSchema, {
    audit: { category: 'data', severity: 'info' },
    activity: true,
    realtime: (payload) => ({
      channel: \`user:\${payload.userId}\`,
      invalidate: ['list'],
    }),
  }),
  updated: event('${id}.item.updated', ${id}UpdatedPayloadSchema, {
    audit: { category: 'data', severity: 'info' },
    activity: true,
    realtime: (payload) => ({
      channel: \`user:\${payload.userId}\`,
      invalidate: ['list'],
    }),
  }),
  deleted: event('${id}.item.deleted', ${id}LifecyclePayloadSchema, {
    audit: { category: 'data', severity: 'info' },
    activity: true,
    realtime: (payload) => ({
      channel: \`user:\${payload.userId}\`,
      invalidate: ['list'],
    }),
  }),
} as const;
`,
  );

  files.set(
    `${base}/contract/events.test.ts`,
    `// ${base}/contract/events.test.ts
import { describe, expect, it } from 'vitest';

import { ${id}Events } from './events';

describe('${id}Events', () => {
  it('declares created, updated, and deleted events with audit, activity, and realtime metadata', () => {
    expect(${id}Events.created.name).toBe('${id}.item.created');
    expect(${id}Events.created.audit).toEqual({ category: 'data', severity: 'info' });
    expect(${id}Events.created.activity).toBe(true);
    expect(
      ${id}Events.created.realtime?.({
        itemId: 'item-1',
        userId: 'user-1',
      }),
    ).toEqual({
      channel: 'user:user-1',
      invalidate: ['list'],
    });

    expect(${id}Events.updated.name).toBe('${id}.item.updated');
    expect(${id}Events.updated.audit).toEqual({ category: 'data', severity: 'info' });
    expect(${id}Events.updated.activity).toBe(true);
    expect(
      ${id}Events.updated.realtime?.({
        itemId: 'item-1',
        userId: 'user-1',
        completed: true,
      }),
    ).toEqual({
      channel: 'user:user-1',
      invalidate: ['list'],
    });

    expect(${id}Events.deleted.name).toBe('${id}.item.deleted');
    expect(${id}Events.deleted.audit).toEqual({ category: 'data', severity: 'info' });
    expect(${id}Events.deleted.activity).toBe(true);
    expect(
      ${id}Events.deleted.realtime?.({
        itemId: 'item-1',
        userId: 'user-1',
      }),
    ).toEqual({
      channel: 'user:user-1',
      invalidate: ['list'],
    });
  });

  it('parses valid event payloads', () => {
    expect(
      ${id}Events.created.payload.parse({
        itemId: 'item-1',
        userId: 'user-1',
      }),
    ).toEqual({
      itemId: 'item-1',
      userId: 'user-1',
    });

    expect(
      ${id}Events.updated.payload.parse({
        itemId: 'item-1',
        userId: 'user-1',
        completed: false,
      }),
    ).toEqual({
      itemId: 'item-1',
      userId: 'user-1',
      completed: false,
    });
  });

  it('rejects empty itemId or userId in created and deleted payloads', () => {
    expect(${id}Events.created.payload.safeParse({ itemId: '', userId: 'user-1' }).success).toBe(
      false,
    );
    expect(${id}Events.created.payload.safeParse({ itemId: 'item-1', userId: '' }).success).toBe(
      false,
    );
    expect(${id}Events.deleted.payload.safeParse({ itemId: '', userId: 'user-1' }).success).toBe(
      false,
    );
    expect(${id}Events.deleted.payload.safeParse({ itemId: 'item-1', userId: '' }).success).toBe(
      false,
    );
  });

  it('rejects missing fields and non-object inputs across all ${id} events', () => {
    expect(${id}Events.created.payload.safeParse(null).success).toBe(false);
    expect(${id}Events.created.payload.safeParse(undefined).success).toBe(false);
    expect(${id}Events.created.payload.safeParse('item-1').success).toBe(false);
    expect(${id}Events.created.payload.safeParse({}).success).toBe(false);
    expect(${id}Events.deleted.payload.safeParse({ itemId: 'item-1' }).success).toBe(false);
  });

  it('rejects invalid completed flag and wrong types in updated payload', () => {
    expect(
      ${id}Events.updated.payload.safeParse({
        itemId: 'item-1',
        userId: 'user-1',
        completed: 'yes',
      }).success,
    ).toBe(false);
    expect(
      ${id}Events.updated.payload.safeParse({
        itemId: 'item-1',
        userId: 'user-1',
      }).success,
    ).toBe(false);
    expect(
      ${id}Events.updated.payload.safeParse({
        itemId: 123,
        userId: 'user-1',
        completed: true,
      }).success,
    ).toBe(false);
  });
});
`,
  );

  files.set(
    `${base}/contract/index.ts`,
    `// ${base}/contract/index.ts
export { ${id}Endpoints } from './endpoints';
export { ${id}Errors } from './errors';
export { ${id}Events } from './events';
export {
  create${Pascal}RequestSchema,
  ${id}ItemSchema,
  ${id}ListResponseSchema,
  ${id}MutationResponseSchema,
  update${Pascal}RequestSchema,
  type Create${Pascal}Request,
  type ${Pascal}Item,
  type ${Pascal}ListResponse,
  type ${Pascal}MutationResponse,
  type Update${Pascal}Request,
} from './schemas';
`,
  );

  files.set(
    `${base}/server/migrations/0001_${id}.sql`,
    `-- 0001_${id}.sql
-- Owned DDL baseline of the ${id} module (\`@bslt/${id}\`): ${scopeLabel.toLowerCase()} ${id}.
--
-- Depends on: kernel, ${isOrg ? 'orgs (orgs)' : 'identity (users)'}.
--
-- Commands per role (sys_apply_rls: user, admin, system):
--
--   table  class       user  admin  system
--   ${id}  ${rlsClass}  all   -      -

CREATE TABLE ${id} (
    id            uuid        NOT NULL DEFAULT uuid_generate_v4(),
    ${ownerColumn} uuid        NOT NULL,
    title         text        NOT NULL,
    completed     boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ${id}_pkey PRIMARY KEY (id),
    CONSTRAINT ${id}_title_check CHECK (((char_length(TRIM(BOTH FROM title)) > 0) AND (char_length(title) <= 120))),
    CONSTRAINT ${id}_${ownerColumn}_fkey FOREIGN KEY (${ownerColumn}) REFERENCES ${isOrg ? 'orgs(id)' : 'identity_users(id)'} ON DELETE CASCADE
);

CREATE INDEX idx_${id}_owner_created ON ${id} (${ownerColumn}, created_at DESC);
CREATE INDEX idx_${id}_owner_open ON ${id} (${ownerColumn}, created_at DESC) WHERE (completed = false);

CREATE TRIGGER update_${id}_updated_at BEFORE UPDATE ON ${id} FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    '${id}', '${rlsClass}', '${ownerColumn}',
    ARRAY['select', 'insert', 'update', 'delete'],
    ARRAY[]::text[],
    ARRAY[]::text[]
);
`,
  );

  files.set(
    `${base}/server/repository.ts`,
    `// ${base}/server/repository.ts
import { and, deleteFrom, eq, insert, select, toCamelCase, toSnakeCase, update } from '@bslt/db';

import {
  ${UPPER}_COLUMNS,
  ${UPPER}_TABLE,
  type ${Pascal}Insert,
  type ${Pascal}Row,
  type ${Pascal}Update,
} from './generated/rows';

import type { RawDb } from '@bslt/db';

export interface ${Pascal}Repository {
  listByOwner(${ownerCamel}: string): Promise<${Pascal}Row[]>;
  create(data: ${Pascal}Insert): Promise<${Pascal}Row>;
  updateForOwner(${ownerCamel}: string, id: string, data: ${Pascal}Update): Promise<${Pascal}Row | null>;
  deleteForOwner(${ownerCamel}: string, id: string): Promise<${Pascal}Row | null>;
}

function transformRow(row: Record<string, unknown>): ${Pascal}Row {
  return toCamelCase<${Pascal}Row>(row, ${UPPER}_COLUMNS);
}

export function ${id}Repository(db: RawDb): ${Pascal}Repository {
  return {
    async listByOwner(${ownerCamel}: string): Promise<${Pascal}Row[]> {
      const results = await db.query(
        select(${UPPER}_TABLE)
          .where(eq('${ownerColumn}', ${ownerCamel}))
          .orderBy('created_at', 'desc')
          .toSql(),
      );
      return results.map(transformRow);
    },

    async create(data: ${Pascal}Insert): Promise<${Pascal}Row> {
      const snakeData = toSnakeCase(data, ${UPPER}_COLUMNS);
      const result = await db.queryOne(
        insert(${UPPER}_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create ${id} item');
      }
      return transformRow(result);
    },

    async updateForOwner(
      ${ownerCamel}: string,
      id: string,
      data: ${Pascal}Update,
    ): Promise<${Pascal}Row | null> {
      const snakeData = toSnakeCase({ ...data, updatedAt: new Date() }, ${UPPER}_COLUMNS);
      const result = await db.queryOne(
        update(${UPPER}_TABLE)
          .set(snakeData)
          .where(and(eq('id', id), eq('${ownerColumn}', ${ownerCamel})))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformRow(result) : null;
    },

    async deleteForOwner(${ownerCamel}: string, id: string): Promise<${Pascal}Row | null> {
      const result = await db.queryOne(
        deleteFrom(${UPPER}_TABLE)
          .where(and(eq('id', id), eq('${ownerColumn}', ${ownerCamel})))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformRow(result) : null;
    },
  };
}
`,
  );

  files.set(
    `${base}/server/repository.test.ts`,
    `// ${base}/server/repository.test.ts
import { describe, expect, it, vi } from 'vitest';

import { ${id}Repository } from './repository';

import type { RawDb } from '@bslt/db';

function makeRawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    owner_user_id: '22222222-2222-4222-8222-222222222222',
    title: 'Write tests first',
    completed: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeMockDb(overrides: {
  query?: ReturnType<typeof vi.fn>;
  queryOne?: ReturnType<typeof vi.fn>;
} = {}): { db: RawDb; query: ReturnType<typeof vi.fn>; queryOne: ReturnType<typeof vi.fn> } {
  const query = overrides.query ?? vi.fn().mockResolvedValue([]);
  const queryOne = overrides.queryOne ?? vi.fn().mockResolvedValue(null);
  const db = {
    query,
    queryOne,
    execute: vi.fn(),
    transaction: vi.fn(),
    raw: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
  } as unknown as RawDb;
  return { db, query, queryOne };
}

describe('${id}Repository', () => {
  it('queries and maps rows using owner_user_id <-> ownerUserId', async () => {
    const row = makeRawRow();
    const { db, query, queryOne } = makeMockDb({
      query: vi.fn().mockResolvedValue([row]),
      queryOne: vi.fn().mockResolvedValue(row),
    });
    const repo = ${id}Repository(db);

    const listed = await repo.listByOwner('22222222-2222-4222-8222-222222222222');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.ownerUserId).toBe('22222222-2222-4222-8222-222222222222');
    expect(String((query.mock.calls[0]?.[0] as { text?: string } | undefined)?.text)).toContain(
      'owner_user_id',
    );

    const created = await repo.create({
      ownerUserId: '22222222-2222-4222-8222-222222222222',
      title: 'Write tests first',
    });
    expect(created.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(String((queryOne.mock.calls[0]?.[0] as { text?: string } | undefined)?.text)).toContain(
      'owner_user_id',
    );
  });

  it('updates and deletes scoped by both id and owner_user_id', async () => {
    const updatedRow = makeRawRow({ completed: true });
    const { db, queryOne } = makeMockDb({
      queryOne: vi.fn().mockResolvedValue(updatedRow),
    });
    const repo = ${id}Repository(db);

    const updated = await repo.updateForOwner(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { completed: true },
    );
    expect(updated?.completed).toBe(true);

    const deleted = await repo.deleteForOwner(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(deleted?.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(queryOne).toHaveBeenCalledTimes(2);
  });

  it('throws when INSERT returns null', async () => {
    const { db } = makeMockDb({ queryOne: vi.fn().mockResolvedValue(null) });
    const repo = ${id}Repository(db);

    await expect(
      repo.create({ ownerUserId: '22222222-2222-4222-8222-222222222222', title: 'Missing' }),
    ).rejects.toThrow('Failed to create ${id} item');
  });

  it('returns null when updateForOwner finds no matching owned row', async () => {
    const { db } = makeMockDb({ queryOne: vi.fn().mockResolvedValue(null) });
    const repo = ${id}Repository(db);

    await expect(
      repo.updateForOwner('other-owner', '11111111-1111-4111-8111-111111111111', {
        completed: true,
      }),
    ).resolves.toBeNull();
  });

  it('returns null when deleteForOwner finds no matching owned row', async () => {
    const { db } = makeMockDb({ queryOne: vi.fn().mockResolvedValue(null) });
    const repo = ${id}Repository(db);

    await expect(
      repo.deleteForOwner('other-owner', '11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeNull();
  });

  it('propagates underlying database errors without swallowing them', async () => {
    const { db } = makeMockDb({
      query: vi.fn().mockRejectedValue(new Error('connection terminated')),
    });
    const repo = ${id}Repository(db);

    await expect(repo.listByOwner('22222222-2222-4222-8222-222222222222')).rejects.toThrow(
      'connection terminated',
    );
  });
});
`,
  );

  files.set(
    `${base}/server/repository.real-db.test.ts`,
    `// ${base}/server/repository.real-db.test.ts
import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { describeOwnerIsolation, describeRealDb } from '@bslt/server-system/testing/real-db';

import { ${id}Repository } from './repository';

import type { DbClient, RawDb } from '@bslt/db';

async function insertReturningId(
  admin: DbClient,
  text: string,
  values: unknown[],
): Promise<string> {
  const row = await admin.queryOne<{ id: string }>({ text, values });
  if (row === null) throw new Error(\`INSERT returned no row: \${text}\`);
  return row.id;
}

describeRealDb('${id} repository and RLS owner isolation (Real DB)', (realDb) => {
  const asUser = <T>(userId: string, fn: (tx: RawDb) => Promise<T>): Promise<T> =>
    realDb.database.appDb.withSession({ userId, role: 'user' }).transaction(fn);

  describeOwnerIsolation(realDb, [
    {
      table: '${id}',
      seedRow: (admin, ownerId) =>
        insertReturningId(
          admin,
          \`INSERT INTO ${id} (owner_user_id, title) VALUES ($1, 'for the owner') RETURNING id\`,
          [ownerId],
        ),
      update: 'completed = true',
      ownerMayDelete: true,
    },
  ]);

  it('forbids inserting a row with a foreign owner_user_id on a bslt_app user session', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const emailA = \`a-\${userA}@${id}-rls.test\`;
    const emailB = \`b-\${userB}@${id}-rls.test\`;
    await realDb.database.adminDb.execute({
      text: \`INSERT INTO identity_users (id, email, canonical_email)
             VALUES ($1, $2, $2), ($3, $4, $4)\`,
      values: [userA, emailA, userB, emailB],
    });

    await expect(
      asUser(userA, (tx) =>
        ${id}Repository(tx).create({
          ownerUserId: userB,
          title: 'Forged owner attempt',
        }),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it('creates, lists, updates, and deletes owned rows through ${id}Repository under RLS', async () => {
    const userA = randomUUID();
    const emailA = \`owner-\${userA}@${id}-rls.test\`;
    await realDb.database.adminDb.execute({
      text: \`INSERT INTO identity_users (id, email, canonical_email) VALUES ($1, $2, $2)\`,
      values: [userA, emailA],
    });

    const created = await asUser(userA, (tx) =>
      ${id}Repository(tx).create({
        ownerUserId: userA,
        title: 'Real DB item',
      }),
    );
    expect(created.ownerUserId).toBe(userA);
    expect(created.completed).toBe(false);

    const listed = await asUser(userA, (tx) => ${id}Repository(tx).listByOwner(userA));
    expect(listed.map((row) => row.id)).toEqual([created.id]);

    const updated = await asUser(userA, (tx) =>
      ${id}Repository(tx).updateForOwner(userA, created.id, { completed: true }),
    );
    expect(updated?.completed).toBe(true);

    const deleted = await asUser(userA, (tx) =>
      ${id}Repository(tx).deleteForOwner(userA, created.id),
    );
    expect(deleted?.id).toBe(created.id);
  });
});
`,
  );

  files.set(
    `${base}/server/service.ts`,
    `// ${base}/server/service.ts
import type { Create${Pascal}Request, ${Pascal}Item, Update${Pascal}Request } from '../contract';
import type { ${Pascal}Row, ${Pascal}Update } from './generated/rows';
import type { ${Pascal}Repository } from './repository';

function toItem(record: ${Pascal}Row): ${Pascal}Item {
  return {
    id: record.id,
    ownerId: record.${ownerCamel},
    title: record.title,
    completed: record.completed,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function list${Pascal}Items(
  ${ownerCamel}: string,
  repo: ${Pascal}Repository,
): Promise<${Pascal}Item[]> {
  const records = await repo.listByOwner(${ownerCamel});
  return records.map(toItem);
}

export async function create${Pascal}Item(
  ${ownerCamel}: string,
  input: Create${Pascal}Request,
  repo: ${Pascal}Repository,
): Promise<${Pascal}Item> {
  return toItem(await repo.create({ ${ownerCamel}, title: input.title }));
}

export async function update${Pascal}Item(
  ${ownerCamel}: string,
  id: string,
  input: Update${Pascal}Request,
  repo: ${Pascal}Repository,
): Promise<${Pascal}Item | null> {
  const patch: ${Pascal}Update = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.completed !== undefined ? { completed: input.completed } : {}),
  };
  const record = await repo.updateForOwner(${ownerCamel}, id, patch);
  return record !== null ? toItem(record) : null;
}

export async function delete${Pascal}Item(
  ${ownerCamel}: string,
  id: string,
  repo: ${Pascal}Repository,
): Promise<${Pascal}Item | null> {
  const record = await repo.deleteForOwner(${ownerCamel}, id);
  return record !== null ? toItem(record) : null;
}
`,
  );

  files.set(
    `${base}/server/service.test.ts`,
    `// ${base}/server/service.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  create${Pascal}Item,
  delete${Pascal}Item,
  list${Pascal}Items,
  update${Pascal}Item,
} from './service';

import type { ${Pascal}Row } from './generated/rows';
import type { ${Pascal}Repository } from './repository';

function buildRow(overrides: Partial<${Pascal}Row> = {}): ${Pascal}Row {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerUserId: '22222222-2222-4222-8222-222222222222',
    title: 'Domain service test',
    completed: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<${Pascal}Repository> = {}): ${Pascal}Repository {
  return {
    listByOwner: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(buildRow()),
    updateForOwner: vi.fn().mockResolvedValue(null),
    deleteForOwner: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('${id} service', () => {
  it('maps ${Pascal}Row.ownerUserId to ${Pascal}Item.ownerId and Dates to ISO strings on list and create', async () => {
    const row = buildRow();
    const repo = makeRepo({
      listByOwner: vi.fn().mockResolvedValue([row]),
      create: vi.fn().mockResolvedValue(row),
    });

    const listed = await list${Pascal}Items('22222222-2222-4222-8222-222222222222', repo);
    expect(listed).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        ownerId: '22222222-2222-4222-8222-222222222222',
        title: 'Domain service test',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const created = await create${Pascal}Item(
      '22222222-2222-4222-8222-222222222222',
      { title: 'Domain service test' },
      repo,
    );
    expect(created.ownerId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('forwards partial updates and maps the updated row', async () => {
    const updateForOwner = vi.fn().mockResolvedValue(buildRow({ completed: true }));
    const repo = makeRepo({ updateForOwner });

    const updated = await update${Pascal}Item(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { completed: true },
      repo,
    );

    expect(updateForOwner).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      { completed: true },
    );
    expect(updated?.completed).toBe(true);
  });

  it('returns null when update${Pascal}Item targets a missing or unowned item', async () => {
    const repo = makeRepo({ updateForOwner: vi.fn().mockResolvedValue(null) });

    await expect(
      update${Pascal}Item(
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        { title: 'Nope' },
        repo,
      ),
    ).resolves.toBeNull();
  });

  it('returns null when delete${Pascal}Item targets a missing or unowned item', async () => {
    const repo = makeRepo({ deleteForOwner: vi.fn().mockResolvedValue(null) });

    await expect(
      delete${Pascal}Item(
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        repo,
      ),
    ).resolves.toBeNull();
  });

  it('propagates repository errors during create${Pascal}Item without swallowing', async () => {
    const repo = makeRepo({
      create: vi.fn().mockRejectedValue(new Error('rls check violation')),
    });

    await expect(
      create${Pascal}Item('22222222-2222-4222-8222-222222222222', { title: 'Fail' }, repo),
    ).rejects.toThrow('rls check violation');
  });
});
`,
  );

  files.set(
    `${base}/server/index.ts`,
    `// ${base}/server/index.ts
import { implementServer, type KernelServices${isOrg ? ', type RequestContext' : ''} } from '@bslt/server-system/module';

import { ${id}Events } from '../contract';
import { ${id}Module } from '../module';

import { ${id}Repository } from './repository';
import {
  create${Pascal}Item,
  delete${Pascal}Item,
  list${Pascal}Items,
  update${Pascal}Item,
} from './service';

interface ${Pascal}Service {
  readonly events: KernelServices['events'];
}
${
  isOrg
    ? `
function requireActingOrgId(req: RequestContext): string {
  const orgId = req.viewer?.actingOrg?.orgId;
  if (orgId === undefined) {
    return req.fail('ORG_REQUIRED', 'Organization context is required');
  }
  return orgId;
}
`
    : ''
}
export const ${id}Server = implementServer(${id}Module, {
  migrations: new URL('./migrations/', import.meta.url),
  create: (k): ${Pascal}Service => ({ events: k.events }),
  handlers: {
    list: async (_input, req) => ({
      items: await req.tx((tx) =>
        list${Pascal}Items(${isOrg ? 'requireActingOrgId(req)' : 'req.viewer.userId'}, ${id}Repository(tx)),
      ),
    }),
    create: async (input, req, s) => ({
      item: await req.tx(async (tx) => {
        const ownerScopeId = ${isOrg ? 'requireActingOrgId(req)' : 'req.viewer.userId'};
        const created = await create${Pascal}Item(ownerScopeId, input.body, ${id}Repository(tx));
        await s.events.publish(
          tx,
          ${id}Events.created,
          { itemId: created.id, userId: req.viewer.userId },
          { actorUserId: req.viewer.userId, orgId: req.viewer.actingOrg?.orgId ?? null },
        );
        return created;
      }),
    }),
    update: async (input, req, s) => {
      const ownerScopeId = ${isOrg ? 'requireActingOrgId(req)' : 'req.viewer.userId'};
      const item = await req.tx(async (tx) => {
        const updated = await update${Pascal}Item(
          ownerScopeId,
          input.params.id,
          input.body,
          ${id}Repository(tx),
        );
        if (updated !== null) {
          await s.events.publish(
            tx,
            ${id}Events.updated,
            {
              itemId: updated.id,
              userId: req.viewer.userId,
              completed: updated.completed,
            },
            { actorUserId: req.viewer.userId, orgId: req.viewer.actingOrg?.orgId ?? null },
          );
        }
        return updated;
      });
      if (item === null) {
        return req.fail('${UPPER}_NOT_FOUND', '${Pascal} item not found');
      }
      return { item };
    },
    delete: async (input, req, s) => {
      const ownerScopeId = ${isOrg ? 'requireActingOrgId(req)' : 'req.viewer.userId'};
      const item = await req.tx(async (tx) => {
        const deleted = await delete${Pascal}Item(
          ownerScopeId,
          input.params.id,
          ${id}Repository(tx),
        );
        if (deleted !== null) {
          await s.events.publish(
            tx,
            ${id}Events.deleted,
            { itemId: deleted.id, userId: req.viewer.userId },
            { actorUserId: req.viewer.userId, orgId: req.viewer.actingOrg?.orgId ?? null },
          );
        }
        return deleted;
      });
      if (item === null) {
        return req.fail('${UPPER}_NOT_FOUND', '${Pascal} item not found');
      }
      return { item };
    },
  },
});
`,
  );

  files.set(
    `${base}/server/index.test.ts`,
    `// ${base}/server/index.test.ts
import { describe, expect, it, vi } from 'vitest';

import { identityModule } from '@bslt/identity/module';
import { implementServer, registerServerModules } from '@bslt/server-system/module';

import { ${id}Server } from './index';

import type { DbClient } from '@bslt/db';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '11111111-1111-4111-8111-111111111111';

const identityStub = implementServer(identityModule, {
  migrations: new URL('./migrations/', import.meta.url),
  create: () => ({}),
  handlers: {} as never,
});

interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
  readonly preHandler?: (req: unknown, reply: unknown) => Promise<void>;
  readonly handler: (req: unknown, reply: unknown) => Promise<unknown>;
}

function setupHost(rows: Array<Record<string, unknown>> = []) {
  const routes = new Map<string, RegisteredRoute>();
  const server = {
    route(opts: RegisteredRoute) {
      routes.set(\`\${opts.method} \${opts.url}\`, opts);
    },
    addHook() {},
  };

  const query = vi.fn().mockImplementation(async () => rows);
  const queryOne = vi.fn().mockImplementation(async () => rows[0] ?? null);

  const fakeDb = {
    query,
    queryOne,
    execute: vi.fn().mockResolvedValue(0),
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(fakeDb),
    raw: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as DbClient;

  const logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => logger,
  };

  registerServerModules(server as never, {} as never, [identityStub, ${id}Server], {
    resolveDb: () => fakeDb,
    validateResponses: true,
    kernel: {
      db: { system: (fn) => fn(fakeDb) },
      log: logger,
      clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    },
    routerOptions: {
      prefix: '/api',
      jwtSecret: 'test-secret',
      authGuardFactory: () => async () => {},
    },
  });

  async function dispatch(
    method: string,
    url: string,
    options: {
      authenticated?: boolean;
      params?: Record<string, unknown>;
      body?: unknown;
    } = {},
  ): Promise<{ status: number; payload: unknown }> {
    const route = routes.get(\`\${method} \${url}\`);
    if (route === undefined) {
      throw new Error(\`Route not found: \${method} \${url}\`);
    }
    let status = 200;
    let payload: unknown;
    const reply = {
      status(code: number) {
        status = code;
        return reply;
      },
      send(data: unknown) {
        payload = data;
        return reply;
      },
      header() {
        return reply;
      },
    };
    const req = {
      headers: {},
      params: options.params ?? {},
      query: {},
      body: options.body,
      user:
        options.authenticated === false
          ? undefined
          : { userId: USER_ID, email: 'u@example.com', role: 'user' },
    };
    if (route.preHandler !== undefined) {
      await route.preHandler(req, reply);
    }
    const returned = await route.handler(req, reply);
    return { status, payload: payload ?? returned };
  }

  return { dispatch, query, queryOne };
}

function sampleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITEM_ID,
    owner_user_id: USER_ID,
    title: 'First item',
    completed: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('${id}Server HTTP handlers', () => {
  it('lists and creates items for an authenticated user', async () => {
    const { dispatch } = setupHost([sampleRow()]);

    const listRes = await dispatch('GET', '/api/${id}');
    expect(listRes.status).toBe(200);
    expect(listRes.payload).toEqual({
      items: [
        {
          id: ITEM_ID,
          ownerId: USER_ID,
          title: 'First item',
          completed: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const createRes = await dispatch('POST', '/api/${id}/create', {
      body: { title: '  First item  ' },
    });
    expect(createRes.status).toBe(200);
    expect(createRes.payload).toMatchObject({
      item: { id: ITEM_ID, ownerId: USER_ID, title: 'First item' },
    });
  });

  it('updates and deletes an owned item', async () => {
    const { dispatch } = setupHost([sampleRow({ completed: true })]);

    const updateRes = await dispatch('POST', '/api/${id}/:id/update', {
      params: { id: ITEM_ID },
      body: { completed: true },
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.payload).toMatchObject({ item: { id: ITEM_ID, completed: true } });

    const deleteRes = await dispatch('POST', '/api/${id}/:id/delete', {
      params: { id: ITEM_ID },
      body: {},
    });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.payload).toMatchObject({ item: { id: ITEM_ID } });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const { dispatch } = setupHost();

    await expect(dispatch('GET', '/api/${id}', { authenticated: false })).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      dispatch('POST', '/api/${id}/create', { authenticated: false, body: { title: 'Hi' } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects invalid request bodies with 400', async () => {
    const { dispatch } = setupHost();

    await expect(
      dispatch('POST', '/api/${id}/create', { body: { title: '   ' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      dispatch('POST', '/api/${id}/:id/update', { params: { id: ITEM_ID }, body: {} }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects non-UUID :id path parameters with 400', async () => {
    const { dispatch } = setupHost();

    await expect(
      dispatch('POST', '/api/${id}/:id/delete', { params: { id: 'not-a-uuid' }, body: {} }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('fails with 404 ${id}.${UPPER}_NOT_FOUND when updating or deleting a missing item', async () => {
    const { dispatch } = setupHost([]);

    await expect(
      dispatch('POST', '/api/${id}/:id/update', {
        params: { id: ITEM_ID },
        body: { completed: true },
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: '${id}.${UPPER}_NOT_FOUND',
    });

    await expect(
      dispatch('POST', '/api/${id}/:id/delete', {
        params: { id: ITEM_ID },
        body: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: '${id}.${UPPER}_NOT_FOUND',
    });
  });
});
`,
  );

  files.set(
    `${base}/i18n/en-US.json`,
    JSON.stringify(
      {
        [`${id}.title`]: Pascal,
        [`${id}.nav`]: Pascal,
        [`${id}.navHint`]: `Manage your ${id} items`,
        [`${id}.paletteLabel`]: `Go to ${Pascal}`,
        [`${id}.paletteDescription`]: `Navigate to ${id}`,
        [`${id}.dashboardDescription`]: `Manage your ${id} workflow from the dashboard.`,
        [`${id}.dashboardAction`]: `Open ${id}`,
        [`${id}.eyebrow`]: 'Workspace Module',
        [`${id}.subtitle`]: `Capture and track your ${id} items.`,
        [`${id}.summaryAria`]: `${Pascal} summary`,
        [`${id}.open`]: 'Open',
        [`${id}.done`]: 'Done',
        [`${id}.inputLabel`]: `${Pascal} title`,
        [`${id}.inputPlaceholder`]: `Add to ${id}`,
        [`${id}.adding`]: 'Adding...',
        [`${id}.add`]: `Add ${Pascal}`,
        [`${id}.listAria`]: `${Pascal} list`,
        [`${id}.loading`]: `Loading ${id}...`,
        [`${id}.emptyTitle`]: `No ${id} items yet`,
        [`${id}.emptyDescription`]: `Add the first entry to start using ${id}.`,
        [`${id}.complete`]: 'Complete',
        [`${id}.reopen`]: 'Reopen',
        [`${id}.delete`]: 'Delete',
      },
      null,
      2,
    ),
  );

  files.set(
    `${base}/i18n/ko-KR.json`,
    JSON.stringify(
      {
        [`${id}.title`]: Pascal,
        [`${id}.nav`]: Pascal,
        [`${id}.navHint`]: `${Pascal} 항목 관리`,
        [`${id}.paletteLabel`]: `${Pascal}로 이동`,
        [`${id}.paletteDescription`]: `${Pascal} 화면 열기`,
        [`${id}.dashboardDescription`]: `대시보드에서 ${Pascal} 워크플로를 관리하세요.`,
        [`${id}.dashboardAction`]: `${Pascal} 열기`,
        [`${id}.eyebrow`]: '워크스페이스 모듈',
        [`${id}.subtitle`]: `${Pascal} 항목을 기록하고 추적합니다.`,
        [`${id}.summaryAria`]: `${Pascal} 요약`,
        [`${id}.open`]: '진행 중',
        [`${id}.done`]: '완료',
        [`${id}.inputLabel`]: `${Pascal} 제목`,
        [`${id}.inputPlaceholder`]: `${Pascal} 추가`,
        [`${id}.adding`]: '추가 중...',
        [`${id}.add`]: `${Pascal} 추가`,
        [`${id}.listAria`]: `${Pascal} 목록`,
        [`${id}.loading`]: `${Pascal} 불러오는 중...`,
        [`${id}.emptyTitle`]: `아직 ${Pascal} 항목이 없습니다`,
        [`${id}.emptyDescription`]: `첫 번째 항목을 추가하여 ${Pascal} 사용을 시작하세요.`,
        [`${id}.complete`]: '완료',
        [`${id}.reopen`]: '다시 열기',
        [`${id}.delete`]: '삭제',
      },
      null,
      2,
    ),
  );

  files.set(
    `${base}/web/hooks.ts`,
    `// ${base}/web/hooks.ts
import { useMemo } from 'react';

import { createEndpointClient, isHttpStatusError } from '@bslt/client-engine';
import {
  endpointQueryKey,
  useEndpoint,
  useEndpointMutation,
  useMutation,
  useQueryCache,
  useTransport,
  type UseMutationResult,
} from '@bslt/react';

import {
  type Create${Pascal}Request,
  type ${Pascal}Item,
  type ${Pascal}ListResponse,
  type ${Pascal}MutationResponse,
  type Update${Pascal}Request,
} from '../contract';
import { ${id}Module } from '../module';

export interface Use${Pascal}Result {
  readonly data: readonly ${Pascal}Item[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

function use${Pascal}EndpointClient() {
  const transport = useTransport();
  return useMemo(() => createEndpointClient(${id}Module, transport), [transport]);
}

export function use${Pascal}Items(): Use${Pascal}Result {
  const queryCache = useQueryCache();
  const client = use${Pascal}EndpointClient();
  const listKey = useMemo(() => endpointQueryKey(client.list), [client]);
  const query = useEndpoint(client.list, undefined, {
    staleTime: 60 * 1000,
  });

  return {
    data: query.data?.items ?? [],
    isLoading: query.status === 'pending',
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: () => {
      queryCache.invalidateQuery(listKey);
    },
  };
}

export function useCreate${Pascal}Item(): UseMutationResult<
  ${Pascal}MutationResponse,
  Error,
  Create${Pascal}Request
> {
  const client = use${Pascal}EndpointClient();
  const mutation = useEndpointMutation(client.create);
  return {
    ...mutation,
    mutate: (data) => {
      mutation.mutate({ body: data });
    },
    mutateAsync: (data) => mutation.mutateAsync({ body: data }),
    variables: mutation.variables?.body,
  };
}

export function useUpdate${Pascal}Item(): UseMutationResult<
  ${Pascal}MutationResponse,
  Error,
  { id: string; data: Update${Pascal}Request }
> {
  const client = use${Pascal}EndpointClient();
  const mutation = useEndpointMutation(client.update);
  return {
    ...mutation,
    mutate: ({ id, data }) => {
      mutation.mutate({ params: { id }, body: data });
    },
    mutateAsync: ({ id, data }) => mutation.mutateAsync({ params: { id }, body: data }),
    variables:
      mutation.variables !== undefined
        ? { id: mutation.variables.params.id, data: mutation.variables.body ?? {} }
        : undefined,
  };
}

export function useDelete${Pascal}Item(): UseMutationResult<string, Error, string> {
  const queryCache = useQueryCache();
  const client = use${Pascal}EndpointClient();
  const listKey = useMemo(() => endpointQueryKey(client.list), [client]);

  return useMutation<string, Error, string, { previous?: ${Pascal}ListResponse }>({
    mutationFn: async (itemId) => {
      try {
        await client.delete({ params: { id: itemId }, body: {} });
      } catch (error) {
        if (!isHttpStatusError(error, 404)) {
          throw error;
        }
      }
      return itemId;
    },
    onMutate: (itemId) => {
      const previous = queryCache.getQueryData(listKey) as ${Pascal}ListResponse | undefined;
      if (previous !== undefined) {
        queryCache.setQueryData(listKey, {
          ...previous,
          items: previous.items.filter((item) => item.id !== itemId),
        });
      }
      return previous !== undefined ? { previous } : {};
    },
    onError: (_error, _itemId, context) => {
      if (context?.previous !== undefined) {
        queryCache.setQueryData(listKey, context.previous);
      }
    },
    onSettled: () => {
      queryCache.invalidateQuery(listKey);
    },
  });
}
`,
  );

  files.set(
    `${base}/web/hooks.test.tsx`,
    `// ${base}/web/hooks.test.tsx
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryCache } from '@bslt/client-engine';
import { QueryCacheProvider, TransportProvider } from '@bslt/react';

import {
  useCreate${Pascal}Item,
  useDelete${Pascal}Item,
  use${Pascal}Items,
  useUpdate${Pascal}Item,
  type Use${Pascal}Result,
} from './hooks';

import type { ${Pascal}Item, ${Pascal}ListResponse } from '../contract';
import type { Transport } from '@bslt/client-engine';

const LIST_KEY = ['${id}', 'list'] as const;

const ITEM_1: ${Pascal}Item = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: '22222222-2222-4222-8222-222222222222',
  title: 'First item',
  completed: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
});

function makeHttpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function makeWrapper(requestFn: ReturnType<typeof vi.fn>, cache = new QueryCache()) {
  const transport: Transport = {
    request: requestFn as Transport['request'],
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryCacheProvider,
      { cache },
      createElement(TransportProvider, { transport }, children),
    );
  return { cache, wrapper };
}

describe('${id} web hooks', () => {
  it('fetches items via TransportProvider and invalidates cache on create and update', async () => {
    const requestFn = vi
      .fn()
      .mockResolvedValueOnce({ items: [ITEM_1] })
      .mockResolvedValueOnce({ item: ITEM_1 })
      .mockResolvedValueOnce({ items: [ITEM_1] })
      .mockResolvedValueOnce({ item: { ...ITEM_1, completed: true } })
      .mockResolvedValueOnce({ items: [{ ...ITEM_1, completed: true }] });
    const { wrapper } = makeWrapper(requestFn);

    const { result } = renderHook(
      () => ({
        items: use${Pascal}Items(),
        create: useCreate${Pascal}Item(),
        update: useUpdate${Pascal}Item(),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.items.isLoading).toBe(false);
    });
    const snapshot: Use${Pascal}Result = result.current.items;
    expect(snapshot.data).toEqual([ITEM_1]);

    await act(async () => {
      await result.current.create.mutateAsync({ title: 'First item' });
    });
    await act(async () => {
      await result.current.update.mutateAsync({ id: ITEM_1.id, data: { completed: true } });
    });

    await waitFor(() => {
      expect(result.current.items.data[0]?.completed).toBe(true);
    });
  });

  it('optimistically removes an item immediately while delete is in flight', async () => {
    let resolveDelete!: (value: unknown) => void;
    const deletePromise = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    const cache = new QueryCache();
    cache.setQueryData(LIST_KEY, {
      items: [ITEM_1],
    } satisfies ${Pascal}ListResponse);

    const requestFn = vi
      .fn()
      .mockImplementation((_path: string, opts?: { method?: string }) =>
        opts?.method === 'POST' ? deletePromise : Promise.resolve({ items: [] }),
      );
    const { wrapper } = makeWrapper(requestFn, cache);

    const { result } = renderHook(() => useDelete${Pascal}Item(), { wrapper });

    act(() => {
      result.current.mutate(ITEM_1.id);
    });

    const optimistic = cache.getQueryData(LIST_KEY) as ${Pascal}ListResponse | undefined;
    expect(optimistic?.items).toEqual([]);

    await act(async () => {
      resolveDelete({ item: ITEM_1 });
      await deletePromise;
    });
  });

  it('treats a 404 delete response as idempotent success without rolling back cache', async () => {
    const cache = new QueryCache();
    cache.setQueryData(LIST_KEY, {
      items: [ITEM_1],
    } satisfies ${Pascal}ListResponse);

    const requestFn = vi
      .fn()
      .mockImplementation((_path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.reject(makeHttpError(404, 'Not found'));
        }
        return Promise.resolve({ items: [] });
      });
    const { wrapper } = makeWrapper(requestFn, cache);

    const { result } = renderHook(() => useDelete${Pascal}Item(), { wrapper });

    await act(async () => {
      const deletedId = await result.current.mutateAsync(ITEM_1.id);
      expect(deletedId).toBe(ITEM_1.id);
    });
    expect(result.current.error).toBeNull();
  });

  it('restores the optimistic removal when delete fails with a non-404 error', async () => {
    const cache = new QueryCache();
    cache.setQueryData(LIST_KEY, {
      items: [ITEM_1],
    } satisfies ${Pascal}ListResponse);

    const requestFn = vi
      .fn()
      .mockImplementation((_path: string, opts?: { method?: string }) => {
        if (opts?.method === 'POST') {
          return Promise.reject(makeHttpError(500, 'Database offline'));
        }
        return Promise.resolve({ items: [ITEM_1] });
      });
    const { wrapper } = makeWrapper(requestFn, cache);

    const { result } = renderHook(() => useDelete${Pascal}Item(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(ITEM_1.id)).rejects.toThrow('Database offline');
    });

    const restored = cache.getQueryData(LIST_KEY) as ${Pascal}ListResponse | undefined;
    expect(restored?.items).toEqual([ITEM_1]);
  });

  it('exposes error state when listing items fails', async () => {
    vi.useFakeTimers();
    try {
      const requestFn = vi.fn().mockRejectedValue(makeHttpError(503, 'Service unavailable'));
      const { wrapper } = makeWrapper(requestFn);

      const { result } = renderHook(() => use${Pascal}Items(), { wrapper });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isError).toBe(true);
      expect(result.current.error?.message).toBe('Service unavailable');
      expect(result.current.data).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
`,
  );

  files.set(
    `${base}/web/${Pascal}Page.css`,
    `/* ${base}/web/${Pascal}Page.css */

.${id}-page {
  display: grid;
  gap: var(--ui-gap-lg);
  width: 100%;
}

.${id}-page__header,
.${id}-page__form,
.${id}-page__item,
.${id}-page__actions,
.${id}-page__summary,
.${id}-page__item-copy {
  display: flex;
  align-items: center;
  gap: var(--ui-gap-md);
}

.${id}-page__header {
  justify-content: space-between;
  padding: var(--ui-gap-lg);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-color-surface);
}

.${id}-page__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0;
}

.${id}-page__subtitle {
  margin-top: var(--ui-gap-xs);
  max-width: 36rem;
  line-height: var(--ui-line-height-normal);
}

.${id}-page__summary {
  min-width: 12rem;
  justify-content: space-between;
  padding: var(--ui-gap-md);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--ui-color-surface) 72%, var(--ui-color-bg));
}

.${id}-page__summary > div {
  display: grid;
  gap: var(--ui-gap-xs);
}

.${id}-page__summary strong {
  font-size: var(--ui-font-size-xl);
  line-height: var(--ui-line-height-tight);
}

.${id}-page__form {
  align-items: end;
  max-width: 44rem;
}

.${id}-page__form .input-field {
  flex: 1;
  min-width: 0;
}

.${id}-page__list {
  display: grid;
  gap: var(--ui-gap-sm);
}

.${id}-page__item {
  padding: var(--ui-gap-md);
  border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-color-surface);
  justify-content: space-between;
}

.${id}-page__item-copy {
  min-width: 0;
}

.${id}-page__item-copy strong {
  overflow-wrap: anywhere;
}

.${id}-page__item-copy strong[data-completed='true'] {
  color: var(--ui-color-text-muted);
  text-decoration: line-through;
  opacity: 0.7;
}

.${id}-page__actions {
  flex-shrink: 0;
  justify-content: flex-end;
}

@media (max-width: 48rem) {
  .${id}-page__header,
  .${id}-page__form,
  .${id}-page__item {
    align-items: stretch;
    flex-direction: column;
  }

  .${id}-page__summary,
  .${id}-page__actions {
    justify-content: flex-start;
  }
}
`,
  );

  files.set(
    `${base}/web/${Pascal}Page.tsx`,
    `// ${base}/web/${Pascal}Page.tsx
import { useMemo, useState, type ChangeEvent, type ReactElement, type SyntheticEvent } from 'react';

import { Badge, Button, EmptyState, Heading, Input, PageContainer, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import {
  useCreate${Pascal}Item,
  useDelete${Pascal}Item,
  use${Pascal}Items,
  useUpdate${Pascal}Item,
} from './hooks';

import './${Pascal}Page.css';

export function ${Pascal}Page(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const [title, setTitle] = useState('');
  const items = use${Pascal}Items();
  const createItem = useCreate${Pascal}Item();
  const updateItem = useUpdate${Pascal}Item();
  const deleteItem = useDelete${Pascal}Item();

  const completedCount = useMemo(
    () => items.data.filter((item) => item.completed).length,
    [items.data],
  );
  const activeCount = items.data.length - completedCount;
  const isMutating = createItem.isPending || updateItem.isPending || deleteItem.isPending;
  const errorMessage =
    items.error?.message ??
    createItem.error?.message ??
    updateItem.error?.message ??
    deleteItem.error?.message ??
    null;

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.currentTarget.value);
  };

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalized = title.trim();
    if (normalized === '') return;
    createItem.mutate({ title: normalized });
    setTitle('');
  };

  return (
    <PageContainer className="${id}-page" maxWidth={960}>
      <header className="${id}-page__header">
        <div>
          <Text tone="muted" size="xs" className="${id}-page__eyebrow">
            {t('${id}.eyebrow')}
          </Text>
          <Heading as="h1" size="xl">
            {t('${id}.title')}
          </Heading>
          <Text tone="muted" size="sm" className="${id}-page__subtitle">
            {t('${id}.subtitle')}
          </Text>
        </div>
        <div className="${id}-page__summary" aria-label={t('${id}.summaryAria')}>
          <div>
            <Text tone="muted" size="xs">
              {t('${id}.open')}
            </Text>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <Text tone="muted" size="xs">
              {t('${id}.done')}
            </Text>
            <strong>{completedCount}</strong>
          </div>
        </div>
      </header>

      <form className="${id}-page__form" onSubmit={handleSubmit}>
        <Input.Field
          label={t('${id}.inputLabel')}
          value={title}
          onChange={handleTitleChange}
          maxLength={120}
          placeholder={t('${id}.inputPlaceholder')}
        />
        <Button type="submit" disabled={title.trim() === '' || createItem.isPending}>
          {createItem.isPending ? t('${id}.adding') : t('${id}.add')}
        </Button>
      </form>

      {errorMessage !== null ? (
        <Text tone="danger" role="alert">
          {errorMessage}
        </Text>
      ) : null}

      <section className="${id}-page__list" aria-label={t('${id}.listAria')}>
        {items.isLoading ? <Text tone="muted">{t('${id}.loading')}</Text> : null}
        {!items.isLoading && items.data.length === 0 ? (
          <EmptyState
            icon={
              <svg
                className="icon-lg text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 13l2 2 4-4" />
              </svg>
            }
            title={t('${id}.emptyTitle')}
            description={t('${id}.emptyDescription')}
          />
        ) : null}
        {items.data.map((item) => (
          <article className="${id}-page__item" key={item.id}>
            <div className="${id}-page__item-copy">
              <strong data-completed={item.completed ? 'true' : 'false'}>{item.title}</strong>
              <Badge tone={item.completed ? 'success' : 'info'}>
                {item.completed ? t('${id}.complete') : t('${id}.open')}
              </Badge>
            </div>
            <div className="${id}-page__actions">
              <Button
                type="button"
                variant="secondary"
                size="small"
                disabled={isMutating}
                onClick={() => {
                  updateItem.mutate({
                    id: item.id,
                    data: { completed: !item.completed },
                  });
                }}
              >
                {item.completed ? t('${id}.reopen') : t('${id}.complete')}
              </Button>
              <Button
                type="button"
                variant="text"
                size="small"
                disabled={isMutating}
                onClick={() => {
                  deleteItem.mutate(item.id);
                }}
              >
                {t('${id}.delete')}
              </Button>
            </div>
          </article>
        ))}
      </section>
    </PageContainer>
  );
}
`,
  );

  files.set(
    `${base}/web/${Pascal}Page.test.tsx`,
    `// ${base}/web/${Pascal}Page.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ${Pascal}Page } from './${Pascal}Page';

import type { ${Pascal}Item } from '../contract';
import type { ChangeEvent, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  createError: null as Error | null,
  createMutate: vi.fn(),
  createPending: false,
  deleteMutate: vi.fn(),
  isLoading: false,
  items: [] as ${Pascal}Item[],
  itemsError: null as Error | null,
  updateMutate: vi.fn(),
}));

vi.mock('./hooks', () => ({
  useCreate${Pascal}Item: () => ({
    error: mocks.createError,
    isPending: mocks.createPending,
    mutate: mocks.createMutate,
  }),
  useDelete${Pascal}Item: () => ({
    error: null,
    isPending: false,
    mutate: mocks.deleteMutate,
  }),
  use${Pascal}Items: () => ({
    data: mocks.items,
    error: mocks.itemsError,
    isError: mocks.itemsError !== null,
    isLoading: mocks.isLoading,
    refetch: vi.fn(),
  }),
  useUpdate${Pascal}Item: () => ({
    error: null,
    isPending: false,
    mutate: mocks.updateMutate,
  }),
}));

vi.mock('@bslt/ui', () => {
  const badge = ({ children }: { children: ReactNode }) => <span>{children}</span>;
  const button = ({
    children,
    disabled,
    onClick,
    type = 'button',
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
  }) => (
    <button disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  );
  const heading = ({ as, children }: { as?: keyof HTMLElementTagNameMap; children: ReactNode }) => {
    const Tag = as ?? 'h1';
    return <Tag>{children}</Tag>;
  };
  const inputRoot = () => <input />;
  const inputField = ({
    label,
    maxLength,
    onChange,
    placeholder,
    value,
  }: {
    label: string;
    maxLength?: number;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    value?: string;
  }) => (
    <label>
      {label}
      <input maxLength={maxLength} onChange={onChange} placeholder={placeholder} value={value} />
    </label>
  );
  const pageContainer = ({ children }: { children: ReactNode }) => (
    <main data-testid="page-container">{children}</main>
  );
  const text = ({ children, role }: { children: ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  );
  const emptyState = ({ title, description }: { title: string; description?: string }) => (
    <div role="status">
      <h3>{title}</h3>
      {description !== undefined ? <p>{description}</p> : null}
    </div>
  );

  return {
    Badge: badge,
    Button: button,
    EmptyState: emptyState,
    Heading: heading,
    Input: Object.assign(inputRoot, { Field: inputField }),
    PageContainer: pageContainer,
    Text: text,
  };
});

function buildItem(overrides: Partial<${Pascal}Item> = {}): ${Pascal}Item {
  return {
    id: 'item-1',
    ownerId: 'user-1',
    title: 'Ship first workflow',
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('${Pascal}Page', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.createError = null;
    mocks.createMutate.mockClear();
    mocks.createPending = false;
    mocks.deleteMutate.mockClear();
    mocks.isLoading = false;
    mocks.items = [];
    mocks.itemsError = null;
    mocks.updateMutate.mockClear();
  });

  it('renders heading, summary counts, and empty state', () => {
    render(<${Pascal}Page />);

    expect(screen.getByTestId('page-container')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '${Pascal}' })).toBeInTheDocument();
    expect(screen.getByText('No ${id} items yet')).toBeInTheDocument();

    cleanup();
    mocks.items = [buildItem(), buildItem({ id: 'item-2', completed: true })];
    render(<${Pascal}Page />);

    const summary = screen.getByLabelText('${Pascal} summary');
    expect(within(summary).getByText('Open')).toBeInTheDocument();
    expect(within(summary).getByText('Done')).toBeInTheDocument();
    expect(within(summary).getAllByText('1')).toHaveLength(2);
  });

  it('creates, toggles, and deletes items via hooks', async () => {
    const user = userEvent.setup({ delay: null });
    mocks.items = [buildItem()];
    render(<${Pascal}Page />);

    await user.type(screen.getByLabelText('${Pascal} title'), 'Launch beta');
    const form = screen.getByLabelText('${Pascal} title').closest('form');
    if (form === null) throw new Error('Expected form');
    fireEvent.submit(form);

    expect(mocks.createMutate).toHaveBeenCalledWith({ title: 'Launch beta' });

    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.updateMutate).toHaveBeenCalledWith({
      id: 'item-1',
      data: { completed: true },
    });
    expect(mocks.deleteMutate).toHaveBeenCalledWith('item-1');
  });

  it('disables submit and refuses to dispatch createMutate for whitespace-only titles', async () => {
    const user = userEvent.setup({ delay: null });
    render(<${Pascal}Page />);

    const submitBtn = screen.getByRole('button', { name: 'Add ${Pascal}' });
    expect(submitBtn).toBeDisabled();

    await user.type(screen.getByLabelText('${Pascal} title'), '    ');
    expect(submitBtn).toBeDisabled();

    const form = screen.getByLabelText('${Pascal} title').closest('form');
    if (form === null) throw new Error('Expected form');
    fireEvent.submit(form);
    expect(mocks.createMutate).not.toHaveBeenCalled();
  });

  it('renders an alert banner when a query or mutation error occurs', () => {
    mocks.itemsError = new Error('Network unreachable');
    render(<${Pascal}Page />);

    expect(screen.getByRole('alert')).toHaveTextContent('Network unreachable');
  });

  it('disables item actions and shows Adding... while creation is pending', () => {
    mocks.createPending = true;
    mocks.items = [buildItem()];
    render(<${Pascal}Page />);

    expect(screen.getByRole('button', { name: 'Adding...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('shows Loading ${id}... and suppresses empty state while loading', () => {
    mocks.isLoading = true;
    render(<${Pascal}Page />);

    expect(screen.getByText('Loading ${id}...')).toBeInTheDocument();
    expect(screen.queryByText('No ${id} items yet')).not.toBeInTheDocument();
  });
});
`,
  );

  files.set(
    `${base}/web/index.ts`,
    `// ${base}/web/index.ts
import { implementWeb, lazyModulePage } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';
import { ${id}Module } from '../module';

export const ${id}Web = implementWeb(${id}Module, {
  routes: [
    {
      path: '/${id}',
      shell: 'app',
      auth: 'user',
      title: '${id}.title',
      page: lazyModulePage(() => import('./${Pascal}Page'), '${Pascal}Page'),
    },
  ],
  nav: [
    {
      to: '/${id}',
      slot: 'app.primary',
      label: '${id}.nav',
      hint: '${id}.navHint',
      icon: 'folder',
      order: 50,
    },
    {
      to: '/${id}',
      slot: 'palette',
      label: '${id}.paletteLabel',
      description: '${id}.paletteDescription',
      keywords: ['${id}'],
      icon: 'folder',
      order: 50,
    },
    {
      to: '/${id}',
      slot: 'dashboard',
      label: '${id}.nav',
      description: '${id}.dashboardDescription',
      actionLabel: '${id}.dashboardAction',
      icon: 'folder',
      order: 50,
    },
  ],
  messages: enUsMessages,
  locales: {
    'ko-KR': () => import('../i18n/ko-KR.json'),
  },
});
`,
  );

  files.set(
    `${base}/web/index.test.ts`,
    `// ${base}/web/index.test.ts
import { describe, expect, it } from 'vitest';

import { ${id}Module } from '../module';

import { ${id}Web } from './index';

describe('${id}Web', () => {
  it('registers the /${id} route, primary nav contribution, and en-US message catalog', async () => {
    expect(${id}Web.module).toBe(${id}Module);
    expect(${id}Web.routes).toMatchObject([
      {
        path: '/${id}',
        shell: 'app',
        auth: 'user',
        title: '${id}.title',
      },
    ]);
    expect(${id}Web.nav).toEqual([
      {
        to: '/${id}',
        slot: 'app.primary',
        label: '${id}.nav',
        hint: '${id}.navHint',
        icon: 'folder',
        order: 50,
      },
      {
        to: '/${id}',
        slot: 'palette',
        label: '${id}.paletteLabel',
        description: '${id}.paletteDescription',
        keywords: ['${id}'],
        icon: 'folder',
        order: 50,
      },
      {
        to: '/${id}',
        slot: 'dashboard',
        label: '${id}.nav',
        description: '${id}.dashboardDescription',
        actionLabel: '${id}.dashboardAction',
        icon: 'folder',
        order: 50,
      },
    ]);
    expect(${id}Web.messages['${id}.title']).toBe('${Pascal}');

    const routePage = ${id}Web.routes[0]?.page;
    expect(routePage?.pageName).toBe('${Pascal}Page');
    const component = await routePage?.load();
    expect(typeof component).toBe('function');
  });

  it('freezes ${id}Web routes and nav arrays against mutation', () => {
    expect(Object.isFrozen(${id}Web)).toBe(true);
    expect(() => {
      (${id}Web.routes as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it('freezes ${id}Web messages map against mutation', () => {
    expect(Object.isFrozen(${id}Web.messages)).toBe(true);
    expect(() => {
      (${id}Web.messages as Record<string, string>)['${id}.title'] = 'Tampered';
    }).toThrow(TypeError);
  });
});
`,
  );

  return files;
}

async function formatScaffoldFiles(
  files: ReadonlyMap<string, string>,
  root: string,
): Promise<Map<string, string>> {
  const prettier = await import('prettier');
  const configPath = path.join(root, 'config/.prettierrc');
  const config = existsSync(configPath)
    ? await prettier.resolveConfig(path.join(root, 'bslt.config.ts'), { config: configPath })
    : null;
  const formatted = new Map<string, string>();
  for (const [relPath, content] of files) {
    if (!/\.(?:ts|tsx|json|css|md)$/u.test(relPath)) {
      formatted.set(relPath, content);
      continue;
    }
    formatted.set(
      relPath,
      await prettier.format(content, { ...(config ?? {}), filepath: path.join(root, relPath) }),
    );
  }
  return formatted;
}

export async function scaffoldModule(
  id: string,
  options: ScaffoldModuleOptions = {},
): Promise<ScaffoldModuleResult> {
  const root = options.root ?? REPO_ROOT;
  const scope: ModuleOwnerScope = options.scope ?? 'user';
  const dryRun = options.dryRun === true;

  validateModuleId(id, root);

  const configPath = path.join(root, 'bslt.config.ts');
  if (!existsSync(configPath)) {
    throw new Error('Missing root bslt.config.ts');
  }
  const patchedConfig = patchBsltConfig(readFileSync(configPath, 'utf8'), id);

  const rawFiles = renderScaffoldFiles(id, scope);
  rawFiles.set('bslt.config.ts', patchedConfig);
  const formatted = await formatScaffoldFiles(rawFiles, root);
  const fileList = [...formatted.keys()].sort(compareText);

  if (dryRun) {
    return {
      id,
      scope,
      moduleDir: `main/modules/${id}`,
      dryRun: true,
      files: fileList,
    };
  }

  for (const [relPath, content] of formatted) {
    const abs = path.join(root, relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  await syncModules({ root });

  if (existsSync(path.join(root, DB_CATALOG.file))) {
    updateCatalogWithModule(root, id, scope);
    await syncRows({ root });
  }

  return {
    id,
    scope,
    moduleDir: `main/modules/${id}`,
    dryRun: false,
    files: fileList,
  };
}

export async function runModuleNewCli(argv: readonly string[]): Promise<number> {
  let parsed: ParsedModuleNewArgs;
  try {
    parsed = parseModuleNewArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(MODULE_NEW_USAGE);
    return 1;
  }

  let result: ScaffoldModuleResult;
  try {
    result = await scaffoldModule(parsed.id, {
      root: REPO_ROOT,
      scope: parsed.scope,
      dryRun: parsed.dryRun,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (result.dryRun) {
    console.log(
      `[dry-run] Would scaffold ${result.moduleDir} (${String(result.files.length)} files):`,
    );
    for (const file of result.files) console.log(`  + ${file}`);
    return 0;
  }

  syncTsReferences();
  syncHeaders({ quiet: true });

  if (parsed.install && existsSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'))) {
    execFileSync('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    execFileSync('pnpm', ['--filter', `@bslt/${parsed.id}...`, 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    execFileSync('pnpm', ['bslt', 'snapshot', 'api'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    execFileSync('pnpm', ['bslt', 'sync', 'openapi'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    execFileSync('pnpm', ['bslt', 'snapshot', 'web-routes'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    execFileSync('pnpm', ['bslt', 'sync', 'docs'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    syncHeaders({ quiet: true });
    execFileSync('pnpm', ['format'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
  }

  console.log(`✅ Scaffolded and installed @bslt/${parsed.id} at ${result.moduleDir}`);
  return 0;
}
