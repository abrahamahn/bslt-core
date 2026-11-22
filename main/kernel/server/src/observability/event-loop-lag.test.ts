// main/kernel/server/src/observability/event-loop-lag.test.ts
import { afterEach, describe, expect, it } from 'vitest';

import { startEventLoopLagSampler } from './event-loop-lag';
import {
  formatPrometheusMetrics,
  getMetricsCollector,
  MetricsCollector,
  resetMetricsCollector,
} from './metrics';

describe('startEventLoopLagSampler', () => {
  afterEach(() => {
    resetMetricsCollector();
  });

  it('samples Node event-loop lag into MetricsCollector and detaches cleanly on server close', () => {
    const closeHooks: Array<(instance: unknown, done: () => void) => void> = [];
    const fakeServer = {
      addHook: (_name: 'onClose', hook: (instance: unknown, done: () => void) => void) => {
        closeHooks.push(hook);
      },
    };

    const collector = getMetricsCollector();
    collector.setProcessIdentity({ role: 'realtime', instance: 'rt-1' });
    startEventLoopLagSampler(fakeServer);

    const summary = collector.getMetricsSummary();
    expect(summary.eventLoopLag).toBeDefined();
    expect(summary.eventLoopLag?.p99Ms).toBeGreaterThanOrEqual(0);
    expect(summary.eventLoopLag?.maxMs).toBeGreaterThanOrEqual(0);

    const prom = formatPrometheusMetrics(summary);
    expect(prom).toContain(
      'bslt_event_loop_lag_ms{role="realtime",instance="rt-1",quantile="0.99"}',
    );

    expect(closeHooks).toHaveLength(1);
    let closed = false;
    closeHooks[0]?.(fakeServer, () => {
      closed = true;
    });
    expect(closed).toBe(true);
    expect(collector.getMetricsSummary().eventLoopLag).toBeUndefined();
  });

  it('clamps empty initial histogram readings to zero, isolates custom collectors, and tolerates repeated close hooks', () => {
    const closeHooks: Array<(instance: unknown, done: () => void) => void> = [];
    const fakeServer = {
      addHook: (_name: 'onClose', hook: (instance: unknown, done: () => void) => void) => {
        closeHooks.push(hook);
      },
    };

    const customCollector = new MetricsCollector({ role: 'worker', instance: 'wk-9' });
    startEventLoopLagSampler(fakeServer, customCollector);

    // Global collector remains untouched when an explicit collector is supplied
    expect(getMetricsCollector().getMetricsSummary().eventLoopLag).toBeUndefined();

    const lag = customCollector.getMetricsSummary().eventLoopLag;
    expect(lag).toBeDefined();
    expect(Number.isFinite(lag?.meanMs)).toBe(true);
    expect(lag?.p50Ms).toBeGreaterThanOrEqual(0);
    expect(lag?.p95Ms).toBeGreaterThanOrEqual(0);
    expect(lag?.p99Ms).toBeGreaterThanOrEqual(0);

    let doneCalls = 0;
    closeHooks[0]?.(fakeServer, () => {
      doneCalls += 1;
    });
    closeHooks[0]?.(fakeServer, () => {
      doneCalls += 1;
    });
    expect(doneCalls).toBe(2);
    expect(customCollector.getMetricsSummary().eventLoopLag).toBeUndefined();
  });
});
