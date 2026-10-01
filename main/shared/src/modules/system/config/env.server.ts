// main/shared/src/modules/system/config/env.server.ts
/**
 * Server Environment Configuration
 *
 * Server types, env interface, and validation schema.
 * Merged from config/types/infra.ts (server section) and config/env.ts.
 *
 * @module config/env.server
 */

import {
  coerceNumber,
  createEnumSchema,
  createSchema,
  parseObject,
  parseOptional,
  parseString,
  withDefault,
} from '../../../schema';

import { trueFalseSchema } from './env.base';

import type { Schema } from '../../../schema';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Rate limiting configuration for API protection.
 * Supports progressive delays to slow down rather than block attackers.
 */
export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests per window */
  max: number;
  /** Cleanup interval for rate limit storage */
  cleanupIntervalMs?: number;
  /** Trust proxy headers for client IP detection */
  trustProxy?: boolean;
  /** Progressive delay configuration */
  progressiveDelay?: {
    enabled: boolean;
    baseDelay: number;
    maxDelay: number;
    backoffFactor: number;
  };
}

/**
 * Logging behavior configuration.
 * Controls what context is included in log entries and severity thresholds.
 */
export interface LoggingConfig {
  clientErrorLevel: LogLevel;
  requestContext: boolean;
  prettyJson?: boolean;
}

/**
 * HTTP server configuration.
 * Controls binding, CORS, rate limiting, and operational settings.
 */
export interface ServerConfig {
  host: string;
  port: number;
  portFallbacks: number[];
  cors: {
    origin: string[];
    credentials: boolean;
    methods: string[];
  };
  trustProxy: boolean;
  logLevel: LogLevel;
  maintenanceMode: boolean;
  appBaseUrl: string;
  apiBaseUrl: string;
  auditRetentionDays: number;
  rateLimit: {
    windowMs: number;
    max: number;
  };
  /**
   * IP blocklist / allowlist (exact IPs or CIDR ranges). Empty lists mean the
   * blocklist middleware stays inert. `strictBlocklist` only applies to routes
   * that opt into the `strict` IP policy.
   */
  ipBlocklist: {
    blocklist: string[];
    strictBlocklist: string[];
    allowlist: string[];
  };
  /**
   * Jurisdiction gate. `blockedRegions` holds `COUNTRY` / `COUNTRY-REGION`
   * entries (`US-WA`); an empty list — the shipped default — keeps the gate
   * inert. The headers name where the CDN puts the location — WITHOUT a CDN
   * that supplies one, every request has an unknown location and the gate
   * never fires.
   */
  geo: {
    blockedRegions: string[];
    countryHeader: string;
    regionHeaders: string[];
  };
  logging: LoggingConfig;
}

// ============================================================================
// Env Interface
// ============================================================================

/** Server environment variables */
export interface ServerEnv {
  HOST: string;
  PORT: number;
  API_PORT?: number | undefined;
  APP_PORT?: number | undefined;
  HEALTH_PORT: number;
  MAINTENANCE_MODE?: 'true' | 'false' | undefined;
  RATE_LIMIT_WINDOW_MS?: number | undefined;
  RATE_LIMIT_MAX?: number | undefined;
  PUBLIC_API_URL?: string | undefined;
  PUBLIC_APP_URL?: string | undefined;
  APP_URL?: string | undefined;
  API_BASE_URL?: string | undefined;
  CORS_ORIGIN?: string | undefined;
  CORS_ORIGINS?: string | undefined;
  IP_BLOCKLIST?: string | undefined;
  IP_BLOCKLIST_STRICT?: string | undefined;
  IP_ALLOWLIST?: string | undefined;
  /**
   * Comma-separated jurisdictions the service is not offered in (`US-WA`).
   * Unset falls back to `DEFAULT_BLOCKED_REGIONS` (empty — the starter blocks
   * nowhere); geo blocking activates only when this is set.
   */
  BLOCKED_REGIONS?: string | undefined;
  GEO_COUNTRY_HEADER?: string | undefined;
  /** Comma-separated, in priority order — the first header present wins. */
  GEO_REGION_HEADERS?: string | undefined;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  AUDIT_RETENTION_DAYS?: number | undefined;
  LOG_CLIENT_ERROR_LEVEL?: 'debug' | 'info' | 'warn' | 'error' | undefined;
  LOG_REQUEST_CONTEXT?: 'true' | 'false' | undefined;
  LOG_PRETTY_JSON?: 'true' | 'false' | undefined;
}

// ============================================================================
// Env Schema
// ============================================================================

