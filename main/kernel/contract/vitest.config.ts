// main/kernel/contract/vitest.config.ts
import { withSourceConditions } from '@bslt/build-config/vitest';
import { defineConfig } from 'vitest/config';

export default withSourceConditions(
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      globals: false,
      passWithNoTests: true,
    },
  }),
);
