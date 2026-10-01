// main/apps/server/src/http/system-routes.ts
/**
 * System Routes
 *
 * Health and readiness probes for infrastructure verification.
 * These routes are intentionally unprefixed (no /api).
 */

import {
  createRouteMap,
  createScopedRouteHelpers,
  type HandlerContext,
  type RouteMap,
} from '@bslt/server-system/http';
import { formatPrometheusMetrics, getMetricsCollector } from '@bslt/server-system/observability';
import { checkDbStatus, getDetailedHealth, type HealthContext } from '@bslt/server-system/runtime';
import { HTTP_STATUS } from '@bslt/shared/constants';

import { isServerCapabilityEnabled } from '../bootstrap/generated/profile.generated';
import { importOptionalCapability } from '../bootstrap/optional-import';
import { createGeoProvider } from '../middleware/geo';

import type { GeoHeaders } from '@bslt/shared/core/geo';
import type { LiveResponse, ReadyResponse } from '@bslt/shared/system';
import type { WebSocketStats } from '@bslt/shared/system/runtime';

const { publicRoute: systemPublicRoute, protectedRoute: systemProtectedRoute } =
  createScopedRouteHelpers<HealthContext>((ctx: HandlerContext) => ctx as HealthContext);

/**
 * The jurisdiction gate's inputs for one request, resolved through the SAME
 * provider construction the gate itself uses (`config.server.geo` →
 * `createGeoProvider`). The gate can only see what the CDN sends, and a region
 * header typically arrives only while the CDN's visitor-location transform is
 * enabled — without it a subdivision-level block is inert by design, since an
 * unknown region is never blocked. Reveals only the caller's own location as
 * the CDN reported it.
 */
function geoProbe(
  ctx: HealthContext,
  headers: GeoHeaders,
): {
  summary: { provider: string; regionHeaderPresent: boolean; resolved: unknown };
  detail: Record<string, unknown>;
} {
  // Read defensively, and say so in the type. This probe is ADDITIVE to
  // /health, which is the liveness check — it must never be the reason /health
  // fails. `AppConfig` types `server.geo` as always present, but a context can
  // be assembled without it (a partially-built one, or a test double), so the
  // read is widened here to match what actually arrives at runtime rather than
  // what the type promises.
  const partial = ctx.config as {
    server?: { geo?: { countryHeader?: string; regionHeaders?: string[] } };
  };
  const geo = partial.server?.geo;
  const countryHeader = geo?.countryHeader ?? '';
  const regionHeaders = geo?.regionHeaders ?? [];
  const provider = createGeoProvider({ countryHeader, regionHeaders });

  const first = (name: string): string | null => {
    const raw = headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ?? null;
  };
  const received = Object.fromEntries(
    [countryHeader, ...regionHeaders].map((name) => [name, first(name)]),
  );
  const regionHeaderPresent = regionHeaders.some((name) => first(name) !== null);
  const resolved = provider.resolve(headers);

  return {
    summary: { provider: provider.name, regionHeaderPresent, resolved },
    detail: {
      provider: provider.name,
      received,
      resolved,
      verdict: regionHeaderPresent
        ? 'region header arrives — the jurisdiction gate can see subdivisions'
        : 'NO region header — if this request came through the CDN, enable the ' +
          'visitor-location transform or the region gate is inert',
    },
  };
}

async function getEnabledWebSocketStats(): Promise<WebSocketStats | undefined> {
  if (!isServerCapabilityEnabled('realtime')) return undefined;

  const mod = await importOptionalCapability('@bslt/realtime', 'realtime');
  const getWebSocketStats = mod['getWebSocketStats'];
  if (typeof getWebSocketStats !== 'function') {
    throw new Error('Optional realtime module is missing getWebSocketStats export');
  }
  return (getWebSocketStats as () => WebSocketStats)();
}

export const systemRoutes: RouteMap = createRouteMap([
  [
    'health',
    systemPublicRoute('GET', async (ctx, _body, req, reply) => {
      const dbStatus = await checkDbStatus(ctx);
      if (dbStatus.status !== 'up') {
        reply.code(HTTP_STATUS.SERVICE_UNAVAILABLE);
      }
      return {
        status: dbStatus.status === 'up' ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        database: dbStatus,
        // Additive: the jurisdiction gate's inputs, summarized. `/health` is
        // the one system path an edge reliably forwards to this API, so the
        // "does the CDN send a region header?" verdict has to ride here to be
        // readable from outside — `/health/geo` carries the full detail but is
        // publicly reachable only where the edge forwards `/health/*`.
        geo: geoProbe(ctx, req.headers as GeoHeaders).summary,
      };
    }),
  ],
  [
    // The jurisdiction gate's inputs, proven end to end. The gate can only see
    // what the CDN sends, and a region header typically arrives only while the
    // CDN's visitor-location transform is enabled — without it a
    // subdivision-level block is inert by design, since an unknown region is
    // never blocked. This echoes the geo headers of THIS request plus the same
    // resolution the gate performs, so "is the transform on?" is one curl
    // instead of trust in a dashboard.
    //
    // Public like the sibling probes on purpose: it reveals only the caller's
    // own location as the CDN reported it (which the caller already knows) and
    // the configured header names (which the published docs already imply).
    'health/geo',
    systemPublicRoute('GET', (ctx, _body, req) => geoProbe(ctx, req.headers as GeoHeaders).detail),
  ],
  [
    'metrics',
    systemPublicRoute('GET', () => {
      return getMetricsCollector().getMetricsSummary();
    }),
  ],
  [
    'metrics/prometheus',
    systemPublicRoute('GET', (_ctx, _body, _req, reply) => {
      reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return formatPrometheusMetrics(getMetricsCollector().getMetricsSummary());
    }),
  ],
  [
    'health/ready',
    systemPublicRoute('GET', async (ctx, _body, _req, reply): Promise<ReadyResponse> => {
      const dbStatus = await checkDbStatus(ctx);
      const ready = dbStatus.status === 'up';
      if (!ready) {
        reply.code(HTTP_STATUS.SERVICE_UNAVAILABLE);
      }
      return {
        status: ready ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
      };
    }),
  ],
  [
    'health/live',
    systemPublicRoute('GET', (): LiveResponse => {
      return {
        status: 'alive',
        uptime: process.uptime(),
      };
    }),
  ],
  [
    // Admin-only: exposes provider names and per-service internals that the
    // public /health probe deliberately omits.
    'health/detailed',
    systemProtectedRoute(
      'GET',
      async (ctx, _body, _req, reply) => {
        const websocketStats = await getEnabledWebSocketStats();
        const detailed = await getDetailedHealth(
          ctx,
          websocketStats !== undefined ? { websocketStats } : undefined,
        );
        if (detailed.status !== 'healthy') {
          reply.code(HTTP_STATUS.SERVICE_UNAVAILABLE);
        }
        return detailed;
      },
      'admin',
    ),
  ],
]);
