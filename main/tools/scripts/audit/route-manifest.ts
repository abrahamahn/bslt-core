// main/tools/scripts/audit/route-manifest.ts
/**
 * Route Manifest Exporter
 *
 * Imports the route registry and outputs a JSON manifest of all registered routes
 * across both legacy route maps and native installed server modules.
 *
 * Usage: pnpm bslt report route-manifest
 *
 * @module tools/audit/route-manifest
 */

import { createAuthGuard } from '@bslt/identity/server';
import { devOnlyServerModules, installedServerModules } from '@bslt/server/generated/modules';
import { clearRegistry, getRegisteredRoutes, registerRouteMap } from '@bslt/server-system/http';
import { createLogger } from '@bslt/server-system/logger';
import {
  buildPlatformContextRouteMap,
  createCapabilityResolver,
  registerServerModules,
} from '@bslt/server-system/module';
import { buildPlatformErrorsRouteMap } from '@bslt/server-system/observability';

import type { DbClient } from '@bslt/db';
import type { AuthGuardFactory, RouteMap, RouteRegistryEntry } from '@bslt/server-system/http';

/**
 * Route manifest entry (JSON-serializable subset of RouteRegistryEntry).
 */
export interface RouteManifestEntry {
  path: string;
  method: string;
  isPublic: boolean;
  module: string;
  hasSchema: boolean;
  deprecated?: boolean;
}

/**
 * Generate a route manifest from the global route registry.
 *
 * @param routes - Optional array of routes (defaults to global registry)
 * @returns Array of manifest entries sorted by path
 */
export function generateManifest(routes?: readonly RouteRegistryEntry[]): RouteManifestEntry[] {
  const entries = routes ?? getRegisteredRoutes();

  return entries
    .map((r) => ({
      path: r.path,
      method: r.method,
      isPublic: r.isPublic,
      module: r.module,
      hasSchema: r.hasSchema,
      ...(r.deprecated === true ? { deprecated: true } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

type MinimalFastifyRoute = {
  method?: string;
  url?: string;
};

/**
 * Build and register all route maps and native server modules into the
 * in-memory route registry without starting the real server.
 */
export function populateRegistryFromRouteMaps(): void {
  clearRegistry();

  // Minimal Fastify surface used by registerRouteMap().
  const app = {
    route: (_route: MinimalFastifyRoute) => undefined,
    addHook: (_name: string, _hook: unknown) => undefined,
  };

  const ctx = {
    config: {
      auth: {
        jwt: {
          secret: 'route-manifest-jwt-secret',
        },
      },
      billing: {
        enabled: true,
      },
    },
  };

  const routerOptions = {
    prefix: '/api',
    jwtSecret: ctx.config.auth.jwt.secret,
    authGuardFactory: createAuthGuard satisfies AuthGuardFactory,
  };

  const register = (module: string, routes: RouteMap): void => {
    registerRouteMap(app, ctx, routes, {
      ...routerOptions,
      module,
    });
  };

  register(
    'system',
    buildPlatformContextRouteMap({
      resolveCapabilities: createCapabilityResolver({ instances: [] }),
    }),
  );
  register('system', buildPlatformErrorsRouteMap());

  const neverOpenedDb = {
    transaction: () => Promise.reject(new Error('route-manifest does not execute handlers')),
  } as unknown as DbClient;

  registerServerModules(app, ctx, [...installedServerModules, ...devOnlyServerModules], {
    kernel: {
      db: {
        system: <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => neverOpenedDb.transaction(fn),
      },
      log: createLogger('error', { service: 'bslt-route-manifest', env: 'test' }),
      clock: { now: () => new Date(0) },
    },
    routerOptions,
    resolveDb: () => neverOpenedDb,
    validateResponses: true,
  });
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/** Prints the registered routes as a JSON manifest. */
export function run(): void {
  populateRegistryFromRouteMaps();
  const manifest = generateManifest();

  if (manifest.length === 0) {
    console.log('⚠️  No routes registered after route map registration.');
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
}
