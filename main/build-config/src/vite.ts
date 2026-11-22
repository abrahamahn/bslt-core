// main/build-config/src/vite.ts
/**
 * Vite settings shared by every Vite and Vitest config in the repository.
 *
 * Workspace packages expose their entry points through package.json `exports`
 * with a `source` condition that points at `src`. Listing `source` first in
 * `resolve.conditions` makes Vite load a workspace package's TypeScript source
 * instead of its built `dist`, which tsconfig `paths` and a Vite paths plugin
 * did before restructure Phase 3. Code running under Node uses the SSR
 * conditions, the browser bundle the client ones.
 *
 * Node loads this file directly: Vite bundles a config file but leaves its bare
 * imports (`@bslt/build-config/vite`) to Node. So it uses only erasable
 * TypeScript (`erasableSyntaxOnly`), which Node 22.18 and later run without a
 * loader, and reaches other files of this package by package name, not by a
 * relative path Node could not resolve without an extension.
 */
import { defaultClientConditions, defaultServerConditions, mergeConfig } from 'vite';

import type { UserConfig } from 'vite';

/** The package.json export condition that points at a workspace package's source. */
export const SOURCE_CONDITION = 'source';

/** Vite's client conditions with `source` first. */
export const clientConditions: readonly string[] = [SOURCE_CONDITION, ...defaultClientConditions];

/** Vite's server (SSR) conditions with `source` first. */
export const serverConditions: readonly string[] = [SOURCE_CONDITION, ...defaultServerConditions];

/** The resolve settings that make Vite read workspace packages from source. */
export const sourceResolveConfig: UserConfig = {
  resolve: { conditions: [...clientConditions] },
  ssr: { resolve: { conditions: [...serverConditions] } },
};

/** A Vite config with the `source` condition merged in. */
export function defineViteConfig(config: UserConfig): UserConfig {
  return mergeConfig(sourceResolveConfig, config);
}
