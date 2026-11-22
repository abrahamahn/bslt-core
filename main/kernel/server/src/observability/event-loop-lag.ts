// main/kernel/server/src/observability/event-loop-lag.ts
/**
 * Event-Loop Lag Sampler
 *
 * Uses Node's native `monitorEventLoopDelay` histogram (libuv loop timer, zero
 * JS `setInterval`) to expose p50, p95, p99, max, and mean event-loop lag at
 * `/metrics` and `/metrics/prometheus`.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';

import { getMetricsCollector, type MetricsCollector } from './metrics';

const RESOLUTION_MS = 20;
const NS_PER_MS = 1_000_000;

interface ClosableServer {
  addHook(name: 'onClose', hook: (instance: unknown, done: () => void) => void): unknown;
}

function nsToMs(ns: number): number {
  if (!Number.isFinite(ns) || ns < 0) return 0;
  return Math.round((ns / NS_PER_MS) * 100) / 100;
}

/**
 * Enable libuv event-loop delay monitoring and wire live snapshots into `collector`.
 * Automatically disables the histogram and detaches the provider on server `onClose`.
 */
export function startEventLoopLagSampler(
  server: ClosableServer,
  collector: MetricsCollector = getMetricsCollector(),
): void {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();

  collector.setEventLoopLagProvider(() => {
    if (histogram.count === 0) {
      return { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, meanMs: 0 };
    }
    return {
      p50Ms: nsToMs(histogram.percentile(50)),
      p95Ms: nsToMs(histogram.percentile(95)),
      p99Ms: nsToMs(histogram.percentile(99)),
      maxMs: nsToMs(histogram.max),
      meanMs: nsToMs(histogram.mean),
    };
  });

  let closed = false;
  server.addHook('onClose', (_instance, done) => {
    if (!closed) {
      closed = true;
      histogram.disable();
      collector.setEventLoopLagProvider(undefined);
    }
    done();
  });
}
