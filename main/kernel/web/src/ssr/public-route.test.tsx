// main/kernel/web/src/ssr/public-route.test.tsx
import { createEndpointClient } from '@bslt/client-engine';
import { defineModule, endpoint } from '@bslt/contract';
import { useEndpoint, useTransport } from '@bslt/react';
import { object, string } from '@bslt/schema';
import { act, fireEvent } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnonymousSdkViolationError,
  applyClientHeadTags,
  buildRobotsTxt,
  buildRuntimeSitemapXml,
  createAnonymousSdk,
  definePublicRoute,
  formatHeadTags,
  hydratePublic,
  renderPublic,
  serializeDehydratedState,
  SSR_STATE_ELEMENT_ID,
  type AnonymousSdk,
  type AnonymousSdkForModules,
  type HeadTags,
  type SsrEnv,
  type SsrResult,
} from './public-route';

const statusSummarySchema = object({
  status: string({ min: 1 }),
  headline: string({ min: 1 }),
});

const secretSchema = object({
  secret: string({ min: 1 }),
});

const statusTestModule = defineModule({
  id: 'status',
  summary: 'Test status module for SSR seam.',
  status: 'stable',
  dependsOn: [],
  endpoints: {
    getSummary: endpoint({
      method: 'GET',
      path: '/api/status',
      auth: 'public',
      cache: { public: 30 },
      response: statusSummarySchema,
      summary: 'Public cached status summary.',
    }),
    pingUncached: endpoint({
      method: 'GET',
      path: '/api/status/ping',
      auth: 'public',
      response: statusSummarySchema,
      summary: 'Public but uncached endpoint (not eligible for AnonymousSdk).',
    }),
    adminSecret: endpoint({
      method: 'GET',
      path: '/api/status/secret',
      auth: 'admin',
      response: secretSchema,
      summary: 'Admin-only endpoint.',
    }),
  },
  events: {},
  jobs: {},
  tables: [],
});

const TEST_MODULES = [statusTestModule] as const;
type TestAnonymousSdk = AnonymousSdkForModules<typeof TEST_MODULES>;

const TEMPLATE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <!--ssr-head-->
    <title data-default-title>BSLT</title>
  </head>
  <body>
    <div id="root"><!--ssr-outlet--></div>
    <div id="app-splash" aria-hidden="true"></div>
    <script type="module" crossorigin src="/assets/main-abc123.js"></script>
  </body>
