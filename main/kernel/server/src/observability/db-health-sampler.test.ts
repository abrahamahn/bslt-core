// main/kernel/server/src/observability/db-health-sampler.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpServer } from '../http/server';

import { startDbHealthSampler, type DbHealthProbe } from './db-health-sampler';
import { getMetricsCollector, resetMetricsCollector } from './metrics';

afterEach(() => {
  resetMetricsCollector();
  vi.restoreAllMocks();
});

describe('startDbHealthSampler', () => {
  it('records a successful probe into the collector', async () => {
    resetMetricsCollector();
    const app = createHttpServer();
    const db: DbHealthProbe = { healthCheck: vi.fn().mockResolvedValue(true) };

    startDbHealthSampler(app, db, 60_000);

    await vi.waitFor(() => {
      expect(getMetricsCollector().getMetricsSummary().db.checks).toBe(1);
    });
    const summary = getMetricsCollector().getMetricsSummary();
    expect(summary.db.up).toBe(true);
    expect(summary.db.lastCheckDurationMs).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it('records a failed probe when the health check rejects', async () => {
    resetMetricsCollector();
    const app = createHttpServer();
    const db: DbHealthProbe = { healthCheck: vi.fn().mockRejectedValue(new Error('down')) };

    startDbHealthSampler(app, db, 60_000);

    await vi.waitFor(() => {
      expect(getMetricsCollector().getMetricsSummary().db.checks).toBe(1);
    });
    const summary = getMetricsCollector().getMetricsSummary();
    expect(summary.db.up).toBe(false);
    expect(summary.db.failures).toBe(1);

    await app.close();
  });

  it('clears the interval when the server closes', async () => {
    resetMetricsCollector();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const app = createHttpServer();
    const db: DbHealthProbe = { healthCheck: vi.fn().mockResolvedValue(true) };

    startDbHealthSampler(app, db, 60_000);
    await app.close();

    expect(clearSpy).toHaveBeenCalled();
  });
});
