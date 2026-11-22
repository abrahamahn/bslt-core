// main/apps/server/src/bootstrap/runtime.ts
/**
 * Server Runtime — the process lifecycle around `buildApp`.
 *
 * Responsibilities:
 *   start(): compose the app (`buildApp`) and start it; exit on failure
 *   stop():  stop the app (workers, HTTP, comms, data, infra, in that order)
 *   signals: SIGTERM / SIGINT stop the app and exit; an uncaught exception or an
 *            unhandled rejection is logged as fatal, then Node exits
 */

import { buildApp, type BuiltApp, type ProcessRole } from './build-app';

import type { AppConfig } from '@bslt/server-system/config';

// ============================================================================
// ServerRuntime
// ============================================================================

export class ServerRuntime {
  private built?: BuiltApp;
  private shutdownHandlersRegistered = false;

  constructor(
    private readonly config: AppConfig,
    private readonly role: ProcessRole = 'all',
  ) {}

  async start(): Promise<void> {
    try {
      this.built = await buildApp(this.config, { role: this.role });
      await this.built.start();
    } catch (error: unknown) {
      process.stderr.write(`Failed to start server: ${String(error)}\n`);
      if (this.built) {
        await this.stop().catch((err: unknown) => {
          process.stderr.write(`Failed to stop during startup error: ${String(err)}\n`);
        });
      }
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    const log = this.built?.context.log;
    log?.info('Stopping server...');
    await this.built?.stop();

    log?.info('Server stopped');
  }

  setupGracefulShutdown(): void {
    if (this.shutdownHandlersRegistered) return;
    this.shutdownHandlersRegistered = true;

    const signals = ['SIGTERM', 'SIGINT'] as const;
    for (const signal of signals) {
      process.on(signal, async () => {
        this.built?.context.log.info(`Received ${signal}, shutting down...`);
        await this.stop();
        process.exit(0);
      });
    }

    // A crash becomes one structured fatal event in the log pipeline. The monitor
    // only observes: Node still prints the error and exits, and with the default
    // --unhandled-rejections=throw it sees rejections too (origin 'unhandledRejection').
    // No 'unhandledRejection' listener, on purpose: one would downgrade that exit
    // to a warning and keep a process that lost a promise serving in an unknown state.
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      this.built?.context.log.fatal(error, 'Uncaught exception', { origin });
    });
  }
}
