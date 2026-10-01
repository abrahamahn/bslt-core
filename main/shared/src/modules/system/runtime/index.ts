// main/shared/src/modules/system/runtime/index.ts

export {
  buildDetailedHealthResponse,
  checkCache,
  checkDatabase,
  checkEmail,
  checkPubSub,
  checkQueue,
  checkRateLimit,
  checkSchema,
  checkStorage,
  checkWebSocket,
  detailedHealthResponseSchema,
  determineOverallStatus,
  liveResponseSchema,
  readyResponseSchema,
} from './health';
export type {
  DetailedHealthResponse,
  EmailHealthConfig,
  HealthCheckCache,
  HealthCheckDatabase,
  HealthCheckPubSub,
  HealthCheckQueue,
  LiveResponse,
  OverallStatus,
  ReadyResponse,
  RoutesResponse,
  SchemaHealth,
  SchemaValidationResult,
  SchemaValidator,
  ServiceHealth,
  ServiceStatus,
  StartupSummaryOptions,
  StorageHealthConfig,
  WebSocketStats,
} from './health';

export { uniquePorts } from './runtime';
