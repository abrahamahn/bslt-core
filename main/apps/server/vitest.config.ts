// main/apps/server/vitest.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineVitestConfig } from '@bslt/build-config/vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineVitestConfig({
  test: {
    name: 'server',
    environment: 'node',
    setupFiles: [path.resolve(__dirname, '../../../tests/utils/server-setup.ts')],
    server: {
      deps: {
        inline: [/src\//, '@bslt/contract', '@bslt/db', '@bslt/server-system', '@bslt/storage'],
      },
    },
  },
});
