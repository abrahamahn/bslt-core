// main/tools/web/prerender.ts
/**
 * `bslt web prerender` (restructure plan §11.3, Phase 18).
 *
 * Imports `prerenderStaticPublicRoutes` from the built SSR server bundle
 * (`main/apps/web/dist/server/serve.js`) and writes prerendered HTML for all
 * `PublicRoute` entries with `cacheSeconds === Infinity` (preserving `_spa.html`
 * for unmatched SPA routes) plus `robots.txt` and (given `SITE_URL`) `sitemap.xml`.
 */

import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { PATHS } from '../lib/paths';

type PrerenderStaticPublicRoutesFn = (options: {
  readonly clientDir: string;
  readonly siteUrl: string | null;
  readonly appName?: string | undefined;
}) => Promise<string[]>;

export interface RunWebPrerenderOptions {
  readonly webDir?: string | undefined;
  readonly siteUrl?: string | null | undefined;
  readonly quiet?: boolean | undefined;
}

export async function runWebPrerender(options: RunWebPrerenderOptions = {}): Promise<string[]> {
  const webDir = options.webDir ?? PATHS.webApp;
  const clientDir = path.join(webDir, 'dist/client');
  const serverBundle = path.join(webDir, 'dist/server/serve.js');

  if (!existsSync(serverBundle)) {
    throw new Error(
      `Missing SSR bundle ${serverBundle}. Run \`pnpm --filter @bslt/web build:server\` before \`bslt web prerender\`.`,
    );
  }

  const loaded: unknown = await import(pathToFileURL(serverBundle).href);
  const fn =
    typeof loaded === 'object' && loaded !== null
      ? (loaded as { prerenderStaticPublicRoutes?: unknown }).prerenderStaticPublicRoutes
      : undefined;

  if (typeof fn !== 'function') {
    throw new Error(
      `${serverBundle} does not export prerenderStaticPublicRoutes(). Rebuild @bslt/web server bundle.`,
    );
  }

  const rawEnvSiteUrl = process.env['SITE_URL']?.trim() ?? '';
  const resolvedSiteUrl =
    options.siteUrl !== undefined ? options.siteUrl : rawEnvSiteUrl === '' ? null : rawEnvSiteUrl;

  const written = await (fn as PrerenderStaticPublicRoutesFn)({
    clientDir,
    siteUrl: resolvedSiteUrl,
  });

  const openApiSrc = path.resolve(webDir, '../../../docs/reference/openapi.json');
  if (existsSync(openApiSrc)) {
    copyFileSync(openApiSrc, path.join(clientDir, 'openapi.json'));
    written.push('openapi.json');
  }

  if (options.quiet !== true) {
    if (resolvedSiteUrl === null) {
      process.stdout.write(
        '[bslt web prerender] SITE_URL is unset — wrote robots.txt without sitemap.xml.\n',
      );
    }
    process.stdout.write(
      `[bslt web prerender] wrote ${String(written.length)} files: ${written.join(', ')}\n`,
    );
  }

  return written;
}

export async function runWebCli(argv: readonly string[]): Promise<number> {
  const [sub, ...flags] = argv;
  if (sub !== 'prerender') {
    console.error(`bslt web: unknown subcommand "${sub ?? ''}" (expected: bslt web prerender)`);
    return 1;
  }
  const quiet = flags.includes('--quiet');
  await runWebPrerender({ quiet });
  return 0;
}
