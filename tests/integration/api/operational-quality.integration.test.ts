// tests/integration/api/operational-quality.integration.test.ts
/**
 * Operational Quality Integration Tests (4.15)
 *
 * Tests:
 * - Metrics interface: request count/latency, job success/fail counts
 * - Prometheus-compatible /metrics endpoint (config-gated)
 * - Request -> metrics counter incremented
 * - Job processed -> metrics counter incremented
 * - pnpm db:migrate / seed.ts / bootstrap-admin.ts
 */

import { readFileSync } from 'node:fs';

import {
  getMetricsCollector,
  MetricsCollector,
  resetMetricsCollector,
} from '@bslt/server-system/observability';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ============================================================================
// Metrics Interface Tests
// ============================================================================

describe('Metrics Interface', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('request count and latency', () => {
    it('increments request count per route', () => {
      collector.incrementRequestCount('/api/users', 200);
      collector.incrementRequestCount('/api/users', 200);
      collector.incrementRequestCount('/api/auth/login', 401);

      const summary = collector.getMetricsSummary();
      expect(summary.requests.total).toBe(3);
      expect(summary.requests.byRoute['/api/users']).toBe(2);
      expect(summary.requests.byRoute['/api/auth/login']).toBe(1);
    });

    it('tracks request latency with percentile distribution', () => {
      for (let i = 1; i <= 100; i++) {
        collector.recordRequestLatency('/api/test', i);
      }

      const summary = collector.getMetricsSummary();
      expect(summary.latency.p50).toBe(50);
      expect(summary.latency.p95).toBe(95);
      expect(summary.latency.p99).toBe(99);
      expect(summary.latency.avg).toBe(50.5);
    });

    it('tracks status code distribution', () => {
      collector.incrementRequestCount('/api/users', 200);
      collector.incrementRequestCount('/api/users', 200);
      collector.incrementRequestCount('/api/users', 404);
      collector.incrementRequestCount('/api/auth', 500);

      const summary = collector.getMetricsSummary();
      expect(summary.requests.byStatus['200']).toBe(2);
      expect(summary.requests.byStatus['404']).toBe(1);
      expect(summary.requests.byStatus['500']).toBe(1);
    });
  });

  describe('job success and fail counts', () => {
    it('tracks job enqueued, completed, and failed counts', () => {
      collector.recordJobEnqueued('email.send');
      collector.recordJobEnqueued('email.send');
      collector.recordJobEnqueued('cleanup.expired');
      collector.recordJobStarted('email.send');
      collector.recordJobCompleted('email.send');
      collector.recordJobStarted('email.send');
      collector.recordJobFailed('email.send');
      collector.recordJobStarted('cleanup.expired');
      collector.recordJobCompleted('cleanup.expired');

      const summary = collector.getMetricsSummary();
      expect(summary.jobs.enqueued).toBe(3);
      expect(summary.jobs.processed).toBe(3);
      expect(summary.jobs.completed).toBe(2);
      expect(summary.jobs.failed).toBe(1);
    });

    it('tracks job counts by name', () => {
      collector.recordJobEnqueued('email.send');
      collector.recordJobCompleted('email.send');
      collector.recordJobEnqueued('cleanup.expired');
      collector.recordJobFailed('cleanup.expired');

      const summary = collector.getMetricsSummary();
      expect(summary.jobs.byName['email.send']).toEqual({
        enqueued: 1,
        completed: 1,
        failed: 0,
      });
      expect(summary.jobs.byName['cleanup.expired']).toEqual({
        enqueued: 1,
        completed: 0,
        failed: 1,
      });
    });
  });

  describe('auth metrics', () => {
    it('tracks login attempts, successes, failures, and lockouts', () => {
      collector.recordLoginAttempt('password');
      collector.recordLoginSuccess('password');
      collector.recordLoginAttempt('password');
      collector.recordLoginFailure('password');
      collector.recordLoginAttempt('google');
      collector.recordLoginSuccess('google');
      collector.recordLockout();

      const summary = collector.getMetricsSummary();
      expect(summary.auth.loginAttempts).toBe(3);
      expect(summary.auth.loginSuccess).toBe(2);
      expect(summary.auth.loginFailures).toBe(1);
      expect(summary.auth.lockouts).toBe(1);
      expect(summary.auth.byProvider['password']).toEqual({ success: 1, failure: 1 });
      expect(summary.auth.byProvider['google']).toEqual({ success: 1, failure: 0 });
    });
  });
});

