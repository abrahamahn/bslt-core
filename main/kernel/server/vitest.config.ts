// main/kernel/server/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

export default defineVitestConfig({
  test: {
    name: 'server-system',
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.spec.ts'],
  },
});
