// main/testing/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

// The kit's own unit tests need no database. Its real-DB behaviour is proved by
// the suites that use it (`pnpm test:real-db`).
export default defineVitestConfig({
  test: {
    name: '@bslt/testing',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
