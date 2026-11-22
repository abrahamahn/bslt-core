// main/kernel/server/src/config/env/env.package.manager.ts
/**
 * Package Manager Environment Configuration
 *
 * Package manager types, env interface, and validation schema.
 * Merged from config/types/infra.ts (package manager section) and config/env.ts.
 *
 * @module config/env.package.manager
 */

import { defaulted, enumOf, object, optional, string } from '@bslt/schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

// ============================================================================
// Types
// ============================================================================

/** NPM package manager configuration. */
export interface NpmConfig {
  provider: 'npm';
  audit: boolean;
  legacyPeerDeps: boolean;
  registry?: string;
}

/** PNPM package manager configuration. */
export interface PnpmConfig {
  provider: 'pnpm';
  strictPeerDeps: boolean;
  frozenLockfile: boolean;
  registry?: string;
}

/** Yarn package manager configuration. */
export interface YarnConfig {
  provider: 'yarn';
  audit: boolean;
  frozenLockfile: boolean;
  registry?: string;
}

export type PackageManagerConfig = NpmConfig | PnpmConfig | YarnConfig;

// ============================================================================
// Env Interface
// ============================================================================

/** Package manager environment variables */
export interface PackageManagerEnv {
  PACKAGE_MANAGER_PROVIDER: 'npm' | 'pnpm' | 'yarn';
  NPM_AUDIT: 'true' | 'false';
  NPM_LEGACY_PEER_DEPS: 'true' | 'false';
  NPM_REGISTRY?: string | undefined;
  PNPM_STRICT_PEER_DEPS: 'true' | 'false';
  PNPM_FROZEN_LOCKFILE: 'true' | 'false';
  PNPM_REGISTRY?: string | undefined;
  YARN_AUDIT: 'true' | 'false';
  YARN_FROZEN_LOCKFILE: 'true' | 'false';
  YARN_REGISTRY?: string | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const PackageManagerEnvSchema: Schema<PackageManagerEnv> = object(
  {
    PACKAGE_MANAGER_PROVIDER: defaulted(
      enumOf(['npm', 'pnpm', 'yarn'] as const, 'PACKAGE_MANAGER_PROVIDER'),
      'pnpm',
    ),
    NPM_AUDIT: defaulted(trueFalseSchema, 'true'),
    NPM_LEGACY_PEER_DEPS: defaulted(trueFalseSchema, 'false'),
    NPM_REGISTRY: optional(string({ label: 'NPM_REGISTRY' })),
    PNPM_STRICT_PEER_DEPS: defaulted(trueFalseSchema, 'true'),
    PNPM_FROZEN_LOCKFILE: defaulted(trueFalseSchema, 'true'),
    PNPM_REGISTRY: optional(string({ label: 'PNPM_REGISTRY' })),
    YARN_AUDIT: defaulted(trueFalseSchema, 'true'),
    YARN_FROZEN_LOCKFILE: defaulted(trueFalseSchema, 'true'),
    YARN_REGISTRY: optional(string({ label: 'YARN_REGISTRY' })),
  },
  { unknownKeys: 'strip' },
);
