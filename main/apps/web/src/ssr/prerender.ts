// main/apps/web/src/ssr/prerender.ts
/**
 * The build-time prerenderer: the site map in, static files out.
 *
 * Every public page is prose that is identical for every visitor, so its HTML is
 * computed once here, at build time, and served as a file. There is no SSR
 * process in production — nothing to keep up, and the API never serves HTML, so
 * "API down" cannot become "site down".
 *
 * This module is pure: it takes the HTML template, a `render`, and the pages,
 * and returns the files to write. The script that touches the disk is
 * ../../scripts/prerender.ts, and it is deliberately thin — the decisions (what
 * gets rendered, what counts as broken) live here, where the web test suite
 * runs them on every commit.
 *
 * The guard is the point. Ganbate shipped this exact feature with the prerender
 * step missing from the image build: every page went out as an empty SPA shell,
 * and nobody noticed until the search traffic did not arrive. `prerenderFiles`
 * throws if a live page renders to an empty root — a silent empty shell must
 * fail the build, loudly, not become the product.
 */

import { livePages, SITE_MAP, type LiveSitePage, type SitePage } from '@app/siteMap';
import { trimTrailingSlashes } from '@bslt/shared/helpers/string';

import type { SsrData } from './SsrContext';

// ============================================================================
// Types
// ============================================================================

/** One rendered page: what goes into the template's two placeholders. */
export interface RenderResult {
  /** The rendered page HTML, for `<!--ssr-outlet-->`. */
  html: string;
  /** Title and meta tags, for `<!--ssr-head-->`. */
  head: string;
}

/** The render entry point, injected so this module never has to import React. */
export type RenderPage = (url: string, ssrData: SsrData) => Promise<RenderResult>;

/** A file to write into the client build output. */
export interface PrerenderedFile {
  /** Path relative to the web dist root, e.g. `terms/index.html`. */
  readonly path: string;
  readonly contents: string;
}

export interface PrerenderOptions {
  /** The built client `index.html`, with its `<!--ssr-*-->` placeholders intact. */
  readonly template: string;
  /** The site's public origin. Without it there is no sitemap: `<loc>` must be absolute. */
  readonly siteUrl: string | null;
  readonly render: RenderPage;
  /**
   * Defaults to the whole site map. Dark pages are filtered out here, not by the
   * caller: `live: false` means "declared, not built", and HTML for a URL the
   * router does not serve is a 404 with a 200 status.
   */
  readonly pages?: readonly SitePage[];
}

// ============================================================================
// Template
// ============================================================================

const HEAD_MARKER = '<!--ssr-head-->';
const OUTLET_MARKER = '<!--ssr-outlet-->';
const ROOT_OPEN = '<div id="root">';

/** The placeholder `<title>` the SPA ships. A prerendered page brings its own. */
const DEFAULT_TITLE = /\s*<title data-default-title>[\s\S]*?<\/title>/u;

/** `<div id="root">` with nothing inside it: the empty shell this guard exists for. */
const EMPTY_ROOT = /<div id="root"[^>]*>\s*<\/div>/u;

/**
 * The root is marked `data-prerendered` so the client knows this markup is NOT
 * hydratable — it is the page without the app shell, and the client renders the
 * shell. `bootstrapClientApp` drops it and mounts fresh.
 */
export function fillTemplate(template: string, rendered: RenderResult): string {
  for (const marker of [HEAD_MARKER, OUTLET_MARKER, ROOT_OPEN]) {
    if (!template.includes(marker)) {
      throw new Error(`index.html is missing ${marker}; the prerenderer has nowhere to write.`);
    }
  }

  return template
    .replace(DEFAULT_TITLE, '')
    .replace(HEAD_MARKER, rendered.head)
    .replace(ROOT_OPEN, '<div id="root" data-prerendered="true">')
    .replace(OUTLET_MARKER, rendered.html);
}

/** `/` → `index.html`, `/terms` → `terms/index.html` (nginx and Cloudflare both resolve `/terms` to it). */
export function outputPathFor(routePath: string): string {
  const trimmed = routePath.replace(/^\/+|\/+$/gu, '');
  return trimmed === '' ? 'index.html' : `${trimmed}/index.html`;
}

// ============================================================================
// Guard
// ============================================================================

/**
 * Fail the build on an empty shell.
 *
 * A page that renders to nothing looks fine in every way that is easy to check —
 * the file exists, the bundle loads, the app works in a browser — and is worth
 * nothing to a crawler, which does not run the JavaScript that would have filled
 * it in.
 */
function assertRendered(page: LiveSitePage, html: string): void {
  if (EMPTY_ROOT.test(html)) {
    throw new Error(
      `Prerendering ${page.path} produced an empty <div id="root">. The page rendered nothing, ` +
        `so it would ship as a bare SPA shell with no content for a crawler to read.`,
    );
  }
}

// ============================================================================
// Prerender
// ============================================================================

/**
 * Render every live page, plus the two files that tell crawlers what to do with
 * them. Non-live pages are skipped: `livePages()` is the only source, so a page
 * declared before its route exists cannot ship HTML for a URL nobody serves.
 */
export async function prerenderFiles(options: PrerenderOptions): Promise<PrerenderedFile[]> {
  const pages = livePages(options.pages ?? SITE_MAP);
  const siteUrl = options.siteUrl === null ? null : trimTrailingSlashes(options.siteUrl);

  const documents = await Promise.all(
    pages.map(async (page): Promise<PrerenderedFile> => {
      const rendered = await options.render(page.path, {
        url: page.path,
        title: page.title,
        ...(page.description !== undefined && { description: page.description }),
        // Absolute, or absent. A canonical that names a path without an origin
        // tells a crawler this page's identity while withholding where it lives.
        ...(siteUrl !== null && { canonicalUrl: `${siteUrl}${page.path}` }),
      });
      const contents = fillTemplate(options.template, rendered);
      assertRendered(page, contents);

      return { path: outputPathFor(page.path), contents };
    }),
  );

  return [
    ...documents,
    ...(siteUrl === null ? [] : [{ path: 'sitemap.xml', contents: sitemapXml(siteUrl, pages) }]),
    { path: 'robots.txt', contents: robotsTxt(siteUrl) },
  ];
}

// ============================================================================
// Crawler files
// ============================================================================

/** `<loc>` must be an absolute URL, which is why a sitemap needs the site's origin. */
export function sitemapXml(siteUrl: string, pages: readonly LiveSitePage[]): string {
  const urls = pages
    .map((page) => `  <url>\n    <loc>${escapeXml(`${siteUrl}${page.path}`)}</loc>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Generated, never hand-written: a static robots.txt drifts from the site map the
 * moment a page is added, and points crawlers at a sitemap that may not exist.
 * With no site URL there is no sitemap to advertise, so the line is omitted
 * rather than pointed at a placeholder domain.
 */
export function robotsTxt(siteUrl: string | null): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (siteUrl !== null) lines.push('', `Sitemap: ${siteUrl}/sitemap.xml`);

  return `${lines.join('\n')}\n`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}
