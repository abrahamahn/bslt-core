// main/kernel/comms/vitest.config.ts
import { defineVitestConfig } from '@bslt/build-config/vitest';

export default defineVitestConfig({
  test: {
    name: 'comms',
    environment: 'node',
    server: {
      deps: {
        inline: [],
      },
    },
  },
});
