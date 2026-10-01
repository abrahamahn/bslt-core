// main/shared/src/constants/system/platform.ts
/**
 * Platform constants — auth tokens/cookies/headers, API, server config.
 * Jobs → system/jobs.ts  |  Email/Webhooks → system/comms.ts  |  Logging → system/log.ts
 */

import {
  EMAIL_PROVIDERS as SYSTEM_EMAIL_PROVIDERS,
  EMAIL_STATUSES as SYSTEM_EMAIL_STATUSES,
  SUBSCRIBABLE_EVENT_TYPES as SYSTEM_SUBSCRIBABLE_EVENT_TYPES,
  TERMINAL_DELIVERY_STATUSES as SYSTEM_TERMINAL_DELIVERY_STATUSES,
  WEBHOOK_DELIVERY_STATUSES as SYSTEM_WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_EVENT_TYPES as SYSTEM_WEBHOOK_EVENT_TYPES,
} from './comms';
import { HTTP_STATUS as SYSTEM_HTTP_STATUS } from './http';
import {
  JOB_PRIORITIES as SYSTEM_JOB_PRIORITIES,
  JOB_PRIORITY_VALUES as SYSTEM_JOB_PRIORITY_VALUES,
  JOB_STATUS_CONFIG as SYSTEM_JOB_STATUS_CONFIG,
  JOB_STATUSES as SYSTEM_JOB_STATUSES,
  TERMINAL_STATUSES as SYSTEM_TERMINAL_STATUSES,
} from './jobs';
import {
  ANSI as SYSTEM_ANSI,
  CONSOLE_LOG_LEVELS as SYSTEM_CONSOLE_LOG_LEVELS,
  LOG_LEVELS as SYSTEM_LOG_LEVELS,
} from './log';

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
export const SUDO_TOKEN_HEADER = AUTH_CONSTANTS.SUDO_TOKEN_HEADER;
export const WEBSOCKET_PATH = AUTH_CONSTANTS.WEBSOCKET_PATH;
export const WS_CLOSE_POLICY_VIOLATION = AUTH_CONSTANTS.WS_CLOSE_POLICY_VIOLATION;

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/refresh',
  '/api/auth/resend-verification',
  // Provider webhooks authenticate via signature verification, not CSRF tokens.
  '/api/webhooks/stripe',
  '/api/webhooks/paypal',
]);

export const API_VERSIONS = ['v1', 'v2', 'v3'] as const;

export const STANDARD_HEADERS = {
  REQUEST_ID: 'x-request-id',
  CORRELATION_ID: 'x-correlation-id',
  FORWARDED_FOR: 'x-forwarded-for',
  IDEMPOTENCY_KEY: 'x-idempotency-key',
} as const;

export const CACHE_TTL = {
  MICRO: 5, // 5 seconds (Hot data)
  SHORT: 60, // 1 minute
  MEDIUM: 3600, // 1 hour
  LONG: 86400, // 1 day
  MAX: 2592000, // 30 days
} as const;

export const RATE_LIMIT_WINDOWS = {
  PUBLIC_API: 60 * 15, // 15 minutes
  LOGIN: 60 * 60, // 1 hour
  WEBHOOK: 1, // 1 second (bursts)
} as const;

export const CRYPTO = {
  DEFAULT_SALT_ROUNDS: 12,
  TOKEN_BYTES: 32,
  HASHING_ALGORITHM: 'argon2id',
} as const;

export const CORS_CONFIG = {
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,
  MAX_AGE: 86400, // 24 hours
} as const;

export const PLATFORM_TYPES = ['web', 'ios', 'android', 'desktop', 'api'] as const;
export const DEVICE_TYPES = ['mobile', 'tablet', 'desktop', 'unknown'] as const;
export const HEALTH_STATUS = ['healthy', 'degraded', 'unhealthy', 'maintenance'] as const;

export const HTTP_STATUS = SYSTEM_HTTP_STATUS;
export type HttpStatusCode = import('./http').HttpStatusCode;

export const EMAIL_PROVIDERS = SYSTEM_EMAIL_PROVIDERS;
export const EMAIL_STATUSES = SYSTEM_EMAIL_STATUSES;
export const WEBHOOK_DELIVERY_STATUSES = SYSTEM_WEBHOOK_DELIVERY_STATUSES;
export const TERMINAL_DELIVERY_STATUSES = SYSTEM_TERMINAL_DELIVERY_STATUSES;
export const WEBHOOK_EVENT_TYPES = SYSTEM_WEBHOOK_EVENT_TYPES;
export const SUBSCRIBABLE_EVENT_TYPES = SYSTEM_SUBSCRIBABLE_EVENT_TYPES;

export const JOB_PRIORITIES = SYSTEM_JOB_PRIORITIES;
export const JOB_PRIORITY_VALUES = SYSTEM_JOB_PRIORITY_VALUES;
export const JOB_STATUSES = SYSTEM_JOB_STATUSES;
export const TERMINAL_STATUSES = SYSTEM_TERMINAL_STATUSES;
export const JOB_STATUS_CONFIG = SYSTEM_JOB_STATUS_CONFIG;

export const LOG_LEVELS = SYSTEM_LOG_LEVELS;
export const CONSOLE_LOG_LEVELS = SYSTEM_CONSOLE_LOG_LEVELS;
export const ANSI = SYSTEM_ANSI;
