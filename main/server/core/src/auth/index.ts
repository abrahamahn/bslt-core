// main/server/core/src/auth/index.ts
/**
 * Auth Package
 *
 * Provides authentication and authorization functionality.
 * Extracted from the app layer for reuse across applications.
 * Canonical source lives in main/server/core/src/auth/.
 *
 * @module @bslt/auth
 */

export { createAuthEmailTemplates, type AuthEmailTemplateOptions } from './email-templates';

// Signup eligibility attestation (age of consent, jurisdiction, Terms).
// insertAttestedUser is the only path by which an auth flow may create a user row.
export {
  ELIGIBILITY_ATTESTATION_REQUIRED_CODE,
  EligibilityAttestationRequiredError,
  insertAttestedUser,
  type NewUserValues,
} from './attestation';

// Signup consent to the published agreements (ToS, Privacy Policy).
// insertConsentedUser wraps insertAttestedUser and records the consent rows —
// it is the chokepoint every account-creating auth flow funnels through.
export {
  findSignupAgreementDocuments,
  insertConsentedUser,
  SignupConsentRequiredError,
  type SignupConsent,
} from './consented-user';

// Routes (for auto-registration)
export { authRoutes } from './routes';

// Middleware factories (use these to create guards with your JWT secret)
export {
  assertUserActive,
  createAuthGuard,
  createRequireAuth,
  createRequireRole,
  extractTokenPayload,
  isAdmin,
} from './middleware';

// Handlers
export {
  handleAcceptTos,
  handleBackupCodesRegenerate,
  handleBackupCodesStatus,
  handleChangeEmail,
  handleConfirmEmailChange,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleRefresh,
  handleRegister,
  handleRemovePhone,
  handleResendVerification,
  handleResetPassword,
  handleSendSmsCode,
  handleSetPassword,
  handleSetPhone,
  handleSudoElevate,
  handleTosStatus,
  handleTotpDisable,
  handleTotpEnable,
  handleTotpLoginVerify,
  handleTotpSetup,
  handleTotpStatus,
  handleVerifyEmail,
  handleVerifyPhone,
  handleVerifySmsCode,
  SUDO_TOKEN_HEADER,
  SUDO_TOKEN_TTL_MINUTES,
  verifySudoToken,
} from './handlers';

// Magic Link
export {
  cleanupExpiredMagicLinkTokens,
  handleMagicLinkRequest,
  handleMagicLinkVerify,
  magicLinkRoutes,
  requestMagicLink,
  verifyMagicLink,
  type MagicLinkResult,
  type RequestMagicLinkResult,
} from './magic-link';

// Email OTP
export {
  emailOtpRoutes,
  handleEmailOtpRequest,
  handleEmailOtpVerify,
  requestEmailOtp,
  verifyEmailOtp,
  type EmailOtpResult,
  type RequestEmailOtpResult,
} from './otp';

// OAuth
export {
  createAppleProvider,
  createGitHubProvider,
  createGoogleProvider,
  createOAuthState,
  decodeOAuthState,
  encodeOAuthState,
  extractAppleUserFromIdToken,
  findUserByOAuthProvider,
  getAuthorizationUrl,
  getConnectedProviders,
  getProviderClient,
  handleGetConnections,
  handleOAuthCallback,
  handleOAuthCallbackRequest,
  handleOAuthInitiate,
  handleOAuthLink,
  handleOAuthUnlink,
  linkOAuthAccount,
  oauthRoutes,
  refreshExpiringOAuthTokens,
  unlinkOAuthAccount,
  type AppleProviderConfig,
  type OAuthAuthResult,
  type OAuthCallbackResult,
  type OAuthConnectionInfo,
  type OAuthProvider,
  type OAuthProviderClient,
  type OAuthRefreshResult,
  type OAuthState,
  type OAuthTokenResponse,
  type OAuthUserInfo,
} from './oauth';

// Types (auth module types)
export type {
  AppContext,
  AuthEmailOptions,
  AuthEmailService,
  AuthEmailTemplates,
  AuthLogger,
  AuthModuleDeps,
  EmailTemplateResult,
  ReplyWithCookies,
  RequestWithCookies,
} from './types';

export {
  createErrorMapperLogger,
  LOGIN_FAILURE_REASON,
  MAX_PROGRESSIVE_DELAY_MS,
  MIN_JWT_SECRET_LENGTH,
  PROGRESSIVE_DELAY_WINDOW_MS,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_BYTES,
  type LoginFailureReason,
} from './types';

// Re-export auth messages from shared (admin module imports these via ../auth)
export {
  AUTH_ERROR_MESSAGES as ERROR_MESSAGES,
  AUTH_SUCCESS_MESSAGES as SUCCESS_MESSAGES,
} from '@bslt/shared/constants';

// Service (business logic)
export {
  authenticateUser,
  logoutUser,
  refreshUserTokens,
  registerUser,
  type AuthResult,
  type RefreshResult,
  type RegisterResult,
  type TotpChallengeResult,
} from './service';
export { hasPassword, requestPasswordReset, resetPassword, setPassword } from './password/service';
export {
  createEmailVerificationToken,
  resendVerificationEmail,
  verifyEmail,
} from './verification/service';

