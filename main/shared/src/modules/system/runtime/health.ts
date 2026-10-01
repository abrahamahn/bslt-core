// main/shared/src/modules/system/runtime/health.ts
/**
 * @file Health Check Types & Logic
 * @description Framework-agnostic type definitions and logic for health monitoring.
 * @module Shared/System/Runtime/Health
 */

/** Status of an individual service. */
export type ServiceStatus = 'up' | 'down' | 'degraded';

/** Overall system health status. */
export type OverallStatus = 'healthy' | 'degraded' | 'down';

/** Health status of a specific service. */
export interface ServiceHealth {
  /** Current status */
  status: ServiceStatus;
  /** Optional status message */
  message?: string;
  /** Optional response latency in milliseconds */
  latencyMs?: number;
}

/** Health status of the database schema. */
export interface SchemaHealth extends ServiceHealth {
  /** List of missing tables */
  missingTables?: string[];
  /** Total number of expected tables */
  tableCount?: number;
}

/** Detailed health response including all monitored services. */
export interface DetailedHealthResponse {
  /** Overall system status */
  status: OverallStatus;
  /** ISO 8601 timestamp of the check */
  timestamp: string;
  /** System uptime in seconds */
  uptime: number;
  /** Health status of individual services */
  services: Record<string, ServiceHealth>;
}

/** Health response for readiness probes (Kubernetes/Load Balancers). */
export interface ReadyResponse {
  /** Readiness status */
  status: 'ready' | 'not_ready';
  /** ISO 8601 timestamp of the check */
  timestamp: string;
}

/** Health response for liveness probes. */
export interface LiveResponse {
  /** Liveness status */
  status: 'alive';
  /** System uptime in seconds */
  uptime: number;
}

/** List of registered API routes. */
export interface RoutesResponse {
  /** Route manifest string */
  routes: string;
  /** ISO 8601 timestamp of the manifest */
  timestamp: string;
}

/** Options for generating a startup summary log entry. */
export interface StartupSummaryOptions {
  /** Server host address */
  host: string;
  /** Server port number */
  port: number;
  /** Total number of registered routes */
  routeCount: number;
}

// ============================================================================
// Response Schemas (for API contracts)
// ============================================================================

import { createSchema, parseNumber, parseString, type Schema } from '../../../schema';

const serviceStatusValues = ['up', 'down', 'degraded'] as const;
const overallStatusValues = ['healthy', 'degraded', 'down'] as const;

/** Schema for DetailedHealthResponse. */
export const detailedHealthResponseSchema: Schema<DetailedHealthResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const statusStr = parseString(obj['status'], 'status');
    if (!overallStatusValues.includes(statusStr as OverallStatus)) {
      throw new Error(`status must be one of: ${overallStatusValues.join(', ')}`);
    }

    const services: Record<string, ServiceHealth> = {};
    if (obj['services'] !== null && typeof obj['services'] === 'object') {
      const svcObj = obj['services'] as Record<string, unknown>;
      for (const key of Object.keys(svcObj)) {
        const svc = (
          svcObj[key] !== null && typeof svcObj[key] === 'object' ? svcObj[key] : {}
        ) as Record<string, unknown>;
        const svcStatus = parseString(svc['status'], `services.${key}.status`);
        if (!serviceStatusValues.includes(svcStatus as ServiceStatus)) {
          throw new Error(
            `services.${key}.status must be one of: ${serviceStatusValues.join(', ')}`,
          );
        }
        const svcEntry: ServiceHealth = { status: svcStatus as ServiceStatus };
        if (typeof svc['message'] === 'string') svcEntry.message = svc['message'];
        if (typeof svc['latencyMs'] === 'number') svcEntry.latencyMs = svc['latencyMs'];
        services[key] = svcEntry;
      }
    }

    return {
      status: statusStr as OverallStatus,
      timestamp: parseString(obj['timestamp'], 'timestamp'),
      uptime: parseNumber(obj['uptime'], 'uptime'),
      services,
    };
  },
);

/** Schema for ReadyResponse. */
export const readyResponseSchema: Schema<ReadyResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const status = parseString(obj['status'], 'status');
  if (status !== 'ready' && status !== 'not_ready') {
    throw new Error('status must be "ready" or "not_ready"');
  }

  return {
    status: status,
    timestamp: parseString(obj['timestamp'], 'timestamp'),
  };
});

/** Schema for LiveResponse. */
export const liveResponseSchema: Schema<LiveResponse> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const status = parseString(obj['status'], 'status');
  if (status !== 'alive') {
    throw new Error('status must be "alive"');
  }

  return {
    status: 'alive' as const,
    uptime: parseNumber(obj['uptime'], 'uptime'),
  };
});

