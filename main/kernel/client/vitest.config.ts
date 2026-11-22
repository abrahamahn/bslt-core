// main/kernel/client/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

// Workspace packages resolve to source through the `source` export condition.
export default defineVitestConfig({
  test: {
    name: 'client',
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'stores/**', 'ui/**'],
    server: {
      deps: {
        inline: [],
      },
    },
  },
});
