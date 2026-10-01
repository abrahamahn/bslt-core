// main/server/system/src/config/infra/server.ts
import { CORS_CONFIG, RATE_LIMIT_DEFAULTS, SERVER_PORT_FALLBACKS } from '@bslt/shared/constants';
import {
  DEFAULT_BLOCKED_REGIONS,
  DEFAULT_GEO_COUNTRY_HEADER,
  DEFAULT_GEO_REGION_HEADERS,
} from '@bslt/shared/constants/core';
import { getList } from '@bslt/shared/helpers';

import type { FullEnv, LogLevel, ServerConfig } from '@bslt/shared/system/config';

/** Node lowercases inbound header names, so configured names must match that. */
function toHeaderNames(value: string | undefined, fallback: readonly string[]): string[] {
  const names = getList(value).map((name) => name.toLowerCase());
  return names.length > 0 ? names : [...fallback];
}

/**
 * Loads the core HTTP server configuration.
 * Handles ports, CORS, and basic infrastructure settings.
 */
/**
 * Load HTTP Server Configuration.
 *
 * Handles:
 * - **Port Resolution**: Checks `API_PORT` -> `PORT` -> Default (8080).
 * - **CORS**: Configures allowed origins for cross-domain requests.
 * - **Discovery**: Resolves public base URLs for the App (Frontend) and API.
 * - **Operational**: Sets trust proxy (for load balancers) and log levels.
 */
export function loadServerConfig(env: FullEnv): ServerConfig {
  const isProd = env.NODE_ENV === 'production';

  // Port resolution
  const port = env.API_PORT ?? env.PORT;
  const appPort = env.APP_PORT;

  // URL resolution (flexible naming support)
  const appBaseUrl =
    env.PUBLIC_APP_URL != null && env.PUBLIC_APP_URL !== ''
      ? env.PUBLIC_APP_URL
      : env.APP_URL != null && env.APP_URL !== ''
        ? env.APP_URL
        : `http://localhost:${String(appPort)}`;

  const apiBaseUrl =
    env.PUBLIC_API_URL !== undefined && env.PUBLIC_API_URL !== ''
      ? env.PUBLIC_API_URL
      : env.API_BASE_URL !== undefined && env.API_BASE_URL !== ''
        ? env.API_BASE_URL
        : `http://localhost:${String(port)}`;

  return {
    host: env.HOST !== '' ? env.HOST : '0.0.0.0',
    port,
    // Falling back to another port is a DEVELOPMENT affordance, and only there.
    //
    // In production the port is not a preference, it is a contract: the compose
    // port map, Caddy's `reverse_proxy api:8080`, nginx and the container
    // healthcheck all address 8080 by name. A server that quietly drifted to
    // 3000 because 8080 was taken would be up, logging "Server listening on
    // 0.0.0.0:3000", and unreachable by everything that matters. Binding the
    // wrong port is not a recovery; it is a slower, more confusing outage.
    //
    // An empty list makes `startHttpPhase` bind the configured port exactly and
    // fail loudly on EADDRINUSE. Locally, the fallback chain stays, because
    // there a busy 8080 usually means a stale `pnpm dev` and walking to 3000 is
    // genuinely what you want.
    portFallbacks: isProd ? [] : [...SERVER_PORT_FALLBACKS],

    cors: {
      // Support multiple origins (e.g., Web + Desktop + Admin)
      origin:
        env.CORS_ORIGINS !== undefined && env.CORS_ORIGINS !== ''
          ? getList(env.CORS_ORIGINS)
          : env.CORS_ORIGIN !== undefined && env.CORS_ORIGIN !== ''
            ? getList(env.CORS_ORIGIN)
            : [appBaseUrl],
      credentials: true,
      methods: [...CORS_CONFIG.ALLOWED_METHODS],
    },

    // Operational Settings
    trustProxy: env.TRUST_PROXY === 'true' || (env.TRUST_PROXY === undefined && isProd),
    logLevel: env.LOG_LEVEL as LogLevel,
    maintenanceMode: env.MAINTENANCE_MODE === 'true',

    // Identity/Discovery
    appBaseUrl,
    apiBaseUrl,

    // Audit retention (0 = unlimited)
    auditRetentionDays: env.AUDIT_RETENTION_DAYS ?? 90,

    // Global Rate Limiting (Infrastructure layer)
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS ?? RATE_LIMIT_DEFAULTS.GLOBAL_WINDOW_MS,
      max:
        env.RATE_LIMIT_MAX ??
        (isProd ? RATE_LIMIT_DEFAULTS.GLOBAL_MAX_PROD : RATE_LIMIT_DEFAULTS.GLOBAL_MAX_DEV),
    },

    // IP blocklist / allowlist (comma-separated IPs or CIDR ranges; empty = inert)
    ipBlocklist: {
      blocklist: getList(env.IP_BLOCKLIST),
      strictBlocklist: getList(env.IP_BLOCKLIST_STRICT),
      allowlist: getList(env.IP_ALLOWLIST),
    },

    // Jurisdiction gate. The shipped default list is EMPTY — a neutral starter
    // blocks nowhere; which jurisdictions a product may not serve is a legal
    // decision about that product. The gate stays inert until a deployment
    // sets BLOCKED_REGIONS.
    geo: {
      blockedRegions:
        env.BLOCKED_REGIONS === undefined
          ? [...DEFAULT_BLOCKED_REGIONS]
          : getList(env.BLOCKED_REGIONS),
      // An explicitly EMPTY country header is a deployment stating it has no geo
      // source at all; the null adapter is then used and the gate never fires.
      countryHeader: (env.GEO_COUNTRY_HEADER ?? DEFAULT_GEO_COUNTRY_HEADER).trim().toLowerCase(),
      regionHeaders: toHeaderNames(env.GEO_REGION_HEADERS, DEFAULT_GEO_REGION_HEADERS),
    },

    // Logging behavior
    logging: {
      clientErrorLevel: env.LOG_CLIENT_ERROR_LEVEL ?? 'warn',
      requestContext: env.LOG_REQUEST_CONTEXT !== 'false',
      prettyJson: env.LOG_PRETTY_JSON !== undefined ? env.LOG_PRETTY_JSON === 'true' : !isProd,
    },
  };
}
