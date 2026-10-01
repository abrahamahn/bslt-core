// main/apps/web/src/entry-server.tsx
/**
 * The SSR bundle's entry point — and its only consumer is the BUILD.
 *
 * `VITE_SSR=true vite build` compiles this file (and everything it reaches) into
 * dist/server/entry-server.js. scripts/prerender.ts imports that
 * bundle, calls `prerenderSite()`, and writes the resulting files into the client
 * build. Nothing imports it at runtime: there is no SSR server in production, by
 * design.
 *
 * Everything reachable from here must be safe to evaluate in Node — no `window`,
 * no `document`, no `localStorage` at module scope.
 */

import { prerender } from 'react-dom/static';

import { clientConfig } from './config';
import { prerenderFiles, type PrerenderedFile, type RenderResult } from './ssr/prerender';
import { ServerApp } from './ssr/ServerApp';

import type { SsrData } from './ssr/SsrContext';

// ============================================================================
// Render
// ============================================================================

/**
 * Render one page to HTML.
 *
 * `prerender()` — not `renderToString()` — because the route table code-splits
 * its pages: `renderToString` cannot wait for a `lazy()` component and would
 * silently emit the Suspense fallback, so /support and /status would ship a
 * spinner as their indexable content. `prerender()` resolves them first. It is
 * the React API built for exactly this: static generation, no client attached.
 *
 * A render error is fatal. A build that swallows one ships a page that is
 * missing the content it exists to serve.
 */
export async function render(url: string, ssrData: SsrData): Promise<RenderResult> {
  const errors: unknown[] = [];

  const { prelude } = await prerender(<ServerApp url={url} ssrData={ssrData} />, {
    onError: (error: unknown): void => {
      errors.push(error);
    },
  });

  const html = await new Response(prelude).text();

  const failure = errors[0];
  if (failure !== undefined) {
    throw failure instanceof Error
      ? failure
      : new Error(`Prerendering ${url} threw`, { cause: failure });
  }

  const title = ssrData.title ?? clientConfig.appName;
  const description = ssrData.description ?? '';
  const canonical = typeof ssrData['canonicalUrl'] === 'string' ? ssrData['canonicalUrl'] : '';

  const head = [
    `<title>${escapeHtml(title)}</title>`,
    description !== '' ? `<meta name="description" content=${escapeAttr(description)}>` : '',
    `<meta property="og:title" content=${escapeAttr(title)}>`,
    description !== '' ? `<meta property="og:description" content=${escapeAttr(description)}>` : '',
    `<meta property="og:type" content="website">`,
    // Only when absolute: a canonical or og:url carrying a bare path names the
    // page without naming its origin, which is worse than omitting the tag.
    canonical !== '' ? `<link rel="canonical" href=${escapeAttr(canonical)}>` : '',
    canonical !== '' ? `<meta property="og:url" content=${escapeAttr(canonical)}>` : '',
    canonical !== '' ? jsonLd({ title, description, canonical }) : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  return { html, head };
}

// ============================================================================
// Prerender
// ============================================================================

export interface PrerenderSiteOptions {
  /** The built client `index.html`. */
  template: string;
  /** The site's public origin, or null when the build was not told one. */
  siteUrl: string | null;
}

/**
 * The whole public site as files: an `index.html` per live page, plus robots.txt
 * and (given a site URL) sitemap.xml. Throws if a live page renders empty.
 *
 * This is the bundle's seam with the build script: the script does the I/O, this
 * does the deciding, and the deciding is unit-tested in src/ssr/prerender.test.ts.
 */
export function prerenderSite(options: PrerenderSiteOptions): Promise<PrerenderedFile[]> {
  return prerenderFiles({ ...options, render });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * A `WebPage` JSON-LD block, so a crawler is told what the page IS rather than
 * left to infer it from the markup.
 *
 * Every `<` in the payload is unicode-escaped. JSON inside a `<script>` is not
 * parsed as HTML, so a document containing the literal `</script>` would
 * otherwise close the tag early and spill the rest of the JSON into the page —
 * `JSON.stringify` alone does not protect against that.
 */
function jsonLd(page: { title: string; description: string; canonical: string }): string {
  const origin = new URL(page.canonical).origin;
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    url: page.canonical,
    ...(page.description === '' ? {} : { description: page.description }),
    isPartOf: { '@type': 'WebSite', name: clientConfig.appName, url: origin },
  };
  const json = JSON.stringify(payload).replace(/</gu, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  // JSON string encoding is safe for quoted HTML attribute insertion.
  // Result includes surrounding quotes.
  return JSON.stringify(str);
}
