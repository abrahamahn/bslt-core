// main/apps/web/vitest.config.ts
/**
 * Vitest configuration for the web app tests (jsdom).
 *
 * Workspace packages resolve to source through their `source` export condition
 * (`@bslt/build-config/vitest`), and app-internal modules through the package.json
 * `imports` map (`#app/*`), so no aliases are needed here.
 *
 * @module vitest-config-web
 */
import react from '@vitejs/plugin-react';

import { defineVitestConfig } from '@bslt/build-config/vitest';

const isCI = process.env.CI === 'true';

export default defineVitestConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['../../../tests/utils/web-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Timeout for individual tests
    testTimeout: 10000,
    // In CI, prefer process forks over worker threads to avoid thread heap OOM during coverage.
    pool: isCI ? 'forks' : 'threads',
    maxConcurrency: isCI ? 1 : 4,
    fileParallelism: !isCI,
    minWorkers: 1,
    maxWorkers: isCI ? 1 : 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      all: false,
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__tests__/**'],
    },
  },
});
