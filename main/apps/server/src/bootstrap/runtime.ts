// main/apps/server/src/bootstrap/runtime.ts
/**
 * Server Runtime — lifecycle orchestrator for the server process.
 *
 * Responsibilities:
 *   start(): bootstrap phased system + app
 *   stop():  stop app/workers/infra in safe order
 */

import { bootstrapServerSystem, stopServerSystem, type ServerBootstrapState } from './system';

import type { AppConfig } from '@bslt/shared/system/config';

// ============================================================================
// ServerRuntime
// ============================================================================

export class ServerRuntime {
  private state?: ServerBootstrapState;
  private shutdownHandlersRegistered = false;

  constructor(private readonly config: AppConfig) {}

  async start(): Promise<void> {
    try {
      this.state = await bootstrapServerSystem(this.config);
    } catch (error: unknown) {
      process.stderr.write(`Failed to start server: ${String(error)}\n`);
      if (this.state) {
        await this.stop().catch((err: unknown) => {
          process.stderr.write(`Failed to stop during startup error: ${String(err)}\n`);
        });
      }
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    const log = this.state?.comms.context.log;
    log?.info('Stopping server...');
    await stopServerSystem(this.state ?? {});

    log?.info('Server stopped');
  }

  setupGracefulShutdown(): void {
    if (this.shutdownHandlersRegistered) return;
    this.shutdownHandlersRegistered = true;

    const signals = ['SIGTERM', 'SIGINT'] as const;
    for (const signal of signals) {
      process.on(signal, async () => {
        this.state?.comms.context.log.info(`Received ${signal}, shutting down...`);
        await this.stop();
        process.exit(0);
      });
    }
  }
}