/** Minimal database interface for health checks. */
export interface HealthCheckDatabase {
  healthCheck(): Promise<boolean>;
}

/** Result of a database schema validation. */
export interface SchemaValidationResult {
  valid: boolean;
  missingTables: string[];
}

/** Minimal Pub/Sub interface for health checks. */
export interface HealthCheckPubSub {
  getSubscriptionCount(): number;
}

/** Minimal cache interface for health checks. */
export interface HealthCheckCache {
  getStats(): Promise<{ hits: number; misses: number; size: number }>;
}

/** Minimal background queue interface for health checks. */
export interface HealthCheckQueue {
  getStats(): Promise<{ pending: number; failed: number }>;
}

/** Function type for validating database schema. */
export type SchemaValidator = (db: HealthCheckDatabase) => Promise<SchemaValidationResult>;

/** Basic email health configuration. */
export interface EmailHealthConfig {
  provider: string;
}

/** Basic storage health configuration. */
export interface StorageHealthConfig {
  provider: string;
}

/** WebSocket health statistics. */
export interface WebSocketStats {
  pluginRegistered: boolean;
  activeConnections: number;
}

// ============================================================================
// Individual Health Check Functions
// ============================================================================

/** Check database connection health. */
export async function checkDatabase(db: HealthCheckDatabase): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const isHealthy = await db.healthCheck();
    return {
      status: isHealthy ? 'up' : 'down',
      message: isHealthy ? 'connected' : 'health check failed',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Connection failed',
      latencyMs: Date.now() - start,
    };
  }
}

/** Validate database schema integrity. */
export async function checkSchema(
  db: HealthCheckDatabase,
  validateSchema: SchemaValidator,
  expectedTableCount: number,
): Promise<ServiceHealth & { missingTables?: string[]; tableCount?: number }> {
  try {
    const result = await validateSchema(db);
    if (result.valid) {
      return {
        status: 'up',
        message: `${String(expectedTableCount)} tables present`,
        tableCount: expectedTableCount,
      };
    } else {
      return {
        status: 'down',
        message: `missing ${String(result.missingTables.length)} tables`,
        missingTables: result.missingTables,
        tableCount: expectedTableCount - result.missingTables.length,
      };
    }
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Schema validation failed',
    };
  }
}

/** Report email provider status. */
export function checkEmail(config: EmailHealthConfig): ServiceHealth {
  return {
    status: 'up',
    message: config.provider,
  };
}

/** Report storage provider status. */
export function checkStorage(config: StorageHealthConfig): ServiceHealth {
  return {
    status: 'up',
    message: config.provider,
  };
}

/** Check Pub/Sub subscription health. */
export function checkPubSub(pubsub: HealthCheckPubSub): ServiceHealth {
  const subCount = pubsub.getSubscriptionCount();
  return {
    status: 'up',
    message: `${String(subCount)} active subscriptions`,
  };
}

/** Check cache service health. */
export async function checkCache(cache: HealthCheckCache): Promise<ServiceHealth> {
  try {
    const stats = await cache.getStats();
    return {
      status: 'up',
      message: `${String(stats.size)} items in cache`,
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Cache check failed',
    };
  }
}

/** Check background queue service health. */
export async function checkQueue(queue: HealthCheckQueue): Promise<ServiceHealth> {
  try {
    const stats = await queue.getStats();
    return {
      status: 'up',
      message: `${String(stats.pending)} pending, ${String(stats.failed)} failed`,
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Queue check failed',
    };
  }
}

/** Check WebSocket service health. */
export function checkWebSocket(stats: WebSocketStats): ServiceHealth {
  return {
    status: stats.pluginRegistered ? 'up' : 'down',
    message: stats.pluginRegistered
      ? `${String(stats.activeConnections)} active connections`
      : 'plugin not registered',
  };
}

/** Report rate limiting service status. */
export function checkRateLimit(): ServiceHealth {
  return {
    status: 'up',
    message: 'sliding window active',
  };
}

// ============================================================================
// Aggregate Health
// ============================================================================

/** Determine the overall system status based on individual service health. */
export function determineOverallStatus(services: Record<string, ServiceHealth>): OverallStatus {
  const statuses = Object.values(services).map((s) => s.status);

  if (statuses.every((s) => s === 'down')) {
    return 'down';
  }
  if (statuses.some((s) => s === 'down' || s === 'degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

/** Build a detailed health response from individual service status reports. */
export function buildDetailedHealthResponse(
  services: Record<string, ServiceHealth>,
): DetailedHealthResponse {
  return {
    status: determineOverallStatus(services),
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    services,
  };
}
