// tests/vitest.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineVitestConfig } from '@bslt/build-config/vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Workspace packages resolve to source through the `source` export condition,
// this package's own modules through its `imports` map (`#tests/*`).
export default defineVitestConfig({
  test: {
    name: '@bslt/tests',
    environment: 'node',
    setupFiles: [
      path.resolve(__dirname, './utils/server-setup.ts'),
      path.resolve(__dirname, './utils/web-setup.ts'),
    ],
    include: [
      'integration/**/*.test.ts',
      'integration/**/*.test.tsx',
      '../main/modules/**/*.real-db.test.ts',
    ],
    exclude: ['e2e/**', '**/reports/**', '../**/node_modules/**', '../**/dist/**'],
  },
});
