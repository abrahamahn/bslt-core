// main/apps/server/src/http/route-modules.ts
/**
 * App Route Module Registry
 *
 * App-owned route composition helpers:
 * - composed core module registry
 * - realtime/system module registration
 */

import { realtimeRoutes } from '@bslt/realtime';

import { systemRoutes } from './system-routes';

import type { RouteMap } from '@bslt/server-system/http';

interface RouteModuleRegistration {
  module: string;
  routes: RouteMap;
  prefix?: string;
}

interface RouteModuleCompositionOptions {
  readonly includeRealtimeRoutes?: boolean | undefined;
}

export function createAppRouteModuleRegistrations(
  _enabledStrategies: readonly string[],
  options: RouteModuleCompositionOptions = {},
): Promise<ReadonlyArray<RouteModuleRegistration>> {
  const realtimeRouteModules: ReadonlyArray<RouteModuleRegistration> =
    options.includeRealtimeRoutes === true ? [{ module: 'realtime', routes: realtimeRoutes }] : [];

  return Promise.resolve([
    ...realtimeRouteModules,
    { module: 'system', routes: systemRoutes, prefix: '' },
  ]);
}
