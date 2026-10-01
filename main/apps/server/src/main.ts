// main/apps/server/src/main.ts
import { loadConfig } from '@bslt/server-system/config';

import { ServerRuntime } from './bootstrap/runtime';

void (async () => {
  const runtime = new ServerRuntime(await loadConfig());
  runtime.setupGracefulShutdown();
  await runtime.start();
})().catch((error: unknown) => {
  process.stderr.write(`Server startup failed: ${String(error)}\n`);
  process.exit(1);
});
