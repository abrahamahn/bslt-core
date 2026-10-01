// main/shared/src/modules/core/index.ts
/**
 * Core Module Barrel
 *
 * Deep subpaths (`@bslt/shared/core/<domain>`) are the primary API. This
 * barrel re-exports only the symbols consumed via `@bslt/shared/core`, the
 * package root, or the contracts layer; add here only when a consumer
 * actually imports it.
 */

// Constants live in ../../constants/core; the barrel siblings-only rule bans
// re-exporting them with a `../` source, so import-then-export instead.
import {
  BILLING_EVENT_TYPES,
  BILLING_PROVIDERS,
  INVOICE_STATUSES,
  OAUTH_PROVIDERS,
  PAYMENT_METHOD_TYPES,
  PLAN_INTERVALS,
  SUBSCRIPTION_STATUSES,
} from '../../constants/core';

export {
  BILLING_EVENT_TYPES,
  BILLING_PROVIDERS,
  INVOICE_STATUSES,
  OAUTH_PROVIDERS,
  PAYMENT_METHOD_TYPES,
  PLAN_INTERVALS,
  SUBSCRIPTION_STATUSES,
};

export { activitiesListFiltersSchema, activitySchema } from './activities';
export type { ActorType } from './activities';

export {
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
  adminActionResponseSchema,
  adminCreateUserRequestSchema,
  adminDeleteUserRequestSchema,
  adminResetPasswordRequestSchema,
  adminForceLogoutRequestSchema,
  adminForceLogoutResponseSchema,
  adminHardBanRequestSchema,
  adminHardBanResponseSchema,
  adminLockUserRequestSchema,
  adminSuspendTenantRequestSchema,
  adminTenantDetailSchema,
  adminTenantStateChangeResponseSchema,
  adminTenantsListResponseSchema,
  adminUpdateUserRequestSchema,
  adminUserListFiltersSchema,
  adminUserListResponseSchema,
  adminUserSchema,
  adminWebhookDeliveryListResponseSchema,
  adminWebhookListResponseSchema,
  adminWebhookReplayResponseSchema,
  endImpersonationRequestSchema,
  endImpersonationResponseSchema,
  impersonationResponseSchema,
  routeManifestResponseSchema,
  securityEventDetailResponseSchema,
  securityEventsExportRequestSchema,
  securityEventsExportResponseSchema,
  securityEventsListRequestSchema,
  securityEventsListResponseSchema,
  securityMetricsRequestSchema,
  securityMetricsResponseSchema,
  systemStatsResponseSchema,
  unlockAccountRequestSchema,
} from './admin';
export type {
  AdminForceLogoutRequest,
  AdminForceLogoutResponse,
  AdminLockUserResponse,
  AdminUpdateUserResponse,
  AdminUser,
  AdminUserListFilters,
  AdminUserListResponse,
  SecurityEvent,
  SecurityEventType,
  SecurityEventsExportResponse,
  SecurityEventsFilter,
  SecurityEventsListResponse,
  SecurityMetrics,
  SecuritySeverity,
} from './admin';

export { auditLogFilterSchema, auditLogListResponseSchema } from './audit-log';
export type { AuditCategory, AuditSeverity } from './audit-log';

export {
  acceptTosRequestSchema,
  acceptTosResponseSchema,
  authResponseSchema,
  backupCodesRegenerateResponseSchema,
  changeEmailRequestSchema,
  invalidateSessionsResponseSchema,
  magicLinkRequestResponseSchema,
  oauthCallbackQuerySchema,
  passkeyListResponseSchema,
  webauthnLoginOptionsRequestSchema,
  backupCodesStatusResponseSchema,
  changeEmailResponseSchema,
  confirmEmailChangeRequestSchema,
  confirmEmailChangeResponseSchema,
  completeOnboardingRequestSchema,
  completeOnboardingResponseSchema,
  deviceListResponseSchema,
  emailOtpRequestResponseSchema,
  emailOtpRequestSchema,
  emailOtpVerifyRequestSchema,
  emailOtpVerifyResponseSchema,
  EMAIL_OTP_CODE_LENGTH,
  emailVerificationRequestSchema,
  emailVerificationResponseSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  loginSuccessResponseSchema,
  logoutResponseSchema,
  magicLinkRequestSchema,
  magicLinkVerifyRequestSchema,
  magicLinkVerifyResponseSchema,
  oauthCallbackResponseSchema,
  oauthConnectionsResponseSchema,
  oauthEnabledProvidersResponseSchema,
  oauthInitiateResponseSchema,
  oauthLinkResponseSchema,
  oauthUnlinkResponseSchema,
  refreshResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  removePhoneResponseSchema,
  renamePasskeyRequestSchema,
  resendVerificationRequestSchema,
  resendVerificationResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  revertEmailChangeRequestSchema,
  revertEmailChangeResponseSchema,
  setPasswordRequestSchema,
  setPasswordResponseSchema,
  setPhoneRequestSchema,
  setPhoneResponseSchema,
  smsChallengeRequestSchema,
  smsVerifyRequestSchema,
  sudoRequestSchema,
  sudoResponseSchema,
  tosStatusResponseSchema,
  totpLoginChallengeResponseSchema,
  totpLoginVerifyRequestSchema,
  totpSetupResponseSchema,
  totpStatusResponseSchema,
  totpVerifyRequestSchema,
  totpVerifyResponseSchema,
  trustDeviceResponseSchema,
  verifyPhoneRequestSchema,
  verifyPhoneResponseSchema,
  webauthnLoginVerifyRequestSchema,
  webauthnOptionsResponseSchema,
  webauthnRegisterVerifyRequestSchema,
  webauthnRegisterVerifyResponseSchema,
} from './auth';
export type {
  AppRole,
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
  EmailOtpRequest,
  EmailOtpRequestResponse,
  EmailOtpVerifyRequest,
  EmailOtpVerifyResponse,
  OAuthConnection,
  OAuthProvider,
  PasskeyListItem,
  TenantRole,
  TotpSetupResponse,
  TotpStatusResponse,
} from './auth';

