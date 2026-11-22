// main/kernel/server/src/config/constants.ts
import type { SqlTableConfig } from '@bslt/db';

export const WEAK_SECRETS: ReadonlySet<string> = new Set([
  'secret',
  'password',
  'jwt_secret',
  'changeme',
  'test',
  'dev',
  'prod',
]);

export const REPEATING_SECRET_PATTERN = /^(.)\1{31,}$/;

export const ARGON2_DEFAULTS = {
  TYPE: 2,
  MEMORY_COST: 19456,
  TIME_COST: 2,
  PARALLELISM: 1,
} as const;

const DEFAULT_DATABASE_NAME = 'app_dev';

export const DB_DEFAULTS = {
  DEFAULT_DATABASE_NAME,
  POSTGRES_PORT: 5432,
  POSTGRES_PORT_FALLBACKS: [5432, 5433, 5434] as readonly number[],
  POSTGRES_MAX_CONNECTIONS_DEV: 10,
  POSTGRES_MAX_CONNECTIONS_PROD: 20,
  STATEMENT_TIMEOUT_MS: 30_000,
  WORKER_STATEMENT_TIMEOUT_MS: 120_000,
  LOCK_TIMEOUT_MS: 10_000,
  IDLE_IN_TRANSACTION_TIMEOUT_MS: 60_000,
} as const;

export const SMTP_DEFAULTS = {
  PORT: 587,
  CONNECTION_TIMEOUT_MS: 5000,
  SOCKET_TIMEOUT_MS: 30_000,
} as const;

export const CACHE_DEFAULTS = {
  TTL_MS: 300_000,
  MAX_SIZE: 1000,
} as const;

export const QUEUE_DEFAULTS = {
  POLL_INTERVAL_MS: 1000,
  CONCURRENCY: 5,
  MAX_ATTEMPTS: 3,
  BACKOFF_BASE_MS: 1000,
  MAX_BACKOFF_MS: 300_000,
} as const;

export const RATE_LIMIT_DEFAULTS = {
  GLOBAL_WINDOW_MS: 60_000,
  GLOBAL_MAX_PROD: 100,
  GLOBAL_MAX_DEV: 1000,
  LOGIN_MAX_PROD: 5,
  LOGIN_MAX_DEV: 100,
  REGISTER_MAX_PROD: 3,
  REGISTER_MAX_DEV: 100,
  FORGOT_PASSWORD_MAX_PROD: 3,
  FORGOT_PASSWORD_MAX_DEV: 100,
  VERIFY_EMAIL_MAX_PROD: 10,
  VERIFY_EMAIL_MAX_DEV: 100,
  PROGRESSIVE_BASE_DELAY_MS: 1000,
  PROGRESSIVE_MAX_DELAY_MS: 10_000,
  PROGRESSIVE_BACKOFF_FACTOR: 2,
} as const;

export const CONFIG_SEARCH_DEFAULTS = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 1000,
} as const;

export const SERVER_PORT_FALLBACKS = [8080, 3000, 5000, 8000] as const;

export const COURIER_DEFAULT_API_URL = 'https://api.courier.com';

export const CORS_CONFIG = {
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const,
  MAX_AGE: 86400,
} as const;

export const STANDARD_HEADERS = {
  REQUEST_ID: 'x-request-id',
  CORRELATION_ID: 'x-correlation-id',
  FORWARDED_FOR: 'x-forwarded-for',
  IDEMPOTENCY_KEY: 'x-idempotency-key',
} as const;

export const DEFAULT_BLOCKED_REGIONS: readonly string[] = [];
export const DEFAULT_GEO_COUNTRY_HEADER = 'cf-ipcountry';
export const DEFAULT_GEO_REGION_HEADERS = ['cf-region-code', 'x-geo-region', 'cf-region'] as const;
export const UNKNOWN_COUNTRY_CODES = ['XX', 'T1'] as const;
export const GEO_EXEMPT_PATH_PREFIXES = ['/health'] as const;

export const DEFAULT_SEARCH_SCHEMAS: Record<string, SqlTableConfig> = {
  users: {
    table: 'users',
    primaryKey: 'id',
    columns: [
      { field: 'id', column: 'id', type: 'string', filterable: true, sortable: true },
      { field: 'email', column: 'email', type: 'string', filterable: true, sortable: true },
      { field: 'username', column: 'username', type: 'string', filterable: true, sortable: true },
      {
        field: 'firstName',
        column: 'first_name',
        type: 'string',
        filterable: true,
        sortable: true,
      },
      { field: 'lastName', column: 'last_name', type: 'string', filterable: true, sortable: true },
      { field: 'role', column: 'role', type: 'string', filterable: true, sortable: true },
      {
        field: 'emailVerified',
        column: 'email_verified',
        type: 'boolean',
        filterable: true,
        sortable: true,
      },
      { field: 'createdAt', column: 'created_at', type: 'date', filterable: true, sortable: true },
      { field: 'updatedAt', column: 'updated_at', type: 'date', filterable: true, sortable: true },
    ],
  },
};

export const getInt = (val: string | undefined, fallback: number): number => {
  const parsed = parseInt(val ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const getBool = (val: string | undefined): boolean => val?.toLowerCase().trim() === 'true';

export const getList = (val: string | undefined): string[] =>
  val !== undefined && val !== ''
    ? val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

export const getRequired = (val: string | undefined, key: string): string => {
  if (val === undefined || val === '') {
    throw new Error(`Configuration Error: Missing required environment variable [${key}]`);
  }
  return val;
};
