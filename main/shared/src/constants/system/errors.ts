// main/shared/src/constants/system/errors.ts

import { HTTP_STATUS as SYSTEM_HTTP_STATUS } from './http';

/** Standardized HTTP status code constants. */
export const HTTP_STATUS = SYSTEM_HTTP_STATUS;

/** Machine-readable error codes for the entire platform. */
export const ERROR_CODES = {
  // generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNHANDLED_EXCEPTION: 'UNHANDLED_EXCEPTION',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RESOURCE_NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  REQUEST_SCHEMA_ERROR: 'REQUEST_SCHEMA_ERROR',

  // auth/account
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_REUSED: 'TOKEN_REUSED',

  // oauth
  OAUTH_ERROR: 'OAUTH_ERROR',
  OAUTH_STATE_MISMATCH: 'OAUTH_STATE_MISMATCH',

  // 2fa
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  TOTP_INVALID: 'TOTP_INVALID',

  // email
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
} as const;

/** Generic human-readable error messages. */
export const ERROR_MESSAGES = {
  DEFAULT: 'An unexpected error occurred',
  INTERNAL_ERROR: 'Internal server error',
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Conflict',
  VALIDATION_ERROR: 'Validation failed',
  RATE_LIMITED: 'Too many requests',
  EMAIL_SEND_FAILED: 'Failed to send email',
  INVALID_CREDENTIALS: 'Invalid email or password',
  WEAK_PASSWORD: 'Password is too weak',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  EMAIL_ALREADY_REGISTERED: 'Email already registered',
  EMAIL_NOT_VERIFIED: 'Please verify your email address',
  INVALID_TOKEN: 'Invalid or expired token',
  AUTHENTICATION_REQUIRED: 'Authentication required',
  USER_NOT_FOUND: 'User not found',
  NO_REFRESH_TOKEN: 'No refresh token provided',
  INVALID_OR_EXPIRED_TOKEN: 'Invalid or expired token',
} as const;

/** Client-facing HTTP error message overrides. */
export const HTTP_ERROR_MESSAGES = {
  AccountLocked:
    'Account temporarily locked due to too many failed attempts. Please try again later.',
  InvalidCredentials: 'Invalid email or password',
  EmailAlreadyRegistered: 'Email already registered',
  InvalidToken: 'Invalid or expired token',
  WeakPassword: 'Password is too weak',
  EmailSendFailed: 'Failed to send email. Please try again or use the resend option.',
  InternalError: 'Internal server error',
} as const;

/** Mapping of internal error class names. */
export const AUTH_ERROR_NAMES = {
  AccountLockedError: 'AccountLockedError',
  EmailNotVerifiedError: 'EmailNotVerifiedError',
  InvalidCredentialsError: 'InvalidCredentialsError',
  InvalidTokenError: 'InvalidTokenError',
  TokenReuseError: 'TokenReuseError',
  UserNotFoundError: 'UserNotFoundError',
  EmailAlreadyExistsError: 'EmailAlreadyExistsError',
  WeakPasswordError: 'WeakPasswordError',
  EmailSendError: 'EmailSendError',
} as const;

/** Detailed authentication error messages. */
export const AUTH_ERROR_MESSAGES = {
  INTERNAL_ERROR: 'Internal server error',
  NOT_FOUND: 'Resource not found',
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden - insufficient permissions',
  INVALID_CREDENTIALS: 'Invalid email or password',
  EMAIL_ALREADY_EXISTS: 'Email already registered',
  USER_NOT_FOUND: 'User not found',
  WEAK_PASSWORD: 'Password is too weak',
  ACCOUNT_LOCKED:
    'Account temporarily locked due to too many failed attempts. Please try again later.',
  INVALID_TOKEN: 'Invalid or expired token',
  INVALID_OR_EXPIRED_TOKEN: 'Invalid or expired token',
  NO_REFRESH_TOKEN: 'No refresh token provided',
  MISSING_AUTH_HEADER: 'Missing or invalid authorization header',
  FAILED_TOKEN_FAMILY: 'Failed to create refresh token family',
  FAILED_USER_CREATION: 'Failed to create user',
  OAUTH_STATE_MISMATCH: 'OAuth state mismatch - possible CSRF attack',
  OAUTH_CODE_MISSING: 'OAuth authorization code missing',
  OAUTH_PROVIDER_ERROR: 'OAuth provider returned an error',
  MAGIC_LINK_EXPIRED: 'Magic link has expired',
  MAGIC_LINK_INVALID: 'Invalid magic link',
  MAGIC_LINK_ALREADY_USED: 'Magic link has already been used',
  EMAIL_VERIFICATION_NOT_IMPLEMENTED: 'Email verification not implemented',
  EMAIL_SEND_FAILED: 'Failed to send email. Please try again or use the resend option.',
} as const;

/** Human-readable success messages for authentication flows. */
export const AUTH_SUCCESS_MESSAGES = {
  LOGGED_OUT: 'Logged out successfully',
  ACCOUNT_UNLOCKED: 'Account unlocked successfully',
  PASSWORD_RESET_SENT: 'Password reset email sent',
  VERIFICATION_EMAIL_SENT:
    'Verification email sent. Please check your inbox and click the confirmation link.',
  MAGIC_LINK_SENT: 'Magic link sent to your email',
  EMAIL_OTP_SENT: 'If an account exists for this email, a security code has been sent.',
} as const;
