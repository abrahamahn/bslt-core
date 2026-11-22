// main/modules/devtools/server/service.ts
import { getRegisteredRoutes } from '@bslt/server-system/http';

import type { AdminRouteManifestEntry, AdminRouteMethod, RouteManifestResponse } from '../contract';

interface RawRegisteredRoute {
  readonly path: string;
  readonly method: AdminRouteMethod;
  readonly isPublic: boolean;
  readonly roles: readonly string[];
  readonly hasSchema: boolean;
  readonly module: string;
  readonly deprecated?: boolean | undefined;
  readonly summary?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export function buildRouteManifest(
  readRoutes: () => readonly RawRegisteredRoute[] = getRegisteredRoutes,
): RouteManifestResponse {
  const entries = readRoutes();
  const routes: AdminRouteManifestEntry[] = entries.map((entry) => ({
    path: entry.path,
    method: entry.method,
    isPublic: entry.isPublic,
    roles: [...entry.roles],
    hasSchema: entry.hasSchema,
    module: entry.module,
    ...(entry.deprecated !== undefined ? { deprecated: entry.deprecated } : {}),
    ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
    ...(entry.tags !== undefined ? { tags: [...entry.tags] } : {}),
  }));

  return {
    routes,
    count: routes.length,
  };
}
