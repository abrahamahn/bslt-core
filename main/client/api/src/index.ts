// main/client/api/src/index.ts
// Lightweight API client wrappers for bslt

// Shared types
export type {
  AuthResponse,
  BackupCodesRegenerateResponse,
  BackupCodesStatusResponse,
  BffLoginResponse,
  ChangeEmailRequest,
  ChangeEmailResponse,
  CompleteOnboardingRequest,
  CompleteOnboardingResponse,
  ConfirmEmailChangeRequest,
  ConfirmEmailChangeResponse,
  EmailOtpRequest,
  EmailOtpRequestResponse,
  EmailOtpVerifyRequest,
  EmailOtpVerifyResponse,
  EmailVerificationRequest,
  EmailVerificationResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginSuccessResponse,
  MagicLinkRequest,
  MagicLinkRequestResponse,
  MagicLinkVerifyRequest,
  MagicLinkVerifyResponse,
  OAuthConnectionsResponse,
  OAuthEnabledProvidersResponse,
  OAuthProvider,
  OAuthUnlinkResponse,
  PasskeyListItem,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  SmsLoginChallengeResponse,
  TotpLoginChallengeResponse,
  TotpLoginVerifyRequest,
  TotpSetupResponse,
  TotpStatusResponse,
  TotpVerifyRequest,
  TotpVerifyResponse,
  VerifyPhoneResponse,
} from '@bslt/shared/core/auth';
export type { User } from '@bslt/shared/core/users';

// API Client
export { createFeatureClient } from './api/features';
export { createApiClient, clearApiClient, getApiClient } from './api';
export type { ApiClient, ApiClientConfig, TosRequiredPayload, ApiClientOptions } from './api';

// Errors
export {
  ApiError,
  createApiError,
  getErrorMessage,
  isApiError,
  isAuthenticationError,
  isNetworkError,
  isTimeoutError,
  NetworkError,
  TimeoutError,
} from './errors';
export type { ApiErrorBody } from './errors';

// Utils
export {
  API_PREFIX,
  createCsrfRequestClient,
  getCsrfToken,
  setDefaultOnUnauthorized,
  trimTrailingSlashes,
} from './utils';
export type { BaseClientConfig } from './utils';

// Notifications
export {
  createNotificationClient,
  getDeviceId,
  getExistingSubscription,
  getPushPermission,
  isPushSupported,
  requestPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
} from './notifications';
export type {
  DeleteNotificationResponse,
  MarkReadResponse,
  NotificationClient,
  NotificationClientConfig,
  NotificationsListResponse,
} from './notifications';

// Devices
export { createDeviceClient } from './devices';
export type { DeviceClient, DeviceClientConfig, DeviceItem } from './devices';

// Phone/SMS
export { createPhoneClient } from './phone';
export type { PhoneClient, PhoneClientConfig } from './phone';

// API Keys
export { createApiKeysClient } from './api-keys';
export type { ApiKeysClient, ApiKeysClientConfig } from './api-keys';

// Settings
export { createSettingsClient } from './settings';
export type { SettingsClient, SettingsClientConfig } from './settings';

// Legal
export { createLegalClient } from './legal';
export type {
  CurrentLegalResponse,
  LegalClient,
  LegalClientConfig,
  LegalDocumentItem,
  PublishLegalDocumentRequest,
  PublishLegalDocumentResponse,
  UserAgreementItem,
  UserAgreementsResponse,
} from './legal';

// Generated API Client (from route definitions)
export { createGeneratedApiClient, generatedRouteDefinitions } from './generated';
export type {
  GeneratedApiClientConfig,
  GeneratedApiMethod,
  GeneratedApiPath,
  GeneratedApiRequest,
  GeneratedRouteDefinition,
  GeneratedRouteModule,
  MethodsForPath,
} from './generated';
