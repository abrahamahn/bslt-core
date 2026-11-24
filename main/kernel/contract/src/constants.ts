// main/kernel/contract/src/constants.ts

export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const SECONDS_PER_DAY = 60 * 60 * 24;

export const AUTH_CONSTANTS = {
  BEARER_PREFIX: 'Bearer ',
  SUDO_TOKEN_HEADER: 'x-sudo-token',
  CSRF_TOKEN_HEADER: 'x-csrf-token',
  CSRF_COOKIE_NAME: '_csrf',
  ACCESS_TOKEN_COOKIE_NAME: 'accessToken',
  REFRESH_TOKEN_COOKIE_NAME: 'refreshToken',
  SESSION_COOKIE_NAME: 'sessionId',
  WEBSOCKET_PATH: '/ws',
  API_PREFIX: '/api',
  WS_CLOSE_POLICY_VIOLATION: 1008,
} as const;

export const ACCESS_TOKEN_COOKIE_NAME = AUTH_CONSTANTS.ACCESS_TOKEN_COOKIE_NAME;
export const API_PREFIX = AUTH_CONSTANTS.API_PREFIX;
export const CSRF_COOKIE_NAME = AUTH_CONSTANTS.CSRF_COOKIE_NAME;
export const REFRESH_TOKEN_COOKIE_NAME = AUTH_CONSTANTS.REFRESH_TOKEN_COOKIE_NAME;

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/refresh',
  '/api/auth/resend-verification',
]);

export const AUTH_STRATEGIES = ['local', 'magic', 'webauthn', 'google', 'github', 'apple'] as const;

export const AUTH_VALIDATION = {
  MIN_SECRET_LENGTH: 32,
  LOCKOUT_MIN_ATTEMPTS: 3,
  LOCKOUT_MAX_ATTEMPTS: 20,
  LOCKOUT_MIN_DURATION_MS: 60_000,
  REFRESH_TOKEN_MIN_DAYS: 1,
  REFRESH_TOKEN_MAX_DAYS: 30,
  PASSWORD_MIN_LENGTH: 8,
} as const;

export const S3_DEFAULTS = {
  PRESIGN_EXPIRES_SECONDS: 3600,
} as const;

const LOCALES = ['en-US'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE = 'en-US' satisfies Locale;
export const SUPPORTED_LOCALES = LOCALES;

export const LIMITS = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_UPLOAD_FILES: 10,
  MAX_IMAGE_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_LOGO_SIZE_BYTES: 2 * 1024 * 1024,
  HTTP_BODY_LIMIT_BYTES: 1024 * 1024,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MAX_SLUG_LENGTH: 100,
  MAX_TITLE_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 15,
  MAX_SANITIZE_DEPTH: 10,
} as const;

export const DEFAULT_PAGE_LIMIT = LIMITS.DEFAULT_PAGE_SIZE;
export const DEFAULT_SORT_ORDER = 'desc' as const;
export const DEFAULT_SORT_BY = 'createdAt';

export const PAGINATION_ERROR_TYPES = {
  INVALID_CURSOR: 'INVALID_CURSOR',
  CURSOR_SORT_MISMATCH: 'CURSOR_SORT_MISMATCH',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_PAGE: 'INVALID_PAGE',
  INVALID_SORT_FIELD: 'INVALID_SORT_FIELD',
  INVALID_SORT_ORDER: 'INVALID_SORT_ORDER',
} as const;
