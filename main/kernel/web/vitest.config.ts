// main/kernel/web/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

const isCI = process.env.CI === 'true';

export default defineVitestConfig({
  test: {
    name: 'web-platform',
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts'],
    testTimeout: 10000,
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
