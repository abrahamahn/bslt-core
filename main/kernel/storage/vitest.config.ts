// main/kernel/storage/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

export default defineVitestConfig({
  test: {
    name: 'storage',
    environment: 'node',
    server: {
      deps: {
        inline: [],
      },
    },
  },
});
