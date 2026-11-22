// main/kernel/server/src/observability/metrics.ts
/**
 * In-Memory Metrics Collector
 *
 * Lightweight request metrics collector using Map-based counters.
 * No external dependencies — suitable for single-instance deployments.
 * For multi-instance production use, replace with Prometheus or similar.
 */

// ============================================================================
// Types
// ============================================================================

/** Summary of collected request metrics. */
interface MetricsSummary {
  /** Process identity labels attached to histograms and runtime gauges. */
  process?: {
    role: string;
    instance: string;
  };
  /** Total request count since last reset */
  requests: {
    total: number;
    byRoute: Record<string, number>;
    byStatus: Record<string, number>;
  };
  /** Latency distribution in milliseconds */
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  /** Cumulative request duration histogram buckets in milliseconds */
  latencyHistogram?: {
    buckets: ReadonlyArray<{ le: number; count: number }>;
    count: number;
    sum: number;
  };
  /** Node.js event-loop lag distribution in milliseconds */
  eventLoopLag?: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    meanMs: number;
  };
  /** Background job metrics */
  jobs: {
    enqueued: number;
    processed: number;
    completed: number;
    failed: number;
    dead?: number;
    pending?: number;
    byName: Record<string, { enqueued: number; completed: number; failed: number }>;
  };
  /** Authentication metrics */
  auth: {
    loginAttempts: number;
    loginSuccess: number;
    loginFailures: number;
    lockouts: number;
    byProvider: Record<string, { success: number; failure: number }>;
  };
  /** Database health, sampled by a periodic probe */
  db: {
    /** Whether the last probe reached the database */
    up: boolean;
    /** Duration of the last probe in milliseconds */
    lastCheckDurationMs: number;
    /** Total probes run */
    checks: number;
    /** Probes that failed to reach the database */
    failures: number;
  };
  /** Uptime in seconds since collector was created or last reset */
  uptimeSeconds: number;
  /** ISO 8601 timestamp of when the summary was generated */
  collectedAt: string;
}

// ============================================================================
// Percentile Calculation
// ============================================================================

/**
 * Calculate the value at a given percentile from a sorted array.
 * @param sorted - Pre-sorted array of numbers (ascending)
 * @param p - Percentile value between 0 and 100
 * @complexity O(1) for lookup (caller must pre-sort)
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function escapePrometheusLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelSet(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapePrometheusLabel(value)}"`).join(',')}}`;
}

function metricLine(name: string, value: number, labels: Record<string, string> = {}): string {
  return `${name}${labelSet(labels)} ${String(value)}`;
}

function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

const DEFAULT_LATENCY_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const;

type EventLoopLagProvider = () => {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
};

// ============================================================================
// Metrics Collector
// ============================================================================

/**
 * In-memory metrics collector.
 *
 * Thread-safe for single-threaded Node.js runtimes.
 * Stores request counts by route and status code, plus raw latency
 * values for percentile calculation.
 */
export class MetricsCollector {
  private readonly routeCounts = new Map<string, number>();
  private readonly statusCounts = new Map<string, number>();
  private latencies: number[] = [];
  private totalRequests = 0;
  private startedAt = Date.now();

  // Job metrics
  private totalJobsEnqueued = 0;
  private totalJobsProcessed = 0;
  private totalJobsCompleted = 0;
  private totalJobsFailed = 0;
  private jobsDead = 0;
  private jobsPending = 0;
  private readonly jobStats = new Map<
    string,
    { enqueued: number; completed: number; failed: number }
  >();

  // Auth metrics
  private totalLoginAttempts = 0;
  private totalLoginSuccess = 0;
  private totalLoginFailures = 0;
  private totalLockouts = 0;
  private readonly providerStats = new Map<string, { success: number; failure: number }>();

  // Database health metrics (sampled by a periodic probe).
  private dbUp = true;
  private dbLastCheckDurationMs = 0;
  private dbChecks = 0;
  private dbFailures = 0;

  /**
   * Maximum number of latency samples to retain.
   * Prevents unbounded memory growth on long-running servers.
   * When exceeded, oldest samples are dropped.
   */
  private readonly maxLatencySamples: number;
  private role: string;
  private instance: string;
  private histogramBucketCounts: number[] = DEFAULT_LATENCY_BUCKETS_MS.map(() => 0);
  private histogramCount = 0;
  private histogramSum = 0;
  private eventLoopLagProvider: EventLoopLagProvider | undefined;

