// main/kernel/server/src/observability/metrics.test.ts

import { describe, expect, it } from 'vitest';

import { formatPrometheusMetrics, MetricsCollector } from './metrics';

describe('MetricsCollector', () => {
  it('formats collected metrics as Prometheus text', () => {
    const collector = new MetricsCollector();
    collector.incrementRequestCount('/api/users', 200);
    collector.recordRequestLatency('/api/users', 42);
    collector.recordJobEnqueued('email');
    collector.recordJobCompleted('email');
    collector.recordLoginAttempt('password');
    collector.recordLoginSuccess('password');

    const text = formatPrometheusMetrics(collector.getMetricsSummary());

    expect(text).toContain('# TYPE bslt_requests_total counter');
    expect(text).toContain('bslt_requests_total 1');
    expect(text).toContain('bslt_requests_by_route_total{route="/api/users"} 1');
    expect(text).toContain('bslt_request_latency_ms{quantile="0.95"} 42');
    expect(text).toContain('bslt_jobs_by_name_total{job="email",state="completed"} 1');
    expect(text).toContain(
      'bslt_auth_provider_events_total{provider="password",event="success"} 1',
    );
  });

  it('escapes Prometheus label values', () => {
    const text = formatPrometheusMetrics({
      requests: {
        total: 1,
        byRoute: { '/api/search?q="x"': 1 },
        byStatus: {},
      },
      latency: { p50: 0, p95: 0, p99: 0, avg: 0 },
      jobs: { enqueued: 0, processed: 0, completed: 0, failed: 0, byName: {} },
      auth: {
        loginAttempts: 0,
        loginSuccess: 0,
        loginFailures: 0,
        lockouts: 0,
        byProvider: {},
      },
      db: { up: true, lastCheckDurationMs: 0, checks: 0, failures: 0 },
      uptimeSeconds: 1,
      collectedAt: '2024-01-01T00:00:00.000Z',
    });

    expect(text).toContain('route="/api/search?q=\\"x\\""');
  });

  it('records database health probes and exports them', () => {
    const collector = new MetricsCollector();
    collector.recordDbHealthCheck(true, 12);
    collector.recordDbHealthCheck(false, 800);

    const summary = collector.getMetricsSummary();
    expect(summary.db).toEqual({
      up: false,
      lastCheckDurationMs: 800,
      checks: 2,
      failures: 1,
    });

    const text = formatPrometheusMetrics(summary);
    expect(text).toContain('# TYPE bslt_db_up gauge');
    expect(text).toContain('bslt_db_up 0');
    expect(text).toContain('bslt_db_check_duration_ms 800');
    expect(text).toContain('bslt_db_checks_total{result="ok"} 1');
    expect(text).toContain('bslt_db_checks_total{result="fail"} 1');
  });

  it('reports the database as up after a successful probe', () => {
    const collector = new MetricsCollector();
    collector.recordDbHealthCheck(true, 5);

    expect(formatPrometheusMetrics(collector.getMetricsSummary())).toContain('bslt_db_up 1');
  });

  it('records queue dead-letter and pending snapshots and exports Prometheus gauges', () => {
    const collector = new MetricsCollector();
    collector.recordQueueSnapshot({ dead: 4, pending: 11 });

    const summary = collector.getMetricsSummary();
    expect(summary.jobs.dead).toBe(4);
    expect(summary.jobs.pending).toBe(11);

    const text = formatPrometheusMetrics(summary);
    expect(text).toContain('# TYPE bslt_jobs_dead_gauge gauge');
    expect(text).toContain('bslt_jobs_dead_gauge 4');
    expect(text).toContain('bslt_jobs_pending_gauge 11');

    collector.reset();
    expect(collector.getMetricsSummary().jobs.dead).toBe(0);
    expect(collector.getMetricsSummary().jobs.pending).toBe(0);
  });

  it('exports role- and instance-labelled latency histograms and event-loop lag metrics, clamping invalid samples', () => {
    const collector = new MetricsCollector({ role: 'worker', instance: 'worker-pod-"1"' });
    collector.recordRequestLatency('/health', 12);
    collector.recordRequestLatency('/health', 280);
    collector.recordRequestLatency('/health', -15);
    collector.recordRequestLatency('/health', Number.NaN);
    collector.setEventLoopLagProvider(() => ({
      p50Ms: 1.25,
      p95Ms: 4.5,
      p99Ms: 9.75,
      maxMs: 14.2,
      meanMs: 1.8,
    }));

    const summary = collector.getMetricsSummary();
    expect(summary.process).toEqual({ role: 'worker', instance: 'worker-pod-"1"' });
    expect(summary.latencyHistogram?.count).toBe(3);
    expect(summary.latencyHistogram?.sum).toBe(292);
    expect(summary.eventLoopLag).toEqual({
      p50Ms: 1.25,
      p95Ms: 4.5,
      p99Ms: 9.75,
      maxMs: 14.2,
      meanMs: 1.8,
    });

    const text = formatPrometheusMetrics(summary);
    expect(text).toContain('# TYPE bslt_http_request_duration_ms histogram');
    expect(text).toContain(
      'bslt_http_request_duration_ms_bucket{role="worker",instance="worker-pod-\\"1\\"",le="25"} 2',
    );
    expect(text).toContain(
      'bslt_http_request_duration_ms_bucket{role="worker",instance="worker-pod-\\"1\\"",le="500"} 3',
    );
    expect(text).toContain(
      'bslt_http_request_duration_ms_bucket{role="worker",instance="worker-pod-\\"1\\"",le="+Inf"} 3',
    );
    expect(text).toContain(
      'bslt_http_request_duration_ms_sum{role="worker",instance="worker-pod-\\"1\\""} 292',
    );
    expect(text).toContain(
      'bslt_http_request_duration_ms_count{role="worker",instance="worker-pod-\\"1\\""} 3',
    );
    expect(text).toContain('# TYPE bslt_event_loop_lag_ms gauge');
    expect(text).toContain(
      'bslt_event_loop_lag_ms{role="worker",instance="worker-pod-\\"1\\"",quantile="0.99"} 9.75',
    );
    expect(text).toContain(
      'bslt_event_loop_lag_max_ms{role="worker",instance="worker-pod-\\"1\\""} 14.2',
    );

    collector.setProcessIdentity({ role: 'api', instance: 'api-2' });
    collector.reset();
    const afterReset = collector.getMetricsSummary();
    expect(afterReset.process).toEqual({ role: 'api', instance: 'api-2' });
    expect(afterReset.latencyHistogram?.count).toBe(0);
    expect(afterReset.latencyHistogram?.sum).toBe(0);
  });
});
