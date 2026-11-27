// main/apps/web/src/ssr/public-routes.tsx
/**
 * Aggregated `PublicRoute` list for `PROCESS_ROLE=web` SSR (`serve.ts`) and
 * build-time prerendering (`bslt web prerender`).
 */

import { corePublicRoutes, PUBLIC_SSR_MODULES } from './public-routes-core';
import { docsPublicRoutes } from './public-routes-docs';

import type { PublicRoute } from '@bslt/web-platform';

export { PUBLIC_SSR_MODULES };

export const publicRoutes: readonly PublicRoute<unknown>[] = [
  ...corePublicRoutes,
  ...docsPublicRoutes,
];
