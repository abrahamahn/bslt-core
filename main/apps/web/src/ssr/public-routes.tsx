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
import { DOC_CHAPTERS } from '#app/pages/docsCatalog';
import { DocsPage } from '#app/pages/DocsPage';
import { DOCS_REFERENCE } from '#app/pages/docsReference.generated';
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

const docsPublicRoutes: readonly PublicRoute<unknown>[] = [
  ...DOC_CHAPTERS.map((chapter) =>
    definePublicRoute<Record<string, never>>({
      path: chapter.path,
      cacheSeconds: Infinity,
      load: () => Promise.resolve({}),
      head: () => ({
        title: `${chapter.title} — Docs`,
        description: chapter.summary,
      }),
      Component: () => <DocsPage sectionId={chapter.id} />,
    }),
  ),
  ...DOCS_REFERENCE.modules.map((mod) =>
    definePublicRoute<Record<string, never>>({
      path: `/docs/modules/${mod.id}`,
      cacheSeconds: Infinity,
      load: () => Promise.resolve({}),
      head: () => ({
        title: `@bslt/${mod.id} Module Reference — Docs`,
        description: mod.summary,
      }),
      Component: () => <DocsPage sectionId="modules" moduleId={mod.id} />,
    }),
  ),
];

export const publicRoutes: readonly PublicRoute<unknown>[] = [
  landingPublicRoute,
  changelogPublicRoute,
  ...docsPublicRoutes,
  ...installedPublicSsrRoutes,
];
