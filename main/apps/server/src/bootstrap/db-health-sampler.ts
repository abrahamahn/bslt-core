// main/apps/server/src/bootstrap/db-health-sampler.ts
/**
 * Periodic database health probe.
 *
 * Records reachability and probe latency into the metrics collector so they are
 * exported at /metrics/prometheus. Because postgres.js queues queries when every
 * connection is busy, the probe's latency rises under pool saturation as well as
 * an outright outage — so a single signal covers both (see docs/deploy/observability.md).
 */

import { getMetricsCollector } from '@bslt/server-system/observability';

import type { FastifyInstance } from 'fastify';

const DEFAULT_INTERVAL_MS = 15_000;

/** Minimal surface needed from the DB client — kept narrow for testability. */
export interface DbHealthProbe {
  healthCheck(): Promise<boolean>;
}

/**
 * Start sampling database health on an interval and recording it into the global
 * metrics collector. The timer is `unref`'d so it never keeps the process alive,
 * and is cleared on server `onClose`.
 */
export function startDbHealthSampler(
  server: FastifyInstance,
  db: DbHealthProbe,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  const collector = getMetricsCollector();

  const sample = async (): Promise<void> => {
    const start = Date.now();
    try {
      const ok = await db.healthCheck();
      collector.recordDbHealthCheck(ok, Date.now() - start);
    } catch {
      collector.recordDbHealthCheck(false, Date.now() - start);
    }
  };

  // Populate the gauge promptly rather than waiting a full interval.
  void sample();

  const timer = setInterval(() => {
    void sample();
  }, intervalMs);
  timer.unref();

  server.addHook('onClose', (_instance, done) => {
    clearInterval(timer);
    done();
  });
}
