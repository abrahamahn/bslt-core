// main/shared/src/contracts/index.ts
/**
 * API Contracts and Port Interfaces
 *
 * This directory contains the unified API contract definitions and service port
 * interfaces used to maintain consistency across the entire application stack.
 *
 * @module Contracts
 */

export { activitiesContract } from './contract.activities';
export { adminContract } from './contract.admin';
export { analyticsContract } from './contract.analytics';
export { apiKeysContract } from './contract.api-keys';
export { authContract } from './contract.auth';
export { billingContract } from './contract.billing';
export { complianceContract } from './contract.compliance';
export { featureFlagsContract } from './contract.feature.flags';
export { filesContract } from './contract.files';
export { healthContract, STATUS_COMPONENTS } from './contract.health';
export type { StatusComponentName, StatusComponentState } from './contract.health';
export { jobsContract } from './contract.jobs';
export { notificationsContract } from './contract.notifications';
export { realtimeContract } from './contract.realtime';
export {
  searchContract,
  searchHitSchema,
  searchRequestQuerySchema,
  searchResponseSchema,
} from './contract.search';
export type { SearchHit, SearchRequestQuery, SearchResponse } from './contract.search';
export { statusContract, statusSummaryResponseSchema } from './contract.status';
export type { StatusIncident, StatusSummaryResponse } from './contract.status';
export { supportContract } from './contract.support';
export { tasksContract } from './contract.tasks';
export { tenantsContract } from './contract.tenants';
export { usersContract } from './contract.users';
export { webhooksContract } from './contract.webhooks';
export type { NativeBridge } from './contract.native';
export type {
  AuthenticatedUser,
  BaseContext,
  HasBilling,
  HasCache,
  HasEmail,
  HasNotifications,
  HasPubSub,
  HasQueue,
  HasStorage,
  ReplyContext,
  RequestContext,
  RequestInfo,
} from './context';
export type {
  Attachment,
  AuditEntry,
  AuditQuery,
  AuditResponse,
  AuditService,
  BaseStorageConfig,
  BreadcrumbData,
  CacheService,
  ConfigService,
  DeletionService,
  EmailOptions,
  EmailService,
  ErrorTracker,
  HasErrorTracker,
  HealthCheckResult,
  InfrastructureService,
  JobOptions,
  JobQueueService,
  LocalStorageConfig,
  MetricsService,
  NotificationService,
  QueueJob,
  QueueJobHandler,
  ReadableStreamLike,
  RecordAuditRequest,
  S3StorageConfig,
  SendResult,
  StorageBackend,
  StorageClient,
  StorageConfig,
  StorageService,
} from './contract.ports';

export type {
  BillingNotifier,
  FileStorageProvider,
  PendingBillingNotification,
} from './edition-ports';
