// main/shared/src/modules/index.ts
/**
 * Modules Barrel
 *
 * Subpath imports (`@bslt/shared/<module>`) are the primary API. This barrel
 * backs the package root (`@bslt/shared`) and re-exports only the symbols
 * actually consumed via the root; add here only when a new consumer needs it.
 */

export type { Notification } from './comms';

export { SECURITY_SEVERITIES } from './core';
export type {
  AdminLockUserResponse,
  AdminUpdateUserResponse,
  AdminUser,
  AdminUserListFilters,
  AdminUserListResponse,
  AppRole,
  AvatarDeleteResponse,
  AvatarUploadResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  JobActionResponse,
  JobListResponse,
  JobStatus,
  OAuthConnection,
  OAuthProvider,
  PasskeyListItem,
  QueueStats,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  SecurityEvent,
  SecurityEventsExportResponse,
  SecurityEventsFilter,
  SecurityEventsListResponse,
  SecurityMetrics,
  Session,
  SessionsListResponse,
  TotpSetupResponse,
  TotpStatusResponse,
  UpdateProfileRequest,
  User,
  UserRole,
} from './core';

export type { PaginationOptions, SubscriptionKey } from './db';

export { AppError } from './system';
