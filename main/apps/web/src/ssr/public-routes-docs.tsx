// main/apps/web/src/ssr/public-routes-docs.tsx
/**
 * Documentation `PublicRoute` definitions (`/docs`, `/docs/:section`, and
 * `/docs/modules/:moduleId`). Loaded statically on the SSR server / prerenderer
 * and dynamically code-split on the client (`entry-public.tsx`) so non-docs
 * public pages stay well under Lighthouse script budgets.
 */

import { definePublicRoute, type PublicRoute } from '@bslt/web-platform';

import { clientConfig } from '#app/config';
import { DOC_CHAPTERS } from '#app/pages/docsCatalog';
import { DocsPage } from '#app/pages/DocsPage';
import { DOCS_REFERENCE } from '#app/pages/docsReference.generated';

export const docsPublicRoutes: readonly PublicRoute<unknown>[] = [
  ...DOC_CHAPTERS.map((chapter) =>
    definePublicRoute<Record<string, never>>({
      path: chapter.path,
      cacheSeconds: Infinity,
      load: () => Promise.resolve({}),
      head: () => ({
        title: `${chapter.title} · ${clientConfig.appName} Docs`,
        description: chapter.summary,
        ogType: 'article',
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
        title: `@bslt/${mod.id} Module Reference · ${clientConfig.appName} Docs`,
        description: mod.summary,
        ogType: 'article',
      }),
      Component: () => <DocsPage sectionId="modules" moduleId={mod.id} />,
    }),
  ),
];