  constructor(options?: { maxLatencySamples?: number; role?: string; instance?: string }) {
    this.maxLatencySamples = options?.maxLatencySamples ?? 10_000;
    this.role = options?.role ?? 'all';
    this.instance = options?.instance ?? 'default';
  }

  /** Set the process role and instance labels attached to histograms and loop lag metrics. */
  setProcessIdentity(identity: { readonly role: string; readonly instance: string }): void {
    this.role = identity.role;
    this.instance = identity.instance;
  }

  /** Attach or detach a live event-loop lag sampler. */
  setEventLoopLagProvider(provider: EventLoopLagProvider | undefined): void {
    this.eventLoopLagProvider = provider;
  }

  // ==========================================================================
  // Recording — Requests
  // ==========================================================================

  /**
   * Increment the request counter for a given route and status code.
   * @param route - The API route path (e.g. '/api/users')
   * @param statusCode - HTTP response status code
   */
  incrementRequestCount(route: string, statusCode: number): void {
    this.totalRequests += 1;
    this.routeCounts.set(route, (this.routeCounts.get(route) ?? 0) + 1);
    const statusKey = String(statusCode);
    this.statusCounts.set(statusKey, (this.statusCounts.get(statusKey) ?? 0) + 1);
  }

  /**
   * Record a request latency value.
   * @param _route - Reserved for future per-route latency tracking
   * @param durationMs - Request duration in milliseconds
   */
  recordRequestLatency(_route: string, durationMs: number): void {
    if (!Number.isFinite(durationMs)) return;
    const clamped = Math.max(0, durationMs);
    if (this.latencies.length >= this.maxLatencySamples) {
      this.latencies.shift();
    }
    this.latencies.push(clamped);
    this.histogramCount += 1;
    this.histogramSum += clamped;
    for (let i = 0; i < DEFAULT_LATENCY_BUCKETS_MS.length; i++) {
      const bound = DEFAULT_LATENCY_BUCKETS_MS[i];
      if (bound !== undefined && clamped <= bound) {
        this.histogramBucketCounts[i] = (this.histogramBucketCounts[i] ?? 0) + 1;
      }
    }
  }

  // ==========================================================================
  // Recording — Jobs
  // ==========================================================================

  /** @param jobName - Name of the background job */
  recordJobEnqueued(jobName: string): void {
    this.totalJobsEnqueued += 1;
    const stats = this.jobStats.get(jobName) ?? {
      enqueued: 0,
      completed: 0,
      failed: 0,
    };
    stats.enqueued += 1;
    this.jobStats.set(jobName, stats);
  }

  /** @param _jobName - Name of the background job */
  recordJobStarted(_jobName: string): void {
    this.totalJobsProcessed += 1;
  }

  /** @param jobName - Name of the background job */
  recordJobCompleted(jobName: string): void {
    this.totalJobsCompleted += 1;
    const stats = this.jobStats.get(jobName) ?? {
      enqueued: 0,
      completed: 0,
      failed: 0,
    };
    stats.completed += 1;
    this.jobStats.set(jobName, stats);
  }

  /** @param jobName - Name of the background job */
  recordJobFailed(jobName: string): void {
    this.totalJobsFailed += 1;
    const stats = this.jobStats.get(jobName) ?? {
      enqueued: 0,
      completed: 0,
      failed: 0,
    };
    stats.failed += 1;
    this.jobStats.set(jobName, stats);
  }

  /** Record current queue dead-letter and pending job counts. */
  recordQueueSnapshot(stats: { readonly dead: number; readonly pending: number }): void {
    this.jobsDead = stats.dead;
    this.jobsPending = stats.pending;
  }

  // ==========================================================================
  // Recording — Auth
  // ==========================================================================

  /** @param provider - Auth provider (e.g. 'password', 'google') */
  recordLoginAttempt(provider: string): void {
    this.totalLoginAttempts += 1;
    const stats = this.providerStats.get(provider) ?? {
      success: 0,
      failure: 0,
    };
    this.providerStats.set(provider, stats);
  }

