// main/build-config/src/vitest.ts
/**
 * The Vitest base config every package extends.
 *
 * It resolves workspace packages through their `exports` `source` condition
 * (see `vite.ts`), so no package needs tsconfig `paths`, a Vite paths plugin or
 * hand-written `@bslt/*` aliases.
 *
 * Node loads this file directly: Vite bundles a config file but leaves its bare
 * imports (`@bslt/build-config/vitest`) to Node. So it uses only erasable
 * TypeScript (`erasableSyntaxOnly`) and imports its sibling by package name
 * (`@bslt/build-config/vite`), which Node 22.18 and later run without a loader.
 */
import { mergeConfig } from 'vitest/config';

import { SOURCE_CONDITION } from '@bslt/build-config/vite';

import type { ViteUserConfig } from 'vitest/config';

/**
 * Vitest supplies its own resolve conditions for tests (Vite's server conditions
 * without `module`, whose targets are often not loadable by Node) and merges them
 * after a config's own. Adding only `source` keeps those defaults and puts
 * `source` first, for the browser-like environments (`resolve`) and Node (`ssr`).
 */
export const vitestSourceResolveConfig: ViteUserConfig = {
  resolve: { conditions: [SOURCE_CONDITION] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION] } },
};

/** Shared base configuration for all Vitest projects in the monorepo. */
export const baseVitestConfig: ViteUserConfig = mergeConfig(vitestSourceResolveConfig, {
  test: {
    globals: true,
    // `.claude/worktrees/` holds agent worktrees — full checkouts of this repo
    // nested inside its own root. Without this, every run collects a second,
    // stale copy of the entire suite: the duplicates run against whatever the
    // worktree was pinned to, fail in ways the real tree does not, and read as
    // genuine failures. Vitest globs from the repo root, so it has to be
    // excluded here.
    exclude: ['**/node_modules/**', '**/dist/**', '**/backup/**', '**/.claude/**', '**/*.spec.ts'],
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'main/tools/**',
        'config/**',
      ],
      // Coverage is collected for reporting only — it is NOT a blocking gate.
      // A coverage percentage measures which lines executed, not whether they
      // were meaningfully asserted, so a hard threshold rewards hollow
      // "coverage theater" tests over real ones. Behavioral safety comes from
      // the unit assertions in the merge gate plus the integration, real-DB and
      // e2e suites. Run `pnpm test:coverage` to see the report and decide where
      // more tests are genuinely worth writing.
    },
  },
} satisfies ViteUserConfig);

/** A package's Vitest config: the base merged with the package's own settings. */
export function defineVitestConfig(config: ViteUserConfig): ViteUserConfig {
  return mergeConfig(baseVitestConfig, config);
}

/**
 * A Vitest config with only the `source` condition added, for a package whose
 * config does not extend the base.
 */
export function withSourceConditions(config: ViteUserConfig): ViteUserConfig {
  return mergeConfig(vitestSourceResolveConfig, config);
}
