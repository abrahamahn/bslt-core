// main/shared/src/modules/core/auth/index.ts
/**
 * Auth Module Barrel
 *
 * Central exports for authentication schemas, password validation,
 * error classes, roles, sessions, and policy.
 */

// --- Core auth schemas (login, register, password reset, sudo) ---
export {
  authResponseSchema,
  bffLoginResponseSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  isAuthenticatedRequest,
  loginRequestSchema,
  loginSuccessResponseSchema,
  logoutResponseSchema,
  refreshResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  setPasswordRequestSchema,
  setPasswordResponseSchema,
  sudoRequestSchema,
  sudoResponseSchema,
  type AuthResponse,
  type BffLoginResponse,
  type ForgotPasswordRequest,
  type ForgotPasswordResponse,
  type LoginRequest,
  type LoginSuccessResponse,
  type LogoutResponse,
  type RefreshResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
  type SetPasswordRequest,
  type SetPasswordResponse,
  type SudoRequest,
  type SudoResponse,
} from './auth.core.schemas';

// --- Device schemas ---
export {
  deviceItemSchema,
  deviceListResponseSchema,
  trustDeviceResponseSchema,
  type DeviceItem,
  type DeviceListResponse,
  type TrustDeviceResponse,
} from './auth.devices.schemas';

// --- Email schemas ---
export {
  changeEmailRequestSchema,
  changeEmailResponseSchema,
  confirmEmailChangeRequestSchema,
  confirmEmailChangeResponseSchema,
  emailVerificationRequestSchema,
  emailVerificationResponseSchema,
  resendVerificationRequestSchema,
  resendVerificationResponseSchema,
  revertEmailChangeRequestSchema,
  revertEmailChangeResponseSchema,
  type ChangeEmailRequest,
  type ChangeEmailResponse,
  type ConfirmEmailChangeRequest,
  type ConfirmEmailChangeResponse,
  type EmailVerificationRequest,
  type EmailVerificationResponse,
  type ResendVerificationRequest,
  type ResendVerificationResponse,
  type RevertEmailChangeRequest,
  type RevertEmailChangeResponse,
} from './auth.email.schemas';

// --- Auth helpers ---
export {
  getRefreshCookieOptions,
  isStrategyEnabled,
  type AuthStrategy,
} from './auth.helpers.logic';

// --- Magic link schemas ---
export {
  magicLinkRequestResponseSchema,
  magicLinkRequestSchema,
  magicLinkVerifyRequestSchema,
  magicLinkVerifyResponseSchema,
  type MagicLinkRequest,
  type MagicLinkRequestResponse,
  type MagicLinkVerifyRequest,
  type MagicLinkVerifyResponse,
} from './auth.magic.link.schemas';

// --- Email OTP schemas ---
export {
  completeOnboardingRequestSchema,
  completeOnboardingResponseSchema,
  EMAIL_OTP_CODE_LENGTH,
  emailOtpRequestResponseSchema,
  emailOtpRequestSchema,
  emailOtpVerifyRequestSchema,
  emailOtpVerifyResponseSchema,
  type CompleteOnboardingRequest,
  type CompleteOnboardingResponse,
  type EmailOtpRequest,
  type EmailOtpRequestResponse,
  type EmailOtpVerifyRequest,
  type EmailOtpVerifyResponse,
} from './auth.otp.schemas';

// --- MFA schemas ---
export {
  backupCodesRegenerateResponseSchema,
  backupCodesStatusResponseSchema,
  invalidateSessionsResponseSchema,
  removePhoneResponseSchema,
  setPhoneRequestSchema,
  setPhoneResponseSchema,
  smsChallengeRequestSchema,
  smsVerifyRequestSchema,
  totpLoginChallengeResponseSchema,
  totpLoginVerifyRequestSchema,
  totpSetupResponseSchema,
  totpStatusResponseSchema,
  totpVerifyRequestSchema,
  totpVerifyResponseSchema,
  verifyPhoneRequestSchema,
  verifyPhoneResponseSchema,
  type BackupCodesRegenerateResponse,
  type BackupCodesStatusResponse,
  type InvalidateSessionsResponse,
  type RemovePhoneResponse,
  type SetPhoneRequest,
  type SetPhoneResponse,
  type SmsChallengeRequest,
  type SmsChallengeResponse,
  type SmsLoginChallengeResponse,
  type SmsVerifyRequest,
  type TotpLoginChallengeResponse,
  type TotpLoginVerifyRequest,
  type TotpSetupResponse,
  type TotpStatusResponse,
  type TotpVerifyRequest,
  type TotpVerifyResponse,
  type VerifyPhoneRequest,
  type VerifyPhoneResponse,
} from './auth.mfa.schemas';

