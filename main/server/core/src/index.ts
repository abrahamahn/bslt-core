// main/server/core/src/index.ts
/**
 * @bslt/core — Unified Business Modules
 *
 * Top-level barrel re-exports only route maps and key factories
 * needed by the server route registration layer. For full module
 * APIs, import from subpath exports:
 *
 * @example
 * ```ts
 * import { authRoutes, createAuthGuard } from '@bslt/core/auth';
 * import { billingRoutes } from '@bslt/core/billing';
 * ```
 */

export { authRoutes, createAuthGuard, verifyToken } from './auth';
export { notificationRoutes } from './notifications';
export { coreRouteModuleRegistrations } from './route-modules';
export { userRoutes } from './users';

// Re-export common types for consumers (apps/server)
export type { SmsProvider } from '@bslt/shared/comms/sms';
export type {
  DbClient,
  PostgresPubSub,
  QueueServer,
  QueueStore,
  Repositories,
  ServerSearchProvider,
  SessionContext,
  WriteService,
} from '@bslt/db';
export type { Logger } from '@bslt/server-system/logger';
export type { AppConfig } from '@bslt/shared/system/config';