  /** @param provider - Auth provider */
  recordLoginSuccess(provider: string): void {
    this.totalLoginSuccess += 1;
    const stats = this.providerStats.get(provider) ?? {
      success: 0,
      failure: 0,
    };
    stats.success += 1;
    this.providerStats.set(provider, stats);
  }

  /** @param provider - Auth provider */
  recordLoginFailure(provider: string): void {
    this.totalLoginFailures += 1;
    const stats = this.providerStats.get(provider) ?? {
      success: 0,
      failure: 0,
    };
    stats.failure += 1;
    this.providerStats.set(provider, stats);
  }

  /** Record an account lockout event. */
  recordLockout(): void {
    this.totalLockouts += 1;
  }

  // ==========================================================================
  // Recording — Database health
  // ==========================================================================

  /**
   * Record the result of a periodic database health probe. Probe latency rises
   * under both an outright outage and pool saturation (postgres.js queues
   * queries when every connection is busy), so this doubles as a saturation
   * signal without reaching into driver internals.
   *
   * @param ok - Whether the probe reached the database
   * @param durationMs - How long the probe took, in milliseconds
   */
  recordDbHealthCheck(ok: boolean, durationMs: number): void {
    this.dbUp = ok;
    this.dbLastCheckDurationMs = durationMs;
    this.dbChecks += 1;
    if (!ok) this.dbFailures += 1;
  }

  // ==========================================================================
  // Retrieval
  // ==========================================================================