export {
  addPaymentMethodRequestSchema,
  adminPlanResponseSchema,
  adminPlansListResponseSchema,
  adminStripeStatusSchema,
  cancelSubscriptionRequestSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  createPlanRequestSchema,
  deletePlanRequestSchema,
  grantSubscriptionRequestSchema,
  grantSubscriptionResponseSchema,
  invoiceResponseSchema,
  invoicesListResponseSchema,
  paymentMethodResponseSchema,
  paymentMethodsListResponseSchema,
  plansListResponseSchema,
  setupIntentResponseSchema,
  stripeConnectionTestResultSchema,
  subscriptionActionResponseSchema,
  subscriptionResponseSchema,
  syncStripeResponseSchema,
  updatePlanRequestSchema,
  updateSubscriptionRequestSchema,
  updateSubscriptionResponseSchema,
} from './billing';
export type {
  BillingEventType,
  BillingProvider,
  BillingService,
  CardDetails,
  InvoiceStatus,
  PaymentMethodType,
  PlanFeature,
  PlanInterval,
  SubscriptionStatus,
} from './billing';

export {
  CONSENT_TYPES,
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_STATUSES,
  DATA_EXPORT_TYPES,
  DOCUMENT_TYPES,
  PUBLISHABLE_DOCUMENT_TYPES,
  createLegalDocumentSchema,
  legalDocumentSchema,
  requestDataExportBodySchema,
  updateConsentPreferencesRequestSchema,
} from './compliance';
export type {
  ConsentRecordType,
  ConsentType,
  DataExportFormat,
  DataExportStatus,
  DataExportType,
  DocumentType,
  PublishableDocumentType,
  RequestDataExportBody,
} from './compliance';

export {
  createFeatureFlagRequestSchema,
  featureFlagDeleteResponseSchema,
  featureFlagListResponseSchema,
  featureFlagResponseSchema,
  setTenantFeatureOverrideRequestSchema,
  tenantFeatureOverrideDeleteResponseSchema,
  tenantFeatureOverrideResponseSchema,
  tenantFeatureOverridesResponseSchema,
  updateFeatureFlagRequestSchema,
} from './feature-flags';

export {
  jobActionResponseSchema,
  jobDetailsSchema,
  jobListQuerySchema,
  jobListResponseSchema,
  queueStatsSchema,
} from './jobs';
export type {
  JobActionResponse,
  JobDetails,
  JobError,
  JobListQuery,
  JobListResponse,
  JobStatus,
  QueueStats,
} from './jobs';

export { uuidSchema } from './schemas';

export type { InvitationStatus } from './tenant';

export { applyUsageDelta, usageSummaryResponseSchema } from './usage-metering';
export type { AggregationType } from './usage-metering';

export {
  accountLifecycleResponseSchema,
  avatarDeleteResponseSchema,
  avatarUploadRequestSchema,
  avatarUploadResponseSchema,
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  deactivateAccountRequestSchema,
  deleteAccountRequestSchema,
  profileCompletenessResponseSchema,
  revokeAllSessionsResponseSchema,
  revokeSessionResponseSchema,
  sessionsListResponseSchema,
  updateProfileRequestSchema,
  updateUsernameRequestSchema,
  updateUsernameResponseSchema,
  userSchema,
} from './users';
export type {
  AvatarDeleteResponse,
  AvatarUploadResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  RevokeAllSessionsResponse,
  RevokeSessionResponse,
  Session,
  SessionsListResponse,
  UpdateProfileRequest,
  User,
  UserRole,
} from './users';