// --- OAuth schemas ---
export {
  oauthCallbackQuerySchema,
  oauthCallbackResponseSchema,
  oauthConnectionSchema,
  oauthConnectionsResponseSchema,
  oauthEnabledProvidersResponseSchema,
  oauthInitiateQuerySchema,
  oauthInitiateResponseSchema,
  oauthLinkCallbackResponseSchema,
  oauthLinkResponseSchema,
  oauthProviderSchema,
  oauthUnlinkResponseSchema,
  type OAuthCallbackQuery,
  type OAuthCallbackResponse,
  type OAuthConnection,
  type OAuthConnectionsResponse,
  type OAuthEnabledProvidersResponse,
  type OAuthInitiateQuery,
  type OAuthInitiateResponse,
  type OAuthLinkCallbackResponse,
  type OAuthLinkResponse,
  type OAuthProvider,
  type OAuthUnlinkResponse,
} from './auth.oauth.schemas';

// --- Passkey schemas ---
export {
  passkeyListResponseSchema,
  renamePasskeyRequestSchema,
  type PasskeyListItem,
  type RenamePasskeyRequest,
} from './auth.passkey.schemas';

// --- ToS schemas ---
export {
  acceptTosRequestSchema,
  acceptTosResponseSchema,
  tosStatusResponseSchema,
  type AcceptTosRequest,
  type AcceptTosResponse,
  type TosStatusResponse,
} from './auth.tos.schemas';

// --- WebAuthn schemas ---
export {
  webauthnLoginOptionsRequestSchema,
  webauthnLoginVerifyRequestSchema,
  webauthnOptionsResponseSchema,
  webauthnRegisterVerifyRequestSchema,
  webauthnRegisterVerifyResponseSchema,
  type WebauthnLoginOptionsRequest,
  type WebauthnLoginVerifyRequest,
  type WebauthnOptionsResponse,
  type WebauthnRegisterVerifyRequest,
  type WebauthnRegisterVerifyResponse,
} from './auth.webauth.schemas';

// --- Password validation ---
export {
  DEFAULT_PASSWORD_CONFIG,
  COMMON_PASSWORDS,
  getStrengthLabel,
  validatePassword,
  validatePasswordBasic,
  estimatePasswordStrength,
  calculateEntropy,
  calculateScore,
  estimateCrackTime,
  generateFeedback,
  getCharsetSize,
  KEYBOARD_PATTERNS,
  containsUserInput,
  hasKeyboardPattern,
  hasRepeatedChars,
  hasSequentialChars,
  isCommonPassword,
  type PasswordConfig,
  type PasswordValidationResult,
  type StrengthResult,
  type PasswordPenalties,
} from './passwords';

// --- Sessions ---
export { getSessionAge, isSessionActive, isSessionRevoked } from './auth.sessions.logic';
export {
  DEFAULT_SESSION_DAYS,
  MAX_IDLE_MS,
  REMEMBERED_SESSION_DAYS,
  sessionIdleWindowMs,
  sessionSpanDays,
  sessionSpanDaysOf,
} from './auth.session.logic';

export {
  createUserSessionSchema,
  updateUserSessionSchema,
  userSessionSchema,
  type CreateUserSession,
  type UpdateUserSession,
  type UserSession,
} from './auth.sessions.schemas';

// --- Roles ---
export {
  appRoleSchema,
  permissionSchema,
  tenantRoleSchema,
  type AppRole,
  type Permission,
  type TenantRole,
} from './roles';

// --- Policy ---
export {
  can,
  hasPermission,
  type AuthContext,
  type PolicyAction,
  type PolicyResource,
} from './auth.policy';