  /**
   * Build a summary of all collected metrics.
   * @complexity O(n log n) where n = number of latency samples (sorting)
   */
  getMetricsSummary(): MetricsSummary {
    const byRoute: Record<string, number> = {};
    for (const [route, count] of this.routeCounts) {
      byRoute[route] = count;
    }

    const byStatus: Record<string, number> = {};
    for (const [status, count] of this.statusCounts) {
      byStatus[status] = count;
    }

    const jobByName: Record<string, { enqueued: number; completed: number; failed: number }> = {};
    for (const [name, stats] of this.jobStats) {
      jobByName[name] = { ...stats };
    }

    const authByProvider: Record<string, { success: number; failure: number }> = {};
    for (const [provider, stats] of this.providerStats) {
      authByProvider[provider] = { ...stats };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const avg = sorted.length > 0 ? sorted.reduce((sum, val) => sum + val, 0) / sorted.length : 0;

    const eventLoopLag = this.eventLoopLagProvider?.();

    return {
      process: { role: this.role, instance: this.instance },
      requests: { total: this.totalRequests, byRoute, byStatus },
      latency: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        avg: Math.round(avg * 100) / 100,
      },
      latencyHistogram: {
        buckets: DEFAULT_LATENCY_BUCKETS_MS.map((le, idx) => ({
          le,
          count: this.histogramBucketCounts[idx] ?? 0,
        })),
        count: this.histogramCount,
        sum: Math.round(this.histogramSum * 100) / 100,
      },
      ...(eventLoopLag !== undefined ? { eventLoopLag } : {}),
      jobs: {
        enqueued: this.totalJobsEnqueued,
        processed: this.totalJobsProcessed,
        completed: this.totalJobsCompleted,
        failed: this.totalJobsFailed,
        dead: this.jobsDead,
        pending: this.jobsPending,
        byName: jobByName,
      },
      auth: {
        loginAttempts: this.totalLoginAttempts,
        loginSuccess: this.totalLoginSuccess,
        loginFailures: this.totalLoginFailures,
        lockouts: this.totalLockouts,
        byProvider: authByProvider,
      },
      db: {
        up: this.dbUp,
        lastCheckDurationMs: this.dbLastCheckDurationMs,
        checks: this.dbChecks,
        failures: this.dbFailures,
      },
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      collectedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Management
  // ==========================================================================

  /**
   * Reset all collected metrics.
   * Useful for testing or periodic metric windows.
   */
  reset(): void {
    this.routeCounts.clear();
    this.statusCounts.clear();
    this.latencies = [];
    this.histogramBucketCounts = DEFAULT_LATENCY_BUCKETS_MS.map(() => 0);
    this.histogramCount = 0;
    this.histogramSum = 0;
    this.totalRequests = 0;
    this.totalJobsEnqueued = 0;
    this.totalJobsProcessed = 0;
    this.totalJobsCompleted = 0;
    this.totalJobsFailed = 0;
    this.jobsDead = 0;
    this.jobsPending = 0;
    this.jobStats.clear();
    this.totalLoginAttempts = 0;
    this.totalLoginSuccess = 0;
    this.totalLoginFailures = 0;
    this.totalLockouts = 0;
    this.providerStats.clear();
    this.dbUp = true;
    this.dbLastCheckDurationMs = 0;
    this.dbChecks = 0;
    this.dbFailures = 0;
    this.startedAt = Date.now();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalCollector: MetricsCollector | null = null;

/**
 * Get the global MetricsCollector singleton. Creates one on first access.
 */
export function getMetricsCollector(): MetricsCollector {
  globalCollector ??= new MetricsCollector();
  return globalCollector;
}

/**
 * Reset the global MetricsCollector singleton.
 * Primarily for testing — creates a fresh instance on next access.
 */
export function resetMetricsCollector(): void {
  globalCollector = null;
}

/**
 * Format metrics in Prometheus text exposition format.
 *
 * This keeps the default collector dependency-free while giving production
 * deployments a scrapeable export surface for Prometheus-compatible agents.
 */
export function formatPrometheusMetrics(summary: MetricsSummary): string {
  const lines: string[] = [
    '# HELP bslt_requests_total Total HTTP requests since the collector started.',
    '# TYPE bslt_requests_total counter',
    metricLine('bslt_requests_total', summary.requests.total),
  ];

  lines.push(
    '# HELP bslt_requests_by_route_total HTTP requests grouped by route.',
    '# TYPE bslt_requests_by_route_total counter',
  );
  for (const [route, count] of sortedEntries(summary.requests.byRoute)) {
    lines.push(metricLine('bslt_requests_by_route_total', count, { route }));
  }

  lines.push(
    '# HELP bslt_requests_by_status_total HTTP requests grouped by status code.',
    '# TYPE bslt_requests_by_status_total counter',
  );
  for (const [status, count] of sortedEntries(summary.requests.byStatus)) {
    lines.push(metricLine('bslt_requests_by_status_total', count, { status }));
  }

  lines.push(
    '# HELP bslt_request_latency_ms Request latency percentiles in milliseconds.',
    '# TYPE bslt_request_latency_ms gauge',
    metricLine('bslt_request_latency_ms', summary.latency.p50, {
      quantile: '0.5',
    }),
    metricLine('bslt_request_latency_ms', summary.latency.p95, {
      quantile: '0.95',
    }),
    metricLine('bslt_request_latency_ms', summary.latency.p99, {
      quantile: '0.99',
    }),
    metricLine('bslt_request_latency_avg_ms', summary.latency.avg),
  );

  const processLabels = {
    role: summary.process?.role ?? 'all',
    instance: summary.process?.instance ?? 'default',
  };

  if (summary.latencyHistogram !== undefined) {
    lines.push(
      '# HELP bslt_http_request_duration_ms HTTP request duration histogram in milliseconds.',
      '# TYPE bslt_http_request_duration_ms histogram',
    );
    for (const bucket of summary.latencyHistogram.buckets) {
      lines.push(
        metricLine('bslt_http_request_duration_ms_bucket', bucket.count, {
          ...processLabels,
          le: String(bucket.le),
        }),
      );
    }
    lines.push(
      metricLine('bslt_http_request_duration_ms_bucket', summary.latencyHistogram.count, {
        ...processLabels,
        le: '+Inf',
      }),
      metricLine('bslt_http_request_duration_ms_sum', summary.latencyHistogram.sum, processLabels),
      metricLine(
        'bslt_http_request_duration_ms_count',
        summary.latencyHistogram.count,
        processLabels,
      ),
    );
  }

  if (summary.eventLoopLag !== undefined) {
    lines.push(
      '# HELP bslt_event_loop_lag_ms Node.js event-loop lag percentiles in milliseconds.',
      '# TYPE bslt_event_loop_lag_ms gauge',
      metricLine('bslt_event_loop_lag_ms', summary.eventLoopLag.p50Ms, {
        ...processLabels,
        quantile: '0.5',
      }),
      metricLine('bslt_event_loop_lag_ms', summary.eventLoopLag.p95Ms, {
        ...processLabels,
        quantile: '0.95',
      }),
      metricLine('bslt_event_loop_lag_ms', summary.eventLoopLag.p99Ms, {
        ...processLabels,
        quantile: '0.99',
      }),
      '# HELP bslt_event_loop_lag_max_ms Maximum observed Node.js event-loop lag in milliseconds.',
      '# TYPE bslt_event_loop_lag_max_ms gauge',
      metricLine('bslt_event_loop_lag_max_ms', summary.eventLoopLag.maxMs, processLabels),
      '# HELP bslt_event_loop_lag_mean_ms Mean Node.js event-loop lag in milliseconds.',
      '# TYPE bslt_event_loop_lag_mean_ms gauge',
      metricLine('bslt_event_loop_lag_mean_ms', summary.eventLoopLag.meanMs, processLabels),
    );
  }

  lines.push(
    '# HELP bslt_jobs_total Background job counters.',
    '# TYPE bslt_jobs_total counter',
    metricLine('bslt_jobs_total', summary.jobs.enqueued, { state: 'enqueued' }),
    metricLine('bslt_jobs_total', summary.jobs.processed, {
      state: 'processed',
    }),
    metricLine('bslt_jobs_total', summary.jobs.completed, {
      state: 'completed',
    }),
    metricLine('bslt_jobs_total', summary.jobs.failed, { state: 'failed' }),
    '# HELP bslt_jobs_dead_gauge Current number of dead-lettered background jobs.',
    '# TYPE bslt_jobs_dead_gauge gauge',
    metricLine('bslt_jobs_dead_gauge', summary.jobs.dead ?? 0),
    '# HELP bslt_jobs_pending_gauge Current number of pending background jobs.',
    '# TYPE bslt_jobs_pending_gauge gauge',
    metricLine('bslt_jobs_pending_gauge', summary.jobs.pending ?? 0),
  );

  for (const [jobName, stats] of sortedEntries(summary.jobs.byName)) {
    lines.push(
      metricLine('bslt_jobs_by_name_total', stats.enqueued, {
        job: jobName,
        state: 'enqueued',
      }),
      metricLine('bslt_jobs_by_name_total', stats.completed, {
        job: jobName,
        state: 'completed',
      }),
      metricLine('bslt_jobs_by_name_total', stats.failed, {
        job: jobName,
        state: 'failed',
      }),
    );
  }

  lines.push(
    '# HELP bslt_auth_events_total Authentication event counters.',
    '# TYPE bslt_auth_events_total counter',
    metricLine('bslt_auth_events_total', summary.auth.loginAttempts, {
      event: 'login_attempt',
    }),
    metricLine('bslt_auth_events_total', summary.auth.loginSuccess, {
      event: 'login_success',
    }),
    metricLine('bslt_auth_events_total', summary.auth.loginFailures, {
      event: 'login_failure',
    }),
    metricLine('bslt_auth_events_total', summary.auth.lockouts, {
      event: 'lockout',
    }),
  );

  for (const [provider, stats] of sortedEntries(summary.auth.byProvider)) {
    lines.push(
      metricLine('bslt_auth_provider_events_total', stats.success, {
        provider,
        event: 'success',
      }),
      metricLine('bslt_auth_provider_events_total', stats.failure, {
        provider,
        event: 'failure',
      }),
    );
  }

  lines.push(
    '# HELP bslt_db_up Database reachability from the last health probe (1 = up).',
    '# TYPE bslt_db_up gauge',
    metricLine('bslt_db_up', summary.db.up ? 1 : 0),
    '# HELP bslt_db_check_duration_ms Duration of the last database health probe in milliseconds.',
    '# TYPE bslt_db_check_duration_ms gauge',
    metricLine('bslt_db_check_duration_ms', summary.db.lastCheckDurationMs),
    '# HELP bslt_db_checks_total Database health probes grouped by result.',
    '# TYPE bslt_db_checks_total counter',
    metricLine('bslt_db_checks_total', summary.db.checks - summary.db.failures, { result: 'ok' }),
    metricLine('bslt_db_checks_total', summary.db.failures, { result: 'fail' }),
  );

  lines.push(
    '# HELP bslt_uptime_seconds Collector uptime in seconds.',
    '# TYPE bslt_uptime_seconds gauge',
    metricLine('bslt_uptime_seconds', summary.uptimeSeconds),
    '',
  );

  return lines.join('\n');
}
