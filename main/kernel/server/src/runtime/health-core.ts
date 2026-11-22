// main/kernel/server/src/runtime/health-core.ts
/**
 * @file Health Check Types & Logic
 * @description Framework-agnostic type definitions and logic for health monitoring.
 * @module Shared/System/Runtime/Health
 */

/** Status of an individual service. */
type ServiceStatus = 'up' | 'down' | 'degraded';

/** Overall system health status. */
type OverallStatus = 'healthy' | 'degraded' | 'down';

/** Health status of a specific service. */
export interface ServiceHealth {
  /** Current status */
  status: ServiceStatus;
  /** Optional status message */
  message?: string | undefined;
  /** Optional response latency in milliseconds */
  latencyMs?: number | undefined;
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

import {
  defaulted,
  enumOf,
  literal,
  number,
  object,
  optional,
  record,
  string,
  type Schema,
} from '@bslt/schema';

const serviceStatusValues = ['up', 'down', 'degraded'] as const;
const overallStatusValues = ['healthy', 'degraded', 'down'] as const;

const serviceHealthSchema: Schema<ServiceHealth> = object(
  {
    status: enumOf(serviceStatusValues, 'status'),
    message: optional(string({ label: 'message' })),
    latencyMs: optional(number({ label: 'latencyMs' })),
  },
  { unknownKeys: 'strip' },
);

/** Schema for DetailedHealthResponse. */
export const detailedHealthResponseSchema: Schema<DetailedHealthResponse> = object(
  {
    status: enumOf(overallStatusValues, 'status'),
    timestamp: string({ label: 'timestamp' }),
    uptime: number({ label: 'uptime' }),
    services: defaulted(record(serviceHealthSchema), {}),
  },
  { unknownKeys: 'strip' },
);

/** Schema for ReadyResponse. */
export const readyResponseSchema: Schema<ReadyResponse> = object(
  {
    status: enumOf(['ready', 'not_ready'] as const, 'status'),
    timestamp: string({ label: 'timestamp' }),
  },
  { unknownKeys: 'strip' },
);

/** Schema for LiveResponse. */
export const liveResponseSchema: Schema<LiveResponse> = object(
  {
    status: literal('alive'),
    uptime: number({ label: 'uptime' }),
  },
  { unknownKeys: 'strip' },
);

/** Minimal database interface for health checks. */
export interface HealthCheckDatabase {
  healthCheck(): Promise<boolean>;
}

/** Result of a database schema validation. */
interface SchemaValidationResult {
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
interface EmailHealthConfig {
  provider: string;
}

/** Basic storage health configuration. */
interface StorageHealthConfig {
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
