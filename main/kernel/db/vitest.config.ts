// main/kernel/db/vitest.config.ts
/// <reference types="vitest" />
import { withSourceConditions } from '@bslt/build-config/vitest';
import { defineConfig } from 'vitest/config';

export default withSourceConditions(
  defineConfig({
    test: {
      globals: true,
      exclude: ['**/node_modules/**', '**/dist/**', '**/backup/**', '**/*.spec.ts'],
      testTimeout: 60000,
      hookTimeout: 60000,
      clearMocks: true,
      restoreMocks: true,
      name: 'db',
      isolate: true,
      pool: 'threads',
    },
  }),
);