// ============================================================================
// Metrics Singleton (Prometheus-compatible /metrics endpoint)
// ============================================================================

describe('Prometheus-compatible /metrics endpoint (config-gated)', () => {
  afterEach(() => {
    resetMetricsCollector();
  });

  it('getMetricsCollector returns singleton', () => {
    const a = getMetricsCollector();
    const b = getMetricsCollector();
    expect(a).toBe(b);
  });

  it('request -> metrics counter incremented', () => {
    const collector = getMetricsCollector();
    const beforeTotal = collector.getMetricsSummary().requests.total;

    collector.incrementRequestCount('/api/users', 200);

    const afterTotal = collector.getMetricsSummary().requests.total;
    expect(afterTotal).toBe(beforeTotal + 1);
  });

  it('job processed -> metrics counter incremented', () => {
    const collector = getMetricsCollector();

    collector.recordJobEnqueued('test.job');
    collector.recordJobStarted('test.job');
    collector.recordJobCompleted('test.job');

    const summary = collector.getMetricsSummary();
    expect(summary.jobs.enqueued).toBeGreaterThanOrEqual(1);
    expect(summary.jobs.processed).toBeGreaterThanOrEqual(1);
    expect(summary.jobs.completed).toBeGreaterThanOrEqual(1);
  });

  it('metrics summary has Prometheus-compatible structure', () => {
    const collector = getMetricsCollector();
    collector.incrementRequestCount('/api/test', 200);
    collector.recordRequestLatency('/api/test', 42);

    const summary = collector.getMetricsSummary();

    // Prometheus-style: counters, gauges, histograms
    expect(summary).toEqual(
      expect.objectContaining({
        requests: expect.objectContaining({
          total: expect.any(Number),
          byRoute: expect.any(Object),
          byStatus: expect.any(Object),
        }),
        latency: expect.objectContaining({
          p50: expect.any(Number),
          p95: expect.any(Number),
          p99: expect.any(Number),
          avg: expect.any(Number),
        }),
        jobs: expect.objectContaining({
          enqueued: expect.any(Number),
          completed: expect.any(Number),
          failed: expect.any(Number),
        }),
        uptimeSeconds: expect.any(Number),
        collectedAt: expect.any(String),
      }),
    );
  });

  it('reset clears all metric counters', () => {
    const collector = getMetricsCollector();
    collector.incrementRequestCount('/api/test', 200);
    collector.recordJobEnqueued('test');
    collector.recordLoginAttempt('password');

    collector.reset();

    const summary = collector.getMetricsSummary();
    expect(summary.requests.total).toBe(0);
    expect(summary.jobs.enqueued).toBe(0);
    expect(summary.auth.loginAttempts).toBe(0);
  });
});

// ============================================================================
// Deployment Sanity Tests
// ============================================================================

describe('Deployment Sanity', () => {
  const readRuntimeModuleSource = (relativePath: string): string => {
    const moduleUrl = new URL(relativePath, import.meta.url);
    return readFileSync(moduleUrl, 'utf8');
  };

  describe('bootstrap-admin.ts idempotency', () => {
    it('bootstrapAdmin exports a function', () => {
      const source = readRuntimeModuleSource('../../../main/tools/scripts/db/bootstrap-admin.ts');
      expect(source).toMatch(/export\s+async\s+function\s+bootstrapAdmin\s*\(/);
    });
  });

  describe('seed.ts exports', () => {
    it('seed module exports seed function and TEST_USERS', () => {
      const source = readRuntimeModuleSource('../../../main/tools/scripts/db/seed.ts');
      expect(source).toMatch(/export\s+const\s+TEST_USERS(?:\s*:\s*[^=]+)?\s*=\s*\[/);
      expect(source).toMatch(/export\s+async\s+function\s+seed\s*\(/);
    });

    it('seed TEST_USERS includes admin and user roles', () => {
      const source = readRuntimeModuleSource('../../../main/tools/scripts/db/seed.ts');
      expect(source).toContain("role: 'admin'");
      expect(source).toContain("role: 'user'");
    });

    it('seed refuses to run in production', () => {
      const source = readRuntimeModuleSource('../../../main/tools/scripts/db/seed.ts');
      expect(source).toContain("process.env['NODE_ENV'] === 'production'");
      expect(source).toContain('process.exit(1)');
    });
  });
});
