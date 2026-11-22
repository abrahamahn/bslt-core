// main/apps/server/src/main.ts
import { loadConfig } from '@bslt/server-system/config';

import { parseProcessRole } from './bootstrap/build-app';
import { ServerRuntime } from './bootstrap/runtime';

// Thin caller: load the config, read the role, and hand both to the runtime,
// which composes the app with `buildApp` and owns the process lifecycle.
void (async () => {
  const runtime = new ServerRuntime(
    await loadConfig(),
    parseProcessRole(process.env['PROCESS_ROLE']),
  );
  runtime.setupGracefulShutdown();
  await runtime.start();
})().catch((error: unknown) => {
  process.stderr.write(`Server startup failed: ${String(error)}\n`);
  process.exit(1);
});