</html>`;

function StatusConsumerComponent({
  data,
}: {
  readonly data: { readonly label: string };
}): ReactElement {
  const transport = useTransport();
  const client = createEndpointClient(statusTestModule, transport);
  const query = useEndpoint(client.getSummary, undefined, { retry: 0, staleTime: 30_000 });
  const [clicks, setClicks] = useState(0);

  return (
    <article data-testid="status-article">
      <h1>{data.label}</h1>
      <p data-testid="query-headline">{query.data?.headline ?? 'loading'}</p>
      <button
        type="button"
        onClick={() => {
          setClicks((n) => n + 1);
        }}
      >
        {`Clicks: ${String(clicks)}`}
      </button>
    </article>
  );
}

describe('public-route SSR seam', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('AnonymousSdk adversarial isolation', () => {
    it('exposes public cached endpoints with credentials: "omit" and rejects non-public, uncached, or cookie-bearing calls', async () => {
      const seenCalls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
      const fakeFetch: typeof fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        seenCalls.push({
          url: typeof input === 'string' ? input : input.toString(),
          init,
        });
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'healthy', headline: 'All green' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      });

      const sdk = createAnonymousSdk(TEST_MODULES, {
        baseUrl: 'http://api.internal:8080',
        fetchImpl: fakeFetch,
      });
      const genericSdk: AnonymousSdk = sdk;
      const sampleHead: HeadTags = { title: 'Status' };
      const sampleEnv: SsrEnv = { apiInternalUrl: 'http://api.internal:8080', siteUrl: null };
      const sampleResultShape: Pick<SsrResult, 'status'> = { status: 200 };
      expect(typeof genericSdk['status']).toBe('object');
      expect(sampleHead.title).toBe('Status');
      expect(sampleEnv.siteUrl).toBeNull();
      expect(sampleResultShape.status).toBe(200);

      const result = await sdk.status.getSummary();
      expect(result).toEqual({ status: 'healthy', headline: 'All green' });
      expect(seenCalls).toHaveLength(1);
      expect(seenCalls[0]?.url).toBe('http://api.internal:8080/api/status');
      expect(seenCalls[0]?.init?.credentials).toBe('omit');
      const sentHeaders = new Headers(seenCalls[0]?.init?.headers);
      expect(sentHeaders.has('cookie')).toBe(false);
      expect(sentHeaders.has('authorization')).toBe(false);

      // Runtime proxy blocks access to auth !== 'public' endpoints
      expect(() => {
        const unsafeModule = sdk.status as unknown as Record<string, unknown>;
        return unsafeModule['adminSecret'];
      }).toThrow(AnonymousSdkViolationError);

      // Runtime proxy blocks access to auth === 'public' endpoints without cache.public
      expect(() => {
        const unsafeModule = sdk.status as unknown as Record<string, unknown>;
        return unsafeModule['pingUncached'];
      }).toThrow(AnonymousSdkViolationError);

      // Runtime proxy blocks access to undeclared modules
      expect(() => {
        const unsafeSdk = sdk as unknown as Record<string, unknown>;
        return unsafeSdk['identity'];
      }).toThrow(AnonymousSdkViolationError);

      // Rejects caller attempts to smuggle Cookie, Authorization, CSRF, or sudo headers
      await expect(
        sdk.status.getSummary(undefined, { headers: { Cookie: 'bslt_refresh=secret' } }),
      ).rejects.toThrow(AnonymousSdkViolationError);
      await expect(
        sdk.status.getSummary(undefined, { headers: { Authorization: 'Bearer tok' } }),
      ).rejects.toThrow(AnonymousSdkViolationError);
      await expect(
        sdk.status.getSummary(undefined, { headers: { 'x-csrf-token': 'csrf' } }),
      ).rejects.toThrow(AnonymousSdkViolationError);
      await expect(
        sdk.status.getSummary(undefined, { headers: { 'x-sudo-token': 'sudo' } }),
      ).rejects.toThrow(AnonymousSdkViolationError);
    });
  });

  describe('definePublicRoute & head/state sanitization', () => {
    it('rejects malformed paths and invalid cacheSeconds', () => {
      expect(() =>
        definePublicRoute({
          path: 'status' as `/${string}`,
          cacheSeconds: 30,
          load: () => Promise.resolve({}),
          head: () => ({ title: 'Bad' }),
          Component: () => <p>x</p>,
        }),
      ).toThrow(/must start with "\/"/u);

      expect(() =>
        definePublicRoute({
          path: '/bad path',
          cacheSeconds: 30,
          load: () => Promise.resolve({}),
          head: () => ({ title: 'Bad' }),
          Component: () => <p>x</p>,
        }),
      ).toThrow(/whitespace/u);

      expect(() =>
        definePublicRoute({
          path: '/status',
          cacheSeconds: -5,
          load: () => Promise.resolve({}),
          head: () => ({ title: 'Bad' }),
          Component: () => <p>x</p>,
        }),
      ).toThrow(/cacheSeconds/u);

      expect(() =>
        definePublicRoute({
          path: '/status',
          cacheSeconds: Number.NaN,
          load: () => Promise.resolve({}),
          head: () => ({ title: 'Bad' }),
          Component: () => <p>x</p>,
        }),
      ).toThrow(/cacheSeconds/u);
    });

    it('escapes HTML-breaking sequences in dehydrated state and omits relative canonicals', () => {
      const serialized = serializeDehydratedState({
        routePath: '/status',
        urlPathname: '/status',
        data: { xss: '</script><script>alert("owned")</script><!--boom-->&' },
        queries: [],
      });

      // Only the outer closing </script> tag exists; inner payload tags are unicode-escaped
      expect(serialized.match(/<\/script>/giu)).toHaveLength(1);
      expect(serialized).not.toContain('<script>alert');
      expect(serialized).not.toContain('<!--');
      expect(serialized).toContain('\\u003c/script\\u003e');

      const headWithoutOrigin = formatHeadTags(
        {
          title: 'Terms <Draft>',
          description: 'Read "carefully"',
          canonical: '/terms',
        },
        { siteUrl: null, pathname: '/terms', appName: 'BSLT' },
      );
      expect(headWithoutOrigin).toContain('<title>Terms &lt;Draft&gt; · BSLT</title>');
      expect(headWithoutOrigin).toContain('property="og:site_name" content="BSLT"');
      expect(headWithoutOrigin).toContain('name="twitter:card" content="summary"');
      expect(headWithoutOrigin).not.toContain('rel="canonical"');
      expect(headWithoutOrigin).not.toContain('og:url');

      // Does not duplicate appName when title already matches or contains it
      const exactAppHead = formatHeadTags(
        { title: 'BSLT', description: 'Root landing' },
        { siteUrl: null, pathname: '/', appName: 'BSLT' },
      );
      expect(exactAppHead).toContain('<title>BSLT</title>');

      const customAppHead = formatHeadTags(
        { title: 'Status' },
        { siteUrl: null, pathname: '/status', appName: 'Acme' },
      );
      expect(customAppHead).toContain('<title>Status · Acme</title>');

      const statusHeadWithOrigin = formatHeadTags(
        {
          title: 'System Status · BSLT',
          description: 'Live health summary',
        },
        { siteUrl: 'https://app.bslt.dev', pathname: '/status', appName: 'BSLT' },
      );
      expect(statusHeadWithOrigin).toContain('<title>System Status · BSLT</title>');
      expect(statusHeadWithOrigin).toContain(
        'property="og:image" content="https://app.bslt.dev/brand/og-image.png"',
      );
      expect(statusHeadWithOrigin).toContain('name="twitter:card" content="summary_large_image"');
      expect(statusHeadWithOrigin).toContain('name="twitter:title" content="System Status · BSLT"');

      applyClientHeadTags(
        document,
        {
          title: 'Dashboard',
          description: 'Workspace overview',
          robots: 'noindex, nofollow',
        },
        { appName: 'BSLT', siteUrl: 'https://app.bslt.dev', pathname: '/dashboard' },
      );
      expect(document.title).toBe('Dashboard · BSLT');
      expect(
        document.head.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      ).toBe('https://app.bslt.dev/brand/og-image.png');
      expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
        'Workspace overview',
      );
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex, nofollow',
      );
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://app.bslt.dev/dashboard',
      );

      // Navigating to a public page clears stale noindex robots tag
      applyClientHeadTags(
        document,
        { title: 'System Status · BSLT', description: 'Live health' },
        { appName: 'BSLT', siteUrl: 'https://app.bslt.dev', pathname: '/status' },
      );
      expect(document.title).toBe('System Status · BSLT');
      expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
      expect(headWithoutOrigin).not.toContain('application/ld+json');

      const headWithOrigin = formatHeadTags(
        {
          title: 'Terms',
          description: 'Legal terms.',
          ogImage: 'https://app.bslt.dev/og.png',
          twitterCard: 'summary_large_image',
          robots: 'index,follow',
        },
        { siteUrl: 'https://app.bslt.dev/', pathname: '/terms', appName: 'BSLT' },
      );
      expect(headWithOrigin).toContain('<link rel="canonical" href="https://app.bslt.dev/terms">');
      expect(headWithOrigin).toContain(
        '<meta property="og:url" content="https://app.bslt.dev/terms">',
      );
      expect(headWithOrigin).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(headWithOrigin).toContain('<meta name="robots" content="index,follow">');
      expect(headWithOrigin).toContain('application/ld+json');
    });
  });

  describe('renderPublic & logged-in route exclusion', () => {
    const statusRoute = definePublicRoute<{ readonly label: string }, TestAnonymousSdk>({
      path: '/status',
      cacheSeconds: 30,
      load: async ({ sdk }) => {
        const res = await sdk.status.getSummary();
        return { label: `System: ${res.status}` };
      },
      head: (data) => ({
        title: data.label,
        description: 'Live status overview.',
      }),
      Component: StatusConsumerComponent,
    });

    it('never server-renders logged-in or unlisted SPA routes', async () => {
      const fetchSpy = vi.fn();
      for (const privatePath of ['/dashboard', '/tasks', '/settings', '/admin/users', '/login']) {
        const res = await renderPublic(
          new URL(`https://app.bslt.dev${privatePath}`),
          [statusRoute],
          {
            apiInternalUrl: 'http://api.internal:8080',
            siteUrl: 'https://app.bslt.dev',
            modules: TEST_MODULES,
            fetchImpl: fetchSpy as unknown as typeof fetch,
            template: TEMPLATE_HTML,
          },
        );
        expect(res).toBeNull();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws when template markers are missing or Component renders an empty shell', async () => {
      const emptyRoute = definePublicRoute({
        path: '/empty',
        cacheSeconds: Infinity,
        load: () => Promise.resolve({}),
        head: () => ({ title: 'Empty' }),
        Component: () => null,
      });

      await expect(
        renderPublic(new URL('https://app.bslt.dev/empty'), [emptyRoute], {
          apiInternalUrl: 'http://api.internal:8080',
          siteUrl: 'https://app.bslt.dev',
          modules: TEST_MODULES,
          template: TEMPLATE_HTML,
        }),
      ).rejects.toThrow(/empty/iu);

      await expect(
        renderPublic(new URL('https://app.bslt.dev/status'), [statusRoute], {
          apiInternalUrl: 'http://api.internal:8080',
          siteUrl: 'https://app.bslt.dev',
          modules: TEST_MODULES,
          fetchImpl: () =>
            Promise.resolve(
              new Response(JSON.stringify({ status: 'healthy', headline: 'OK' }), { status: 200 }),
            ),
          template: '<html><body><div id="root"></div></body></html>',
        }),
      ).rejects.toThrow(/<!--ssr-head-->/u);
    });

    it('isolates per-request QueryCache across concurrent renderPublic calls', async () => {
      let callIndex = 0;
      const concurrentFetch: typeof fetch = vi.fn(async () => {
        const myIndex = ++callIndex;
        if (myIndex === 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        return new Response(
          JSON.stringify({
            status: myIndex === 1 ? 'degraded' : 'healthy',
            headline: `Headline-${String(myIndex)}`,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const [first, second] = await Promise.all([
        renderPublic(new URL('https://app.bslt.dev/status'), [statusRoute], {
          apiInternalUrl: 'http://api.internal:8080',
          siteUrl: 'https://app.bslt.dev',
          modules: TEST_MODULES,
          fetchImpl: concurrentFetch,
          template: TEMPLATE_HTML,
        }),
        renderPublic(new URL('https://app.bslt.dev/status'), [statusRoute], {
          apiInternalUrl: 'http://api.internal:8080',
          siteUrl: 'https://app.bslt.dev',
          modules: TEST_MODULES,
          fetchImpl: concurrentFetch,
          template: TEMPLATE_HTML,
        }),
      ]);

      expect(first?.html).toContain('System: degraded');
      expect(first?.html).toContain('Headline-1');
      expect(first?.html).not.toContain('Headline-2');

      expect(second?.html).toContain('System: healthy');
      expect(second?.html).toContain('Headline-2');
      expect(second?.html).not.toContain('Headline-1');
    });

    it('renders full content, head tags, dehydrated state, public entry assets, and hydrates with zero remount', async () => {
      const serverFetch: typeof fetch = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ status: 'healthy', headline: 'All 5 subsystems nominal' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );

      const rendered = await renderPublic(new URL('https://app.bslt.dev/status'), [statusRoute], {
        apiInternalUrl: 'http://api.internal:8080',
        siteUrl: 'https://app.bslt.dev',
        modules: TEST_MODULES,
        fetchImpl: serverFetch,
        template: TEMPLATE_HTML,
        publicEntryScripts: ['/assets/entry-public-xyz987.js'],
        publicEntryStyles: ['/assets/entry-public-xyz987.css'],
        Shell: ({ children }) => (
          <div data-shell="public">
            <main id="main-content">{children}</main>
          </div>
        ),
      });

      expect(rendered).not.toBeNull();
      expect(rendered?.cacheControl).toBe(
        'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
      );
      expect(rendered?.html).toContain('<title>System: healthy · BSLT</title>');
      expect(rendered?.html).not.toContain('data-default-title');
      expect(rendered?.html).toContain('<link rel="canonical" href="https://app.bslt.dev/status">');
      expect(rendered?.html).toContain(`id="${SSR_STATE_ELEMENT_ID}"`);
      expect(rendered?.html).toContain('All 5 subsystems nominal');
      expect(rendered?.html).toContain('src="/assets/entry-public-xyz987.js"');
      expect(rendered?.html).toContain('href="/assets/entry-public-xyz987.css"');
      expect(rendered?.html).not.toContain('src="/assets/main-abc123.js"');

      // Mount exact server HTML into JSDOM and hydrate without calling the network
      const parsedDoc = new DOMParser().parseFromString(rendered?.html ?? '', 'text/html');
      document.head.innerHTML = parsedDoc.head.innerHTML;
      document.body.innerHTML = parsedDoc.body.innerHTML;
      window.history.replaceState({}, '', '/status');

      const rootEl = document.getElementById('root');
      if (rootEl === null) throw new Error('missing #root');
      const serverHeadingBeforeHydration = rootEl.querySelector('h1');
      const serverParagraphBeforeHydration = rootEl.querySelector('[data-testid="query-headline"]');
      expect(serverHeadingBeforeHydration?.textContent).toBe('System: healthy');
      expect(serverParagraphBeforeHydration?.textContent).toBe('All 5 subsystems nominal');
      expect(document.getElementById('app-splash')).not.toBeNull();

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const clientFetchSpy = vi.fn();

      let handle: ReturnType<typeof hydratePublic> | undefined;
      await act(async () => {
        handle = hydratePublic(rootEl, [statusRoute], {
          modules: TEST_MODULES,
          apiBaseUrl: 'https://app.bslt.dev',
          fetchImpl: clientFetchSpy as unknown as typeof fetch,
          Shell: ({ children }) => (
            <div data-shell="public">
              <main id="main-content">{children}</main>
            </div>
          ),
        });
        await Promise.resolve();
      });

      // Splash skipped immediately, zero hydration errors, zero network refetch, zero DOM node replacement!
      expect(document.getElementById('app-splash')).toBeNull();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(clientFetchSpy).not.toHaveBeenCalled();
      expect(rootEl.querySelector('h1')).toBe(serverHeadingBeforeHydration);
      expect(rootEl.querySelector('[data-testid="query-headline"]')).toBe(
        serverParagraphBeforeHydration,
      );

      // Prove interactive client state is live on the hydrated tree without remounting h1
      const button = rootEl.querySelector('button');
      if (button === null) throw new Error('missing button');
      fireEvent.click(button);
      expect(button.textContent).toBe('Clicks: 1');
      expect(rootEl.querySelector('h1')).toBe(serverHeadingBeforeHydration);

      act(() => {
        handle?.unmount();
      });
    });

    it('strips Vite-emitted SPA modulepreload and stylesheet asset links while preserving icons/manifest and deduplicating public assets', async () => {
      const spaTemplateWithViteAssets = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/icons/favicon.svg" />
    <link rel="manifest" href="/manifest.json" />
    <!--ssr-head-->
    <title data-default-title>BSLT</title>
    <script type="module" crossorigin src="/assets/main-abc123.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/AuthPages-leak.js">
    <link rel="modulepreload" crossorigin href="/assets/DocsPage-leak.js">
    <link rel="stylesheet" crossorigin href="/assets/main-leak.css">
    <link href="/assets/reverse-order-leak.css" rel="stylesheet">
    <link rel="stylesheet" crossorigin href="/assets/entry-public-xyz987.css">
  </head>
  <body>
    <div id="root"><!--ssr-outlet--></div>
  </body>
</html>`;

      const rendered = await renderPublic(new URL('https://app.bslt.dev/status'), [statusRoute], {
        apiInternalUrl: 'http://api.internal:8080',
        siteUrl: 'https://app.bslt.dev',
        modules: TEST_MODULES,
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({ status: 'healthy', headline: 'All green' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        template: spaTemplateWithViteAssets,
        publicEntryScripts: ['/assets/entry-public-xyz987.js'],
        publicEntryModulePreloads: ['/assets/vendor-react-123.js', '/assets/vendor-react-123.js'],
        publicEntryStyles: ['/assets/entry-public-xyz987.css', '/assets/entry-public-xyz987.css'],
      });

      expect(rendered).not.toBeNull();
      const html = rendered?.html ?? '';
      // Leaked SPA JS/CSS links are completely stripped
      expect(html).not.toContain('/assets/main-abc123.js');
      expect(html).not.toContain('/assets/AuthPages-leak.js');
      expect(html).not.toContain('/assets/DocsPage-leak.js');
      expect(html).not.toContain('/assets/main-leak.css');
      expect(html).not.toContain('/assets/reverse-order-leak.css');
      // Non-asset document links survive untouched
      expect(html).toContain('href="/icons/favicon.svg"');
      expect(html).toContain('href="/manifest.json"');
      // Public entry script, preloads, and stylesheets are emitted once each
      expect(html).toContain('src="/assets/entry-public-xyz987.js"');
      expect(html.match(/\/assets\/vendor-react-123\.js/gu)).toHaveLength(1);
      expect(html.match(/\/assets\/entry-public-xyz987\.css/gu)).toHaveLength(1);
    });
  });

  describe('buildRuntimeSitemapXml & buildRobotsTxt', () => {
    it('rejects relative siteUrl or invalid dynamic sitemap paths and emits merged XML', async () => {
      const staticRoute = definePublicRoute({
        path: '/status',
        cacheSeconds: 30,
        load: () => Promise.resolve({}),
        head: () => ({ title: 'Status' }),
        Component: () => <p>Status</p>,
      });
      const dynamicRoute = definePublicRoute({
        path: '/p/:slug',
        cacheSeconds: 60,
        load: () => Promise.resolve({}),
        head: () => ({ title: 'Post' }),
        Component: () => <p>Post</p>,
        async *sitemap() {
          await Promise.resolve();
          yield { path: '/p/alpha' as const, lastmod: '2026-11-20' };
          yield { path: '/p/beta' as const };
        },
      });
      const badDynamicRoute = definePublicRoute({
        path: '/bad/:slug',
        cacheSeconds: 60,
        load: () => Promise.resolve({}),
        head: () => ({ title: 'Bad' }),
        Component: () => <p>Bad</p>,
        async *sitemap() {
          await Promise.resolve();
          yield { path: 'missing-slash' as `/${string}` };
        },
      });

      const sdk = createAnonymousSdk(TEST_MODULES, { baseUrl: 'http://api.internal:8080' });

      await expect(buildRuntimeSitemapXml('/relative', [staticRoute], sdk)).rejects.toThrow(
        /absolute http/iu,
      );
      await expect(
        buildRuntimeSitemapXml('https://app.bslt.dev', [badDynamicRoute], sdk),
      ).rejects.toThrow(/must start with "\/"/u);

      const xml = await buildRuntimeSitemapXml(
        'https://app.bslt.dev/',
        [staticRoute, dynamicRoute],
        sdk,
      );
      expect(xml).toContain('<loc>https://app.bslt.dev/status</loc>');
      expect(xml).toContain('<loc>https://app.bslt.dev/p/alpha</loc>');
      expect(xml).toContain('<lastmod>2026-11-20</lastmod>');
      expect(xml).toContain('<loc>https://app.bslt.dev/p/beta</loc>');
      expect(xml).not.toContain('/p/:slug');

      expect(buildRobotsTxt('https://app.bslt.dev/')).toBe(
        'User-agent: *\nAllow: /\n\nSitemap: https://app.bslt.dev/sitemap.xml\n',
      );
      expect(buildRobotsTxt(null)).toBe('User-agent: *\nAllow: /\n');
    });
  });
});
