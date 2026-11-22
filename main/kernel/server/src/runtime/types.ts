// main/kernel/server/src/runtime/types.ts
import type { AppConfig } from '../config/env/env.validation';
import type { Logger } from '../logger/types';
import type {
  HealthCheckCache,
  HealthCheckDatabase,
  HealthCheckPubSub,
  HealthCheckQueue,
} from './health-core';
import type { EmailService, StorageClient } from '@bslt/contract';

/**
 * Minimal context required by system health-check functions.
 *
 * Intentionally free of @bslt/db imports so that the health module
 * remains a pure infrastructure adapter. Callers that need DB-specific
 * operations (schema validation, RLS scoping) should extend this interface
 * in their own composition layer.
 */
export interface HealthContext {
  config: AppConfig;
  /** Database handle for connectivity checks (shared interface only — no raw SQL). */
  db: HealthCheckDatabase;
  cache: HealthCheckCache;
  queue: HealthCheckQueue;
  pubsub: HealthCheckPubSub;
  log: Logger;
  /** Optional: email service — used when present for email health checks. */
  email?: EmailService | undefined;
  /** Optional: storage service — used when present for storage health checks. */
  storage?: StorageClient | undefined;
}
