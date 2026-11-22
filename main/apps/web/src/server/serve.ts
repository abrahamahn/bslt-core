// main/apps/web/src/server/serve.ts
/**
 * Owned `node:http` server for `PROCESS_ROLE=web` (restructure plan §11.3, D7).
 *
 * Responsibilities:
 * 1. Fails fast at boot in production when `SITE_URL` is unset or invalid;
 * 2. Serves fingerprinted `/assets/*` as `public, max-age=31536000, immutable`;
 * 3. Serves `/health`, `/robots.txt`, and runtime `/sitemap.xml`;
 * 4. Renders `PublicRoute` paths via `renderPublic` + `AnonymousSdk` against
 *    `API_INTERNAL_URL` with zero cookies/sessions forwarded;
 * 5. Serves the SPA document (`_spa.html` / `index.html`) for all other GET routes.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildRobotsTxt,
  buildRuntimeSitemapXml,
  createAnonymousSdk,
  GENERATED_EDGE_CSP,
  GENERATED_PERMISSIONS_POLICY,
  renderPublic,
} from '@bslt/web-platform';

import { DEFAULT_APP_NAME } from '../config';
import { PUBLIC_SSR_MODULES, publicRoutes } from '../ssr/public-routes';
import { PublicDocumentShell } from '../ssr/PublicDocumentShell';

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

interface ViteManifestChunk {
  readonly file?: string;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
}

type ViteManifest = Readonly<Record<string, ViteManifestChunk>>;

interface ValidatedWebServerEnv {
  readonly port: number;
  readonly host: string;
  readonly apiInternalUrl: string;
  readonly siteUrl: string | null;
  readonly appName: string;
  readonly clientDir: string;
}

interface CreateWebServerOptions {
  readonly clientDir: string;
  readonly apiInternalUrl: string;
  readonly siteUrl: string | null;
  readonly appName?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface WebServerHandle {
  readonly server: http.Server;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

function parseAbsoluteOrigin(raw: string, varName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${varName} must be an absolute http(s):// URL, received "${raw}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${varName} must use http:// or https://, received "${raw}"`);
  }
  return parsed.origin;
}

export function validateWebServerEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ValidatedWebServerEnv {
  const isProd = env['NODE_ENV'] === 'production';
  const rawSiteUrl = env['SITE_URL']?.trim() ?? '';

  if (isProd && rawSiteUrl === '') {
    throw new Error(
      'PROCESS_ROLE=web requires SITE_URL to be set in production so canonical tags and /sitemap.xml emit absolute origins',
    );
  }

  const siteUrl = rawSiteUrl === '' ? null : parseAbsoluteOrigin(rawSiteUrl, 'SITE_URL');
  const rawApiUrl = (env['API_INTERNAL_URL']?.trim() ?? '') || 'http://127.0.0.1:8080';
  const apiInternalUrl = parseAbsoluteOrigin(rawApiUrl, 'API_INTERNAL_URL');

  const rawPort = env['PORT']?.trim() ?? '';
  const port = rawPort === '' ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT "${rawPort}": expected an integer between 0 and 65535`);
  }

  const host = (env['HOST']?.trim() ?? '') || '0.0.0.0';
  const appName = (env['VITE_APP_NAME']?.trim() ?? '') || DEFAULT_APP_NAME;

  const defaultClientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
  const clientDir =
    (env['WEB_CLIENT_DIR']?.trim() ?? '') !== ''
      ? path.resolve(env['WEB_CLIENT_DIR'] ?? '')
      : defaultClientDir;

  return {
    port,
    host,
    apiInternalUrl,
    siteUrl,
    appName,
    clientDir,
  };
}

function readPublicEntryAssets(clientDir: string): {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
} {
  const candidates = [
    path.join(clientDir, '.vite/manifest.json'),
    path.join(clientDir, 'manifest.vite.json'),
  ];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  if (manifestPath === undefined) {
    return { scripts: [], styles: [] };
  }

  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as ViteManifest;
  const entryKey = Object.keys(parsed).find(
    (key) => key === 'src/entry-public.tsx' || key.endsWith('/src/entry-public.tsx'),
  );
  if (entryKey === undefined) {
    return { scripts: [], styles: [] };
  }

  const scripts: string[] = [];
  const styles = new Set<string>();
  const visited = new Set<string>();

  const collectCss = (key: string): void => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = parsed[key];
    if (chunk === undefined) return;
    for (const cssFile of chunk.css ?? []) {
      styles.add(cssFile.startsWith('/') ? cssFile : `/${cssFile}`);
    }
    for (const importedKey of chunk.imports ?? []) {
      collectCss(importedKey);
    }
  };

  const entryChunk = parsed[entryKey];
  if (entryChunk?.file !== undefined && entryChunk.file !== '') {
    scripts.push(entryChunk.file.startsWith('/') ? entryChunk.file : `/${entryChunk.file}`);
  }
  collectCss(entryKey);

  return {
    scripts,
    styles: [...styles],
  };
}

function loadSpaTemplate(clientDir: string): string {
  const spaPath = path.join(clientDir, '_spa.html');
  if (existsSync(spaPath)) {
    return readFileSync(spaPath, 'utf8');
  }
  return readFileSync(path.join(clientDir, 'index.html'), 'utf8');
}

function applyDocumentSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('Content-Security-Policy', GENERATED_EDGE_CSP);
  res.setHeader('Permissions-Policy', GENERATED_PERMISSIONS_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function resolveSafeStaticFile(clientDir: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }
  const relative = decoded.replace(/^\/+/u, '');
  if (
    relative === '' ||
    relative === '_spa.html' ||
    relative.startsWith('.vite/') ||
    relative === '.vite'
  ) {
    return null;
  }
  const resolvedRoot = path.resolve(clientDir);
  const candidate = path.resolve(resolvedRoot, relative);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  return candidate;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function createWebServer(options: CreateWebServerOptions): WebServerHandle {
  const appName = options.appName ?? DEFAULT_APP_NAME;
  const publicAssets = readPublicEntryAssets(options.clientDir);
  const spaHtml = loadSpaTemplate(options.clientDir);

  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, {
          Allow: 'GET, HEAD',
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end('Method Not Allowed');
        return;
      }

      const rawUrl = req.url ?? '/';
      if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e%2e')) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }

      const baseOrigin = options.siteUrl ?? 'http://localhost';
      let requestUrl: URL;
      try {
        requestUrl = new URL(rawUrl, baseOrigin);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }

      const pathname = requestUrl.pathname;

      if (pathname === '/health') {
        const payload = JSON.stringify({ status: 'ok', role: 'web' });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(method === 'HEAD' ? undefined : payload);
        return;
      }

      if (pathname === '/robots.txt') {
        const body = buildRobotsTxt(options.siteUrl);
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(method === 'HEAD' ? undefined : body);
        return;
      }

      if (pathname === '/sitemap.xml') {
        if (options.siteUrl === null) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(method === 'HEAD' ? undefined : 'Not Found');
          return;
        }
        const anonymousSdk = createAnonymousSdk(PUBLIC_SSR_MODULES, {
          baseUrl: options.apiInternalUrl,
          fetchImpl: options.fetchImpl,
        });
        const xml = await buildRuntimeSitemapXml(options.siteUrl, publicRoutes, anonymousSdk);
        res.writeHead(200, {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        });
        res.end(method === 'HEAD' ? undefined : xml);
        return;
      }

      if (pathname.startsWith('/assets/')) {
        const assetFile = resolveSafeStaticFile(options.clientDir, pathname);
        if (assetFile === null || !existsSync(assetFile) || !statSync(assetFile).isFile()) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(method === 'HEAD' ? undefined : 'Not Found');
          return;
        }
        const body = await readFile(assetFile);
        res.writeHead(200, {
          'Content-Type': contentTypeFor(assetFile),
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(method === 'HEAD' ? undefined : body);
        return;
      }

      // Public static files at root (`/theme-init.js`, `/sw.js`, `/manifest.json`, `/icons/*`)
      if (path.extname(pathname) !== '') {
        const staticFile = resolveSafeStaticFile(options.clientDir, pathname);
        if (staticFile !== null && existsSync(staticFile) && statSync(staticFile).isFile()) {
          const body = await readFile(staticFile);
          res.writeHead(200, {
            'Content-Type': contentTypeFor(staticFile),
            'Content-Length': String(body.byteLength),
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(method === 'HEAD' ? undefined : body);
          return;
        }
      }

      // Attempt PublicRoute SSR (never receives request headers/cookies!)
      const rendered = await renderPublic(requestUrl, publicRoutes, {
        apiInternalUrl: options.apiInternalUrl,
        siteUrl: options.siteUrl,
        appName,
        template: spaHtml,
        modules: PUBLIC_SSR_MODULES,
        fetchImpl: options.fetchImpl,
        Shell: PublicDocumentShell,
        publicEntryScripts: publicAssets.scripts,
        publicEntryStyles: publicAssets.styles,
      });

      if (rendered !== null) {
        applyDocumentSecurityHeaders(res);
        res.writeHead(rendered.status, {
          ...rendered.headers,
          Vary: 'Accept-Encoding',
        });
        res.end(method === 'HEAD' ? undefined : rendered.html);
        return;
      }

      // All other paths (logged-in SPA routes, auth routes, client 404s) receive the SPA shell
      applyDocumentSecurityHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        Vary: 'Accept-Encoding',
      });
      res.end(method === 'HEAD' ? undefined : spaHtml);
    })().catch((error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
      }
      if (!res.writableEnded) {
        res.end('Internal Server Error');
      }
      const msg = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`[web-ssr] request error: ${msg}\n`);
    });
  });

  return {
    server,
    listen(port: number, host = '0.0.0.0'): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        const onError = (err: Error): void => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.off('error', onError);
          const address = server.address();
          const boundPort = typeof address === 'object' && address !== null ? address.port : port;
          resolve(boundPort);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((err) => {
          if (err !== undefined) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function outputFileForRoute(routePath: string): string {
  const trimmed = routePath.replace(/^\/+|\/+$/gu, '');
  return trimmed === '' ? 'index.html' : `${trimmed}/index.html`;
}

export async function prerenderStaticPublicRoutes(options: {
  readonly clientDir: string;
  readonly siteUrl: string | null;
  readonly appName?: string | undefined;
}): Promise<string[]> {
  const spaTemplatePath = path.join(options.clientDir, '_spa.html');
  const indexHtmlPath = path.join(options.clientDir, 'index.html');
  const spaTemplate = existsSync(spaTemplatePath)
    ? await readFile(spaTemplatePath, 'utf8')
    : await readFile(indexHtmlPath, 'utf8');

  await writeFile(spaTemplatePath, spaTemplate, 'utf8');
  const written: string[] = ['_spa.html'];

  const publicAssets = readPublicEntryAssets(options.clientDir);
  const normalizedSiteUrl =
    options.siteUrl !== null && options.siteUrl.trim() !== ''
      ? parseAbsoluteOrigin(options.siteUrl.trim(), 'SITE_URL')
      : null;

  const staticRoutes = publicRoutes.filter((route) => !Number.isFinite(route.cacheSeconds));

  for (const route of staticRoutes) {
    const origin = normalizedSiteUrl ?? 'http://localhost';
    const rendered = await renderPublic(new URL(route.path, origin), [route], {
      apiInternalUrl: 'http://127.0.0.1:8080',
      siteUrl: normalizedSiteUrl,
      appName: options.appName ?? DEFAULT_APP_NAME,
      template: spaTemplate,
      modules: PUBLIC_SSR_MODULES,
      Shell: PublicDocumentShell,
      publicEntryScripts: publicAssets.scripts,
      publicEntryStyles: publicAssets.styles,
    });
    if (rendered === null) {
      throw new Error(`Failed to prerender static PublicRoute "${route.path}"`);
    }
    const relOut = outputFileForRoute(route.path);
    const fullOut = path.join(options.clientDir, relOut);
    await mkdir(path.dirname(fullOut), { recursive: true });
    await writeFile(fullOut, rendered.html, 'utf8');
    written.push(relOut);
  }

  await writeFile(
    path.join(options.clientDir, 'robots.txt'),
    buildRobotsTxt(normalizedSiteUrl),
    'utf8',
  );
  written.push('robots.txt');

  if (normalizedSiteUrl !== null) {
    const offlineSdk = createAnonymousSdk(PUBLIC_SSR_MODULES, {
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl: () => Promise.reject(new Error('offline build-time sitemap generation')),
    });
    const xml = await buildRuntimeSitemapXml(normalizedSiteUrl, publicRoutes, offlineSdk);
    await writeFile(path.join(options.clientDir, 'sitemap.xml'), xml, 'utf8');
    written.push('sitemap.xml');
  }

  return written;
}

async function startWebServer(): Promise<WebServerHandle> {
  const config = validateWebServerEnv(process.env);
  const handle = createWebServer({
    clientDir: config.clientDir,
    apiInternalUrl: config.apiInternalUrl,
    siteUrl: config.siteUrl,
    appName: config.appName,
  });
  const boundPort = await handle.listen(config.port, config.host);
  process.stdout.write(
    `[web] PROCESS_ROLE=web listening on http://${config.host}:${String(boundPort)} (api=${config.apiInternalUrl})\n`,
  );

  const shutdown = (): void => {
    void handle.close().finally(() => {
      process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return handle;
}

if (process.env['PROCESS_ROLE'] === 'web' && process.env['VITEST'] === undefined) {
  startWebServer().catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[web] failed to start PROCESS_ROLE=web server: ${detail}\n`);
    process.exit(1);
  });
}
