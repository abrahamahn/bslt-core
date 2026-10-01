// main/server/core/src/auth/security/index.ts
/**
 * Security Infrastructure
 *
 * Login tracking, account lockout, rate limiting, and security event logging.
 *
 * @module security
 */

// Types
export type { LockoutConfig, LockoutStatus } from './types';

// Lockout functions
export {
  applyProgressiveDelay,
  clearLoginAttempts,
  getAccountLockoutStatus,
  getProgressiveDelay,
  isAccountLocked,
  logLoginAttempt,
  unlockAccount,
} from './lockout';

// Auth rate limiting
export {
  AUTH_RATE_LIMITS,
  authRateLimiters,
  createAuthRateLimitHook,
  type AuthEndpoint,
  type AuthRateLimitConfig,
} from './rateLimitPresets';

// Security events (re-exported for convenience)
export {
  sendEmailChangedAlert,
  sendNewLoginAlert,
  sendPasswordChangedAlert,
  sendTokenReuseAlert,
  type SendEmailChangedAlertParams,
  type SendSecurityAlertParams,
  type SendTokenReuseAlertParams,
} from './events/alerts';
export { logSecurityEvent } from './events/core';
export {
  logMagicLinkFailedEvent,
  logMagicLinkRequestEvent,
  logMagicLinkVerifiedEvent,
} from './events/magic-link';
export {
  logEmailOtpFailedEvent,
  logEmailOtpRequestEvent,
  logEmailOtpVerifiedEvent,
} from './events/otp';
export {
  logOAuthLinkFailureEvent,
  logOAuthLinkSuccessEvent,
  logOAuthLoginFailureEvent,
  logOAuthLoginSuccessEvent,
  logOAuthUnlinkFailureEvent,
  logOAuthUnlinkSuccessEvent,
} from './events/oauth';
export {
  flagSuspiciousLogin,
  logAccountLockedEvent,
  logAccountUnlockedEvent,
  logNewDeviceLogin,
  logTokenFamilyRevokedEvent,
  logTokenReuseEvent,
} from './events/standard';
export type {
  LogSecurityEventParams,
  SecurityEventMetadata,
  SecurityEventSeverity,
  SecurityEventType,
} from './events/types';

// Password (validation, patterns, scoring, strength — all from shared)
export {
  calculateEntropy,
  calculateScore,
  COMMON_PASSWORDS,
  containsUserInput,
  DEFAULT_PASSWORD_CONFIG,
  estimateCrackTime,
  estimatePasswordStrength,
  generateFeedback,
  getCharsetSize,
  getStrengthLabel,
  hasKeyboardPattern,
  hasRepeatedChars,
  hasSequentialChars,
  isCommonPassword,
  KEYBOARD_PATTERNS,
  validatePassword,
  validatePasswordBasic,
  type PasswordConfig,
  type PasswordPenalties,
  type PasswordValidationResult,
  type StrengthResult,
} from '@bslt/shared/core/auth';

// CAPTCHA Verification
export {
  isCaptchaRequired,
  verifyCaptchaToken,
  verifyTurnstileToken,
  type CaptchaVerifyResult,
} from './captcha';

// Device Fingerprint
export {
  generateDeviceFingerprint,
  generateStableDeviceFingerprint,
  isKnownDevice,
  isTrustedDevice,
  recordDeviceAccess,
} from './device-fingerprint';
