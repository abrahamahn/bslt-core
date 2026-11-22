// main/kernel/ui/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

// Workspace packages resolve to source through the `source` export condition.
export default defineVitestConfig({
  test: {
    name: 'ui',
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts'],
    testTimeout: 10000,
    pool: 'threads',
    maxConcurrency: 4,
  },
});
