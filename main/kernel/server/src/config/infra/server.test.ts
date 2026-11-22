// main/kernel/server/src/config/infra/server.test.ts
import { describe, expect, test } from 'vitest';

import { loadServerConfig } from './server';

import type { FullEnv } from '../env/env.validation';

/**
 * Creates a base environment with server-related defaults (as applied by Zod schema).
 * Used to simulate properly parsed FullEnv in tests.
 */
function createBaseEnv(overrides: Partial<FullEnv> = {}): FullEnv {
  return {
    HOST: '0.0.0.0',
    PORT: 8080,
    APP_PORT: 5173,
    LOG_LEVEL: 'info',
    ...overrides,
  } as unknown as FullEnv;
}

describe('Server Configuration', () => {
  describe('loadServerConfig', () => {
    test('should load default values when no env vars set', () => {
      const config = loadServerConfig(createBaseEnv());

      expect(config.host).toBe('0.0.0.0');
      expect(config.port).toBe(8080);
      expect(config.cors.origin).toEqual(['http://localhost:5173']);
      expect(config.cors.credentials).toBe(true);
    });

    test('should resolve Discovery URLs with correct priority', () => {
      // App URL
      const appUrlConfig = loadServerConfig(
        createBaseEnv({
          PUBLIC_APP_URL: 'https://public.app',
          APP_URL: 'https://internal.app',
        }),
      );
      expect(appUrlConfig.appBaseUrl).toBe('https://public.app');

      // API URL
      const apiUrlConfig = loadServerConfig(
        createBaseEnv({
          PUBLIC_API_URL: 'https://public.api',
          VITE_API_URL: 'https://vite.api',
        }),
      );
      expect(apiUrlConfig.apiBaseUrl).toBe('https://public.api');

      const apiUrlConfigFallback = loadServerConfig(
        createBaseEnv({
          API_BASE_URL: 'https://base.api',
        }),
      );
      expect(apiUrlConfigFallback.apiBaseUrl).toBe('https://base.api');
    });

    test('should prefer API_PORT over PORT', () => {
      const config = loadServerConfig(
        createBaseEnv({
          API_PORT: 3000,
          PORT: 4000,
        }),
      );

      expect(config.port).toBe(3000);
    });

    test('should include strategic port fallbacks', () => {
      const config = loadServerConfig(createBaseEnv());
      expect(config.portFallbacks).toEqual([8080, 3000, 5000, 8000]);
    });

    test('should offer NO port fallbacks in production', () => {
      // The port is a contract in production: the compose port map, Caddy's
      // `reverse_proxy api:8080`, nginx and the container healthcheck all
      // address it by number. Drifting to 3000 because 8080 was taken leaves the
      // server up and unreachable — a slower, more confusing outage than a
      // crash. An empty list makes startHttpPhase bind exactly, or fail saying
      // so.
      const prod = loadServerConfig(createBaseEnv({ NODE_ENV: 'production' }));
      expect(prod.portFallbacks).toEqual([]);
    });

    test('should handle production-specific defaults', () => {
      const prod = loadServerConfig(createBaseEnv({ NODE_ENV: 'production' }));

      expect(prod.trustProxy).toBe(true);
      expect(prod.rateLimit.max).toBe(100);
      expect(prod.logging.prettyJson).toBe(false);
    });

    test('should default pretty JSON logs to enabled in non-production', () => {
      const dev = loadServerConfig(createBaseEnv({ NODE_ENV: 'development' }));
      expect(dev.logging.prettyJson).toBe(true);
    });

    test('should honor LOG_PRETTY_JSON override', () => {
      const forcedOff = loadServerConfig(
        createBaseEnv({ NODE_ENV: 'development', LOG_PRETTY_JSON: 'false' }),
      );
      const forcedOn = loadServerConfig(
        createBaseEnv({ NODE_ENV: 'production', LOG_PRETTY_JSON: 'true' }),
      );

      expect(forcedOff.logging.prettyJson).toBe(false);
      expect(forcedOn.logging.prettyJson).toBe(true);
    });

    test('should parse CORS origins from both singular and plural env vars', () => {
      const configOrigin = loadServerConfig(
        createBaseEnv({
          CORS_ORIGIN: 'https://app.com, https://admin.com',
        }),
      );
      expect(configOrigin.cors.origin).toEqual(['https://app.com', 'https://admin.com']);

      const configOrigins = loadServerConfig(
        createBaseEnv({
          CORS_ORIGINS: 'https://web.com, https://mobile.com',
        }),
      );
      expect(configOrigins.cors.origin).toEqual(['https://web.com', 'https://mobile.com']);
    });

    test('should handle maintenance mode toggle', () => {
      const normal = loadServerConfig(createBaseEnv());
      const maintenance = loadServerConfig(createBaseEnv({ MAINTENANCE_MODE: 'true' }));

      expect(normal.maintenanceMode).toBe(false);
      expect(maintenance.maintenanceMode).toBe(true);
    });

    test('should default audit retention to 90 days', () => {
      const config = loadServerConfig(createBaseEnv());
      expect(config.auditRetentionDays).toBe(90);
    });

    test('should use custom audit retention when set', () => {
      const config = loadServerConfig(createBaseEnv({ AUDIT_RETENTION_DAYS: 30 }));
      expect(config.auditRetentionDays).toBe(30);
    });

    test('should allow 0 for unlimited audit retention', () => {
      const config = loadServerConfig(createBaseEnv({ AUDIT_RETENTION_DAYS: 0 }));
      expect(config.auditRetentionDays).toBe(0);
    });

    test('should default IP blocklist/allowlist to empty lists (inert)', () => {
      const config = loadServerConfig(createBaseEnv());
      expect(config.ipBlocklist).toEqual({ blocklist: [], strictBlocklist: [], allowlist: [] });
    });

    test('should parse comma-separated IP blocklist/allowlist with trimming', () => {
      const config = loadServerConfig(
        createBaseEnv({
          IP_BLOCKLIST: '1.2.3.4, 10.0.0.0/8',
          IP_BLOCKLIST_STRICT: '5.6.7.8',
          IP_ALLOWLIST: '127.0.0.1',
        }),
      );
      expect(config.ipBlocklist.blocklist).toEqual(['1.2.3.4', '10.0.0.0/8']);
      expect(config.ipBlocklist.strictBlocklist).toEqual(['5.6.7.8']);
      expect(config.ipBlocklist.allowlist).toEqual(['127.0.0.1']);
    });

    test('should default the geo gate to inert with the Cloudflare headers', () => {
      const config = loadServerConfig(createBaseEnv());

      // A neutral starter blocks nowhere until a deployment decides otherwise.
      expect(config.geo.blockedRegions).toEqual([]);
      expect(config.geo.countryHeader).toBe('cf-ipcountry');
      expect(config.geo.regionHeaders).toEqual(['cf-region-code', 'x-geo-region', 'cf-region']);
    });

    test('should parse comma-separated BLOCKED_REGIONS with trimming', () => {
      const config = loadServerConfig(createBaseEnv({ BLOCKED_REGIONS: 'US-WA, ca-on' }));
      expect(config.geo.blockedRegions).toEqual(['US-WA', 'ca-on']);
    });

    test('should honour a set-but-empty BLOCKED_REGIONS as blocking nothing', () => {
      const config = loadServerConfig(createBaseEnv({ BLOCKED_REGIONS: '' }));
      expect(config.geo.blockedRegions).toEqual([]);
    });

    test('should lowercase configured geo header names to match Node', () => {
      const config = loadServerConfig(
        createBaseEnv({
          GEO_COUNTRY_HEADER: 'CF-IPCountry',
          GEO_REGION_HEADERS: 'CF-Region-Code, X-Geo-Region',
        }),
      );
      expect(config.geo.countryHeader).toBe('cf-ipcountry');
      expect(config.geo.regionHeaders).toEqual(['cf-region-code', 'x-geo-region']);
    });

    test('should keep an explicitly empty GEO_COUNTRY_HEADER — a declared "no geo source"', () => {
      const config = loadServerConfig(createBaseEnv({ GEO_COUNTRY_HEADER: '  ' }));
      expect(config.geo.countryHeader).toBe('');
    });
  });
});
