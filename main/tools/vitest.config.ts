// main/tools/vitest.config.ts
/**
 * Vitest configuration for `@bslt/tools` (`turbo run test`).
 *
 * The root is the repository root: the tools audit the whole tree, and several
 * tests read repository files.
 *
 * Workspace packages resolve through their `exports` `source` condition
 * (`defineVitestConfig`). Files run one at a time: several tests spawn git,
 * ESLint or tsc.
 */
import { defineVitestConfig } from '@bslt/build-config/vitest';

import { REPO_ROOT } from './lib/paths';

export default defineVitestConfig({
  root: REPO_ROOT,
  test: {
    name: '@bslt/tools',
    environment: 'node',
    include: ['main/tools/**/*.test.ts'],
    fileParallelism: false,
  },
});
