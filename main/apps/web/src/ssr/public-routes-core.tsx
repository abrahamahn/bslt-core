// main/apps/web/src/ssr/public-routes-core.tsx
/**
 * Lean core `PublicRoute` list (`/` landing, `/changelog`, and module-owned
 * public SSR routes like `/blog`, `/waitlist`, `/status`, `/support`, and legal
 * documents). Intentionally omits `/docs/*` so `entry-public.tsx` never bundles
 * the 150KB+ auto-generated API/DB docs reference into initial public page loads.
 */

import { definePublicRoute, type PublicRoute } from '@bslt/web-platform';

import { installedPublicSsrModules, installedPublicSsrRoutes } from '../generated/public-modules';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { clientConfig } from '#app/config';
import { ChangelogPage } from '#app/pages/ChangelogPage';
import { PublicLandingPage } from '#app/pages/PublicLandingPage';

export const PUBLIC_SSR_MODULES = installedPublicSsrModules;

const landingPublicRoute = definePublicRoute<Record<string, never>>({
  path: '/',
  cacheSeconds: Infinity,
  load: () => Promise.resolve({}),
  head: () => ({
    title: clientConfig.appName,
    description: `${PRODUCT_TAGLINE}.`,
  }),
  Component: () => <PublicLandingPage />,
});

const changelogPublicRoute = definePublicRoute<Record<string, never>>({
  path: '/changelog',
  cacheSeconds: Infinity,
  load: () => Promise.resolve({}),
  head: () => ({
    title: `Changelog · ${clientConfig.appName}`,
    description: `Release history and milestones for ${PRODUCT_TAGLINE}.`,
  }),
  Component: () => <ChangelogPage />,
});

export const corePublicRoutes: readonly PublicRoute<unknown>[] = [
  landingPublicRoute,
  changelogPublicRoute,
  ...installedPublicSsrRoutes,
];