export const ServerEnvSchema: Schema<ServerEnv> = createSchema<ServerEnv>((data: unknown) => {
  const obj = parseObject(data, 'ServerEnv');
  return {
    HOST: parseString(withDefault(obj['HOST'], '0.0.0.0'), 'HOST'),
    PORT: coerceNumber(withDefault(obj['PORT'], 8080), 'PORT'),
    API_PORT: parseOptional(obj['API_PORT'], (v: unknown) => coerceNumber(v, 'API_PORT')),
    APP_PORT: parseOptional(obj['APP_PORT'], (v: unknown) => coerceNumber(v, 'APP_PORT')),
    HEALTH_PORT: coerceNumber(withDefault(obj['HEALTH_PORT'], 8081), 'HEALTH_PORT'),
    MAINTENANCE_MODE: parseOptional(obj['MAINTENANCE_MODE'], (v: unknown) =>
      trueFalseSchema.parse(v),
    ),
    RATE_LIMIT_WINDOW_MS: parseOptional(obj['RATE_LIMIT_WINDOW_MS'], (v: unknown) =>
      coerceNumber(v, 'RATE_LIMIT_WINDOW_MS'),
    ),
    RATE_LIMIT_MAX: parseOptional(obj['RATE_LIMIT_MAX'], (v: unknown) =>
      coerceNumber(v, 'RATE_LIMIT_MAX'),
    ),
    PUBLIC_API_URL: parseOptional(obj['PUBLIC_API_URL'], (v: unknown) =>
      parseString(v, 'PUBLIC_API_URL', { url: true }),
    ),
    PUBLIC_APP_URL: parseOptional(obj['PUBLIC_APP_URL'], (v: unknown) =>
      parseString(v, 'PUBLIC_APP_URL', { url: true }),
    ),
    APP_URL: parseOptional(obj['APP_URL'], (v: unknown) =>
      parseString(v, 'APP_URL', { url: true }),
    ),
    API_BASE_URL: parseOptional(obj['API_BASE_URL'], (v: unknown) =>
      parseString(v, 'API_BASE_URL', { url: true }),
    ),
    CORS_ORIGIN: parseOptional(obj['CORS_ORIGIN'], (v: unknown) => parseString(v, 'CORS_ORIGIN')),
    CORS_ORIGINS: parseOptional(obj['CORS_ORIGINS'], (v: unknown) =>
      parseString(v, 'CORS_ORIGINS'),
    ),
    IP_BLOCKLIST: parseOptional(obj['IP_BLOCKLIST'], (v: unknown) =>
      parseString(v, 'IP_BLOCKLIST'),
    ),
    IP_BLOCKLIST_STRICT: parseOptional(obj['IP_BLOCKLIST_STRICT'], (v: unknown) =>
      parseString(v, 'IP_BLOCKLIST_STRICT'),
    ),
    IP_ALLOWLIST: parseOptional(obj['IP_ALLOWLIST'], (v: unknown) =>
      parseString(v, 'IP_ALLOWLIST'),
    ),
    BLOCKED_REGIONS: parseOptional(obj['BLOCKED_REGIONS'], (v: unknown) =>
      parseString(v, 'BLOCKED_REGIONS'),
    ),
    GEO_COUNTRY_HEADER: parseOptional(obj['GEO_COUNTRY_HEADER'], (v: unknown) =>
      parseString(v, 'GEO_COUNTRY_HEADER'),
    ),
    GEO_REGION_HEADERS: parseOptional(obj['GEO_REGION_HEADERS'], (v: unknown) =>
      parseString(v, 'GEO_REGION_HEADERS'),
    ),
    LOG_LEVEL: createEnumSchema(['debug', 'info', 'warn', 'error'] as const, 'LOG_LEVEL').parse(
      withDefault(obj['LOG_LEVEL'], 'info'),
    ),
    AUDIT_RETENTION_DAYS: parseOptional(obj['AUDIT_RETENTION_DAYS'], (v: unknown) =>
      coerceNumber(v, 'AUDIT_RETENTION_DAYS'),
    ),
    LOG_CLIENT_ERROR_LEVEL: parseOptional(obj['LOG_CLIENT_ERROR_LEVEL'], (v: unknown) =>
      createEnumSchema(['debug', 'info', 'warn', 'error'] as const, 'LOG_CLIENT_ERROR_LEVEL').parse(
        v,
      ),
    ),
    LOG_REQUEST_CONTEXT: parseOptional(obj['LOG_REQUEST_CONTEXT'], (v: unknown) =>
      trueFalseSchema.parse(v),
    ),
    LOG_PRETTY_JSON: parseOptional(obj['LOG_PRETTY_JSON'], (v: unknown) =>
      trueFalseSchema.parse(v),
    ),
  };
});
