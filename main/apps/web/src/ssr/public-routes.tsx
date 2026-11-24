// main/apps/web/src/ssr/public-routes.tsx
/**
 * Aggregated `PublicRoute` list for `PROCESS_ROLE=web` SSR (`serve.ts`),
 * build-time prerendering (`bslt web prerender`), and lean client hydration
 * (`entry-public.tsx`).
 */

import { definePublicRoute, type PublicRoute } from '@bslt/web-platform';

import { installedPublicSsrModules, installedPublicSsrRoutes } from '../generated/public-modules';

import { PRODUCT_TAGLINE } from '#app/app/productMeta';
import { ChangelogPage } from '#app/pages/ChangelogPage';
import { PublicLandingPage } from '#app/pages/LandingPage';

export const PUBLIC_SSR_MODULES = installedPublicSsrModules;

const landingPublicRoute = definePublicRoute<Record<string, never>>({
  path: '/',
  cacheSeconds: Infinity,
  load: () => Promise.resolve({}),
  head: () => ({
    title: 'Home',
    description: `${PRODUCT_TAGLINE}.`,
  }),
  Component: () => <PublicLandingPage />,
});

const changelogPublicRoute = definePublicRoute<Record<string, never>>({
  path: '/changelog',
  cacheSeconds: Infinity,
  load: () => Promise.resolve({}),
  head: () => ({
    title: 'Changelog',
    description: `Release history and milestones for ${PRODUCT_TAGLINE}.`,
  }),
  Component: () => <ChangelogPage />,
});

export const publicRoutes: readonly PublicRoute<unknown>[] = [
  landingPublicRoute,
  changelogPublicRoute,
  ...installedPublicSsrRoutes,
];
