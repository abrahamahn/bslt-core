// main/apps/web/scripts/prerender.ts
/**
 * Render the public pages to HTML at build time.
 *
 * Run by `pnpm --filter @bslt/web build`, after the client and SSR bundles exist.
 * It is INSIDE `build`, not beside it, on purpose: the Docker image, the
 * Cloudflare deploy, Lighthouse CI and every developer all run `build`, and a
 * prerender step that has to be remembered separately is one that eventually is
 * not. Ganbate's image built with `pnpm build` and never called its prerenderer;
 * every page shipped as an empty SPA shell, and the first symptom was the search
 * traffic that never arrived.
 *
 * It lives inside the web package — not in main/tools — so that turbo's
 * package-scoped build inputs see it (an edit here must invalidate the cached
 * web build, not be served from cache), and so the package's own lint and
 * type-check cover it.
 *
 * This script only does I/O. WHAT gets rendered, and what counts as broken, is
 * decided in ../src/ssr/prerender.ts — which the SSR bundle re-exports, and
 * which the web test suite runs on every commit. The seam is typed against the
 * real `prerenderSite` export, so signature drift fails type-check; the shape is
 * ALSO checked at runtime, because what actually loads is the built bundle, and
 * a stale dist can disagree with the source the types came from.
 *
 *   SITE_URL — the site's public origin (e.g. https://bslt.dev). Optional: a
 *   sitemap needs it, because <loc> must be absolute. Without it the build still
 *   prerenders every page, and says so.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { prerenderSite } from '../src/entry-server';
import type { PrerenderedFile } from '../src/ssr/prerender';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIR = path.join(WEB_ROOT, 'dist/client');
const SSR_BUNDLE = path.join(WEB_ROOT, 'dist/server/entry-server.js');

type PrerenderSite = typeof prerenderSite;

function log(message: string): void {
  process.stdout.write(`[prerender] ${message}\n`);
}

function resolveSiteUrl(): string | null {
  const raw = process.env['SITE_URL']?.trim() ?? '';
  return raw === '' ? null : raw;
}

async function loadPrerenderSite(): Promise<PrerenderSite> {
  const bundle: unknown = await import(pathToFileURL(SSR_BUNDLE).href);

  const loaded =
    typeof bundle === 'object' && bundle !== null
      ? (bundle as { prerenderSite?: unknown }).prerenderSite
      : undefined;

  if (typeof loaded !== 'function') {
    throw new Error(
      `${SSR_BUNDLE} does not export prerenderSite(). Run \`pnpm --filter @bslt/web build:server\` first.`,
    );
  }

  return loaded as PrerenderSite;
}

/** A bundle that drifted from this contract must fail the build, not write `undefined` to disk. */
function assertFile(file: PrerenderedFile): PrerenderedFile {
  if (typeof file.path !== 'string' || typeof file.contents !== 'string') {
    throw new Error(
      `prerenderSite() returned a file this script cannot write: ${JSON.stringify(file)}`,
    );
  }

  return file;
}

async function main(): Promise<void> {
  const template = await readFile(path.join(CLIENT_DIR, 'index.html'), 'utf8');
  const prerender = await loadPrerenderSite();
  const siteUrl = resolveSiteUrl();

  if (siteUrl === null) {
    log('SITE_URL is not set — writing robots.txt without a sitemap. Set it to emit sitemap.xml.');
  }

  // Throws — and so fails the build — if a live page renders to an empty shell.
  const files = await prerender({ template, siteUrl });

  await Promise.all(
    files.map(assertFile).map(async (file) => {
      const target = path.join(CLIENT_DIR, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.contents, 'utf8');
    }),
  );

  log(`wrote ${files.length.toString()} files: ${files.map((file) => file.path).join(', ')}`);
}

main().catch((error: unknown) => {
  // A prerender failure — an empty page, a missing bundle, a template with no
  // placeholders — must take the build down with it. A warning here is a warning
  // nobody reads until the site has been shipping empty shells for a month.
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[prerender] FAILED\n${detail}\n`);
  process.exit(1);
});
