// Core edition route composition. Guards remain in the shared app router.
import { coreRouteModuleRegistrations } from '@bslt/core/route-modules';
import { createComposedAuthRoutes, createComposedUserRoutes } from './auth-route-overrides';
import { featureRouteModules } from '../extensions';
import { systemRoutes } from './system-routes';
import type { RouteMap } from '@bslt/server-system/http';
export interface RouteModuleRegistration {
  module: string;
  routes: RouteMap;
  prefix?: string;
}
export async function createAppRouteModuleRegistrations(
  enabledStrategies: readonly string[],
): Promise<readonly RouteModuleRegistration[]> {
  const auth = createComposedAuthRoutes(enabledStrategies);
  const users = createComposedUserRoutes();
  return [
    ...coreRouteModuleRegistrations.map((entry) => ({
      ...entry,
      routes: entry.module === 'auth' ? auth : entry.module === 'users' ? users : entry.routes,
    })),
    ...featureRouteModules(),
    { module: 'system', routes: systemRoutes, prefix: '' },
  ];
}
