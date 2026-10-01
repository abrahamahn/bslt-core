// main/tools/scripts/audit/shared-vitest-aliases.ts
import path from 'node:path';

import type { Alias } from 'vite';

export const sharedModuleRoots = [
  'core',
  'db',
  'system',
  'comms',
  'realtime',
  'media',
  'storage',
  'workers',
] as const;

export const sharedFoundationRoots = [
  'api',
  'config',
  'constants',
  'helpers',
  'schema',
  'contracts',
] as const;

export const tsconfigAliasTargets = [
  'tsconfig.json',
  'tests/tsconfig.json',
  'main/tools/tsconfig.json',
] as const;

export const vitestAliasTargets = [
  'main/client/api/vitest.config.ts',
  'main/apps/web/vitest.config.ts',
  'main/apps/server/vitest.config.ts',
  'main/server/db/vitest.config.ts',
  'main/server/realtime/vitest.config.ts',
  'main/server/media/vitest.config.ts',
  'main/server/workers/vitest.config.ts',
] as const;

export const bannedLegacyAliasPattern = /^@bslt\/(engine|websocket)(?:\/|$)/;

export const expectedTsconfigAliasMap: Record<string, Record<string, string[]>> = {
  'tsconfig.json': {
    '@bslt/server': ['./main/apps/server/src/main.ts'],
    '@bslt/server/*': ['./main/apps/server/src/*'],
    '@bslt/web': ['./main/apps/web/src/app/index.ts'],
    '@bslt/web/*': ['./main/apps/web/src/*'],
  },
  'tests/tsconfig.json': {
    '@bslt/server': ['../main/apps/server/src/main.ts'],
    '@bslt/server/*': ['../main/apps/server/src/*', '../main/apps/server/*'],
    '@pages/*': ['../main/apps/web/src/pages/*'],
  },
  'main/tools/tsconfig.json': {
    '@bslt/server': ['../apps/server/src/main.ts'],
    '@bslt/server/*': ['../apps/server/src/*'],
  },
};

export default function createSharedVitestAliases(configDir: string): Alias[] {
  const sharedSrcRoot = path.resolve(configDir, '../../shared/src');
  const moduleRoots = sharedModuleRoots.join('|');
  const foundationRoots = sharedFoundationRoots.join('|');

  return [
    {
      find: /^@bslt\/shared\/system\/constants\/(.*)$/,
      replacement: path.resolve(sharedSrcRoot, 'constants/system/$1.ts'),
    },
    {
      find: /^@bslt\/shared\/system\/constants$/,
      replacement: path.resolve(sharedSrcRoot, 'constants/system/index.ts'),
    },
    {
      find: new RegExp(`^@bslt/shared/(${moduleRoots})$`),
      replacement: path.resolve(sharedSrcRoot, 'modules/$1/index.ts'),
    },
    {
      find: new RegExp(`^@bslt/shared/(${moduleRoots})/(.*)$`),
      replacement: path.resolve(sharedSrcRoot, 'modules/$1/$2'),
    },
    {
      find: new RegExp(`^@bslt/shared/(${foundationRoots})$`),
      replacement: path.resolve(sharedSrcRoot, '$1/index.ts'),
    },
    {
      find: new RegExp(`^@bslt/shared/(${foundationRoots})/(.*)$`),
      replacement: path.resolve(sharedSrcRoot, '$1/$2'),
    },
    {
      find: /^@bslt\/shared$/,
      replacement: path.resolve(sharedSrcRoot, 'index.ts'),
    },
  ];
}
