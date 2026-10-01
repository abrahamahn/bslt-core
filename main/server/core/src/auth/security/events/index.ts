// main/server/core/src/auth/security/events/index.ts

export {
  sendEmailChangedAlert,
  sendNewLoginAlert,
  sendPasswordChangedAlert,
  sendTokenReuseAlert,
  type SendEmailChangedAlertParams,
  type SendSecurityAlertParams,
  type SendTokenReuseAlertParams,
} from './alerts';
export { logSecurityEvent } from './core';
export {
  logMagicLinkFailedEvent,
  logMagicLinkRequestEvent,
  logMagicLinkVerifiedEvent,
} from './magic-link';
export { logEmailOtpFailedEvent, logEmailOtpRequestEvent, logEmailOtpVerifiedEvent } from './otp';
export {
  logOAuthLinkFailureEvent,
  logOAuthLinkSuccessEvent,
  logOAuthLoginFailureEvent,
  logOAuthLoginSuccessEvent,
  logOAuthUnlinkFailureEvent,
  logOAuthUnlinkSuccessEvent,
} from './oauth';
export {
  flagSuspiciousLogin,
  logAccountLockedEvent,
  logAccountUnlockedEvent,
  logNewDeviceLogin,
  logTokenFamilyRevokedEvent,
  logTokenReuseEvent,
} from './standard';
export type {
  LogSecurityEventParams,
  SecurityEventMetadata,
  SecurityEventSeverity,
  SecurityEventType,
} from './types';
