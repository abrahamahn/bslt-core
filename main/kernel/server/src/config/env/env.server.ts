// main/kernel/server/src/config/env/env.server.ts
/**
 * Server Environment Configuration
 *
 * Server types, env interface, and validation schema.
 * Merged from config/types/infra.ts (server section) and config/env.ts.
 *
 * @module config/env.server
 */

import { defaulted, enumOf, number, object, optional, string } from '@bslt/schema';

import { httpUrlSchema, trueFalseSchema } from './env.base';

import type { Schema } from '@bslt/schema';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
interface LoggingConfig {
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

const logLevelSchema = enumOf(['debug', 'info', 'warn', 'error'] as const, 'LOG_LEVEL');
const clientErrorLevelSchema = enumOf(
  ['debug', 'info', 'warn', 'error'] as const,
  'LOG_CLIENT_ERROR_LEVEL',
);

export const ServerEnvSchema: Schema<ServerEnv> = object(
  {
    HOST: defaulted(string({ label: 'HOST' }), '0.0.0.0'),
    PORT: defaulted(number({ coerce: true, label: 'PORT' }), 8080),
    API_PORT: optional(number({ coerce: true, label: 'API_PORT' })),
    APP_PORT: optional(number({ coerce: true, label: 'APP_PORT' })),
    HEALTH_PORT: defaulted(number({ coerce: true, label: 'HEALTH_PORT' }), 8081),
    MAINTENANCE_MODE: optional(trueFalseSchema),
    RATE_LIMIT_WINDOW_MS: optional(number({ coerce: true, label: 'RATE_LIMIT_WINDOW_MS' })),
    RATE_LIMIT_MAX: optional(number({ coerce: true, label: 'RATE_LIMIT_MAX' })),
    PUBLIC_API_URL: optional(httpUrlSchema('PUBLIC_API_URL')),
    PUBLIC_APP_URL: optional(httpUrlSchema('PUBLIC_APP_URL')),
    APP_URL: optional(httpUrlSchema('APP_URL')),
    API_BASE_URL: optional(httpUrlSchema('API_BASE_URL')),
    CORS_ORIGIN: optional(string({ label: 'CORS_ORIGIN' })),
    CORS_ORIGINS: optional(string({ label: 'CORS_ORIGINS' })),
    IP_BLOCKLIST: optional(string({ label: 'IP_BLOCKLIST' })),
    IP_BLOCKLIST_STRICT: optional(string({ label: 'IP_BLOCKLIST_STRICT' })),
    IP_ALLOWLIST: optional(string({ label: 'IP_ALLOWLIST' })),
    BLOCKED_REGIONS: optional(string({ label: 'BLOCKED_REGIONS' })),
    GEO_COUNTRY_HEADER: optional(string({ label: 'GEO_COUNTRY_HEADER' })),
    GEO_REGION_HEADERS: optional(string({ label: 'GEO_REGION_HEADERS' })),
    LOG_LEVEL: defaulted(logLevelSchema, 'info'),
    AUDIT_RETENTION_DAYS: optional(number({ coerce: true, label: 'AUDIT_RETENTION_DAYS' })),
    LOG_CLIENT_ERROR_LEVEL: optional(clientErrorLevelSchema),
    LOG_REQUEST_CONTEXT: optional(trueFalseSchema),
    LOG_PRETTY_JSON: optional(trueFalseSchema),
  },
  { unknownKeys: 'strip' },
);