// TOTP (2FA)
export {
  getBackupCodesStatus,
  disableTotp,
  enableTotp,
  getTotpStatus,
  regenerateBackupCodes,
  setupTotp,
  verifyTotpCode,
  verifyTotpForLogin,
  type BackupCodesRegenerateResult,
  type BackupCodesStatusResult,
  type TotpSetupResult,
  type TotpVerifyResult,
} from './totp';

// TOTP secret at rest — exported for the one-off backfill of legacy plaintext
// rows (`pnpm db:backfill-totp`), which must encrypt with the same key and the
// same scheme the server decrypts with.
export { decryptTotpSecret, encryptTotpSecret, isLegacyPlaintextSecret } from './totp-secret';

// SMS 2FA
export {
  checkSmsRateLimit,
  getSmsVerificationCode,
  sendSms2faCode,
  SMS_CODE_EXPIRY_MS,
  SMS_MAX_ATTEMPTS,
  SMS_RATE_LIMIT_DAILY,
  SMS_RATE_LIMIT_HOURLY,
  verifySms2faCode,
  type SetPhoneRequest,
  type SmsChallengeRequest,
  type SmsRateLimitResult,
  type SmsVerificationCode,
  type SmsVerifyRequest,
  type VerifyPhoneRequest,
} from './sms-2fa';

// WebAuthn
export {
  clearChallengeStore,
  getAuthenticationOptions,
  getRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
  webauthnRouteEntries,
  webauthnRoutes,
} from './webauthn';

// WebAuthn Handlers
export {
  handleDeletePasskey,
  handleListPasskeys,
  handleRenamePasskey,
  handleWebauthnLoginOptions,
  handleWebauthnLoginVerify,
  handleWebauthnRegisterOptions,
  handleWebauthnRegisterVerify,
} from './handlers';

// Email Change
export {
  confirmEmailChange,
  initiateEmailChange,
  type EmailChangeConfirmResult,
  type EmailChangeResult,
} from './email-change';

// ToS Gating
export {
  acceptTos,
  checkTosAcceptance,
  createRequireTosAcceptance,
  type TosAcceptanceStatus,
  type TosGatingOptions,
} from './tos-gating';

// Utils (for direct use if needed)
export {
  cleanupExpiredTokens,
  clearRefreshTokenCookie,
  createAccessToken,
  createAuthResponse,
  createRefreshToken,
  createRefreshTokenFamily,
  generateBase64UrlToken,
  generateSecureToken,
  generateUniqueUsername,
  getRefreshTokenExpiry,
  hashPassword,
  hashToken,
  initDummyHashPool,
  isDummyHashPoolInitialized,
  JwtError,
  needsRehash,
  resetDummyHashPool,
  revokeAllUserTokens,
  revokeTokenFamily,
  rotateRefreshToken,
  setRefreshTokenCookie,
  splitFullName,
  verifyPassword,
  verifyPasswordSafe,
  verifyToken,
  type AuthResponseData,
  type AuthUser,
  type TokenPayload,
} from './utils';

// Security (login tracking, lockout, audit)
export {
  applyProgressiveDelay,
  AUTH_RATE_LIMITS,
  authRateLimiters,
  clearLoginAttempts,
  createAuthRateLimitHook,
  getAccountLockoutStatus,
  getProgressiveDelay,
  isAccountLocked,
  logAccountLockedEvent,
  logAccountUnlockedEvent,
  logLoginAttempt,
  logMagicLinkFailedEvent,
  logMagicLinkRequestEvent,
  logMagicLinkVerifiedEvent,
  logOAuthLinkFailureEvent,
  logOAuthLinkSuccessEvent,
  logOAuthLoginFailureEvent,
  logOAuthLoginSuccessEvent,
  logOAuthUnlinkFailureEvent,
  logOAuthUnlinkSuccessEvent,
  logSecurityEvent,
  logTokenFamilyRevokedEvent,
  logTokenReuseEvent,
  sendEmailChangedAlert,
  sendNewLoginAlert,
  sendPasswordChangedAlert,
  sendTokenReuseAlert,
  unlockAccount,
} from './security';

export { isCaptchaRequired, verifyCaptchaToken, verifyTurnstileToken } from './security';

// Device fingerprinting
export {
  generateDeviceFingerprint,
  generateStableDeviceFingerprint,
  isKnownDevice,
  isTrustedDevice,
  recordDeviceAccess,
  logNewDeviceLogin,
} from './security';

export type {
  AuthEndpoint,
  AuthRateLimitConfig,
  CaptchaVerifyResult,
  LockoutConfig,
  LockoutStatus,
  LogSecurityEventParams,
  SecurityEventMetadata,
  SecurityEventSeverity,
  SecurityEventType,
  SendEmailChangedAlertParams,
  SendSecurityAlertParams,
  SendTokenReuseAlertParams,
} from './security';
