// main/kernel/realtime/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

export default defineVitestConfig({
  test: {
    name: 'realtime',
    environment: 'node',
    server: {
      deps: {
        inline: ['@bslt/contract', '@bslt/db', '@bslt/server-system'],
      },
    },
  },
});
