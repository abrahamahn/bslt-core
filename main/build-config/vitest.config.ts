// main/build-config/vitest.config.ts
import { defineVitestConfig } from './src/vitest';

export default defineVitestConfig({
  test: {
    name: '@bslt/build-config',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
