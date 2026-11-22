// main/apps/web/src/server/serve.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWebServer,
  prerenderStaticPublicRoutes,
  validateWebServerEnv,
  type WebServerHandle,
} from './serve';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REAL_INDEX_HTML = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');

const tempDirs: string[] = [];
const activeServers: WebServerHandle[] = [];

function createTempClientDist(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bslt-web-serve-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  mkdirSync(path.join(dir, '.vite'), { recursive: true });

  writeFileSync(
    path.join(dir, 'index.html'),
    REAL_INDEX_HTML.replace('./src/main.tsx', '/assets/main-111111.js'),
    'utf8',
  );
  writeFileSync(path.join(dir, 'assets/main-111111.js'), 'console.log("spa");\n', 'utf8');
  writeFileSync(path.join(dir, 'assets/public-222222.js'), 'console.log("public");\n', 'utf8');
  writeFileSync(path.join(dir, 'assets/public-222222.css'), 'body{margin:0}\n', 'utf8');
  writeFileSync(path.join(dir, 'theme-init.js'), '// theme init\n', 'utf8');
  writeFileSync(
    path.join(dir, '.vite/manifest.json'),
    JSON.stringify(
      {
        'index.html': {
          file: 'assets/main-111111.js',
          src: 'index.html',
          isEntry: true,
        },
        'src/entry-public.tsx': {
          file: 'assets/public-222222.js',
          src: 'src/entry-public.tsx',
          isEntry: true,
          css: ['assets/public-222222.css'],
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  return dir;
}

async function startEphemeralServer(
  options: Parameters<typeof createWebServer>[0],
): Promise<{ readonly baseUrl: string; readonly handle: WebServerHandle }> {
  const handle = createWebServer(options);
  activeServers.push(handle);
  const port = await handle.listen(0, '127.0.0.1');
  return { baseUrl: `http://127.0.0.1:${String(port)}`, handle };
}

describe('PROCESS_ROLE=web server (serve.ts)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    while (activeServers.length > 0) {
      const srv = activeServers.pop();
      if (srv !== undefined) await srv.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('fails boot in production when SITE_URL is missing or relative', () => {
    expect(() =>
      validateWebServerEnv({
        NODE_ENV: 'production',
        API_INTERNAL_URL: 'http://api:8080',
      }),
    ).toThrow(/SITE_URL/u);

    expect(() =>
      validateWebServerEnv({
        NODE_ENV: 'production',
        SITE_URL: '/not-an-origin',
        API_INTERNAL_URL: 'http://api:8080',
      }),
    ).toThrow(/SITE_URL/u);

    const devConfig = validateWebServerEnv({
      NODE_ENV: 'development',
    });
    expect(devConfig.siteUrl).toBeNull();
  });

  it('rejects non-GET/HEAD methods, path traversal, and missing /assets/* without SPA fallback', async () => {
    const clientDir = createTempClientDist();
    const { baseUrl } = await startEphemeralServer({
      clientDir,
      apiInternalUrl: 'http://127.0.0.1:59999',
      siteUrl: 'https://app.bslt.dev',
    });

    const postRes = await fetch(`${baseUrl}/status`, { method: 'POST' });
    expect(postRes.status).toBe(405);

    const missingAsset = await fetch(`${baseUrl}/assets/nonexistent-chunk.js`);
    expect(missingAsset.status).toBe(404);

    // Raw TCP path-traversal attempt (`/../package.json`) must never leak parent files
    const traversalStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${baseUrl}/assets/..%2f..%2fpackage.json`, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect([400, 404]).toContain(traversalStatus);
  });

  it('serves fingerprinted assets as immutable, renders /status without forwarding cookies, serves /sitemap.xml, and serves SPA shell for logged-in routes', async () => {
    const clientDir = createTempClientDist();

    const upstreamReceivedHeaders: http.IncomingHttpHeaders[] = [];
    const fakeApiServer = http.createServer((req, res) => {
      upstreamReceivedHeaders.push(req.headers);
      if (req.url === '/api/legal/current') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            documents: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                type: 'terms_of_service',
                title: 'Terms of Service',
                content: 'Standard terms body.',
                version: 1,
                effectiveAt: '2026-01-01T00:00:00.000Z',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
        );
        return;
      }
      if (req.url === '/api/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'healthy',
            timestamp: '2026-11-20T12:00:00.000Z',
            uptimeSeconds: 3600,
            components: {
              database: 'up',
              cache: 'up',
              queue: 'up',
              storage: 'up',
              email: 'up',
            },
            incidents: [],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => {
      fakeApiServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const apiAddr = fakeApiServer.address();
    const apiPort = typeof apiAddr === 'object' && apiAddr !== null ? apiAddr.port : 0;

    try {
      const { baseUrl } = await startEphemeralServer({
        clientDir,
        apiInternalUrl: `http://127.0.0.1:${String(apiPort)}`,
        siteUrl: 'https://app.bslt.dev',
      });

      // 1. Health probe
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ status: 'ok', role: 'web' });

      // 2. Fingerprinted asset is immutable
      const assetRes = await fetch(`${baseUrl}/assets/public-222222.js`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

      // 3. Crawler fetch of dynamic SSR route (/terms) with hostile cookies & Authorization header — NEVER forwarded to API!
      const termsRes = await fetch(`${baseUrl}/terms`, {
        headers: {
          Cookie: 'bslt_refresh=top-secret-session; theme=dark',
          Authorization: 'Bearer leaked-jwt',
        },
      });
      expect(termsRes.status).toBe(200);
      expect(termsRes.headers.get('cache-control')).toContain('public, max-age=60');
      expect(termsRes.headers.get('content-security-policy')).toContain("default-src 'self'");
      const termsHtml = await termsRes.text();
      expect(termsHtml).toContain('<title>Terms of Service</title>');
      expect(termsHtml).toContain('id="__BSLT_STATE__"');
      expect(termsHtml).toContain('src="/assets/public-222222.js"');
      expect(termsHtml).toContain('href="/assets/public-222222.css"');
      expect(termsHtml).not.toContain('src="/assets/main-111111.js"');

      expect(upstreamReceivedHeaders).toHaveLength(1);
      expect(upstreamReceivedHeaders[0]?.cookie).toBeUndefined();
      expect(upstreamReceivedHeaders[0]?.authorization).toBeUndefined();

      // 4. Logged-in routes get raw SPA index.html (never server-rendered!)
      for (const spaPath of ['/dashboard', '/activities', '/settings', '/admin']) {
        const spaRes = await fetch(`${baseUrl}${spaPath}`);
        expect(spaRes.status).toBe(200);
        const spaHtml = await spaRes.text();
        expect(spaHtml).not.toContain('data-ssr-public="true"');
        expect(spaHtml).not.toContain('id="__BSLT_STATE__"');
        expect(spaHtml).toContain('src="/assets/main-111111.js"');
      }

      // 5. Runtime /sitemap.xml and /robots.txt
      const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
      expect(sitemapRes.status).toBe(200);
      const sitemapBody = await sitemapRes.text();
      expect(sitemapBody).toContain('<loc>https://app.bslt.dev/terms</loc>');

      const robotsRes = await fetch(`${baseUrl}/robots.txt`);
      expect(robotsRes.status).toBe(200);
      expect(await robotsRes.text()).toContain('Sitemap: https://app.bslt.dev/sitemap.xml');
    } finally {
      await new Promise<void>((resolve) => {
        fakeApiServer.close(() => {
          resolve();
        });
      });
    }
  });

  it('prerenders cacheSeconds = Infinity routes via prerenderStaticPublicRoutes while preserving _spa.html for SPA fallback', async () => {
    const clientDir = createTempClientDist();
    const written = await prerenderStaticPublicRoutes({
      clientDir,
      siteUrl: 'https://app.bslt.dev',
    });

    expect(written).toEqual(
      expect.arrayContaining([
        '_spa.html',
        'index.html',
        'cookies/index.html',
        'acceptable-use/index.html',
        'disclaimer/index.html',
        'robots.txt',
        'sitemap.xml',
      ]),
    );
    // Dynamic cacheSeconds < Infinity routes are rendered at request time, not frozen at build time
    expect(written).not.toContain('status/index.html');
    expect(written).not.toContain('terms/index.html');

    const landingHtml = readFileSync(path.join(clientDir, 'index.html'), 'utf8');
    expect(landingHtml).toContain('Clone-and-own SaaS starter');
    expect(landingHtml).toContain('data-ssr-public="true"');
    expect(landingHtml).toContain('src="/assets/public-222222.js"');

    const spaTemplate = readFileSync(path.join(clientDir, '_spa.html'), 'utf8');
    expect(spaTemplate).not.toContain('data-ssr-public="true"');
    expect(spaTemplate).toContain('src="/assets/main-111111.js"');
  });
});
