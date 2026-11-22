// main/modules/identity/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

const isCI = process.env.CI === 'true';

export default defineVitestConfig({
  test: {
    name: '@bslt/identity',
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
