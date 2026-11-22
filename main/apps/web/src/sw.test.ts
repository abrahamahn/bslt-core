// main/apps/web/src/sw.test.ts
/**
 * Adversarial unit tests for the real Service Worker (`main/apps/web/public/sw.js`).
 *
 * Verifies restructure plan §11.3 invariants:
 * - Caches ONLY fingerprinted static assets (plus install-time manifest/icon precache);
 * - Never caches un-fingerprinted JS/CSS, HTML documents, or `/api/*` responses;
 * - Honours `Cache-Control: no-store` and `Cache-Control: private` on every cache write;
 * - Clears all caches on `CLEAR_CACHE` (sent on logout);
 * - Rejects cross-origin `message` events and ignores non-GET / cross-origin fetches.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SW_PATH = path.resolve(THIS_DIR, '../public/sw.js');
const SW_SOURCE = readFileSync(SW_PATH, 'utf8');

class MockCache {
  readonly name: string;
  private readonly store = new Map<string, Response>();

  constructor(name: string) {
    this.name = name;
  }

  match(request: Request | string): Promise<Response | undefined> {
    return Promise.resolve(this.store.get(this.keyOf(request)));
  }

  put(request: Request | string, response: Response): Promise<void> {
    this.store.set(this.keyOf(request), response);
    return Promise.resolve();
  }

  async addAll(urls: readonly string[]): Promise<void> {
    await Promise.all(
      urls.map((url) => {
        const fullUrl = url.startsWith('http') ? url : `https://app.bslt.dev${url}`;
        return this.put(fullUrl, new Response('precached', { status: 200 }));
      }),
    );
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.store.keys()]);
  }

  size(): number {
    return this.store.size;
  }

  private keyOf(request: Request | string): string {
    if (typeof request === 'string') {
      return request.startsWith('http') ? request : `https://app.bslt.dev${request}`;
    }
    return request.url;
  }
}

class MockExtendableEvent {
  readonly type: string;
  private readonly pending: Array<Promise<unknown>> = [];

  constructor(type: string) {
    this.type = type;
  }

  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise);
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending);
  }
}

class MockFetchEvent extends MockExtendableEvent {
  readonly request: Request;
  responded = false;
  private responsePromise: Promise<Response> | null = null;

  constructor(request: Request) {
    super('fetch');
    this.request = request;
  }

  respondWith(response: Promise<Response> | Response): void {
    this.responded = true;
    this.responsePromise = Promise.resolve(response);
  }

  async resolveResponse(): Promise<Response | null> {
    await this.settle();
    return this.responsePromise === null ? null : await this.responsePromise;
  }
}

class MockClient {
  url: string;
  focused = false;
  readonly messages: unknown[] = [];

  constructor(url: string) {
    this.url = url;
  }

  focus(): Promise<MockClient> {
    this.focused = true;
    return Promise.resolve(this);
  }

  navigate(nextUrl: string): Promise<MockClient> {
    this.url = nextUrl.startsWith('http') ? nextUrl : `https://app.bslt.dev${nextUrl}`;
    return Promise.resolve(this);
  }

  postMessage(msg: unknown): void {
    this.messages.push(msg);
  }
}

interface ListenerMap {
  install: Array<(event: MockExtendableEvent) => void>;
  activate: Array<(event: MockExtendableEvent) => void>;
  fetch: Array<(event: MockFetchEvent) => void>;
  message: Array<
    (
      event: MockExtendableEvent & {
        data?: unknown;
        origin?: string;
        source?: unknown;
        ports?: ReadonlyArray<{ postMessage: (msg: unknown) => void }>;
      },
    ) => void
  >;
  push: Array<
    (
      event: MockExtendableEvent & {
        data: { json: () => unknown; text: () => string } | null;
      },
    ) => void
  >;
  notificationclick: Array<
    (
      event: MockExtendableEvent & {
        action: string;
        notification: { data?: unknown; close: () => void };
      },
    ) => void
  >;
  notificationclose: Array<(event: MockExtendableEvent & { notification: unknown }) => void>;
}

describe('Service Worker (public/sw.js)', () => {
  let cacheMap: Map<string, MockCache>;
  let listeners: ListenerMap;
  let mockFetch: ReturnType<typeof vi.fn<(input: Request | string) => Promise<Response>>>;
  let skipWaiting: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let claim: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let matchAll: ReturnType<typeof vi.fn<() => Promise<MockClient[]>>>;
  let openWindow: ReturnType<typeof vi.fn<(url: string) => Promise<MockClient>>>;
  let showNotification: ReturnType<
    typeof vi.fn<(title: string, options?: Record<string, unknown>) => Promise<void>>
  >;

  function totalCachedEntries(): number {
    let count = 0;
    for (const cache of cacheMap.values()) {
      count += cache.size();
    }
    return count;
  }

  beforeEach(() => {
    cacheMap = new Map();
    listeners = {
      install: [],
      activate: [],
      fetch: [],
      message: [],
      push: [],
      notificationclick: [],
      notificationclose: [],
    };

    const mockCaches = {
      open: vi.fn((name: string) => {
        let existing = cacheMap.get(name);
        if (existing === undefined) {
          existing = new MockCache(name);
          cacheMap.set(name, existing);
        }
        return Promise.resolve(existing);
      }),
      match: vi.fn(async (request: Request | string) => {
        for (const cache of cacheMap.values()) {
          const hit = await cache.match(request);
          if (hit !== undefined) return hit;
        }
        return undefined;
      }),
      keys: vi.fn(() => Promise.resolve([...cacheMap.keys()])),
      delete: vi.fn((name: string) => Promise.resolve(cacheMap.delete(name))),
    };

    mockFetch = vi.fn((input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      return Promise.resolve(
        new Response(`body:${url}`, {
          status: 200,
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
        }),
      );
    });

    skipWaiting = vi.fn(() => Promise.resolve());
    claim = vi.fn(() => Promise.resolve());
    matchAll = vi.fn(() => Promise.resolve([]));
    openWindow = vi.fn((url: string) => Promise.resolve(new MockClient(url)));
    showNotification = vi.fn(() => Promise.resolve());

    const mockSelf = {
      location: { origin: 'https://app.bslt.dev' },
      addEventListener: vi.fn((type: keyof ListenerMap, fn: (...args: never[]) => void) => {
        listeners[type].push(fn as never);
      }),
      skipWaiting,
      clients: {
        claim,
        matchAll,
        openWindow,
      },
      registration: {
        showNotification,
      },
    };

    // Execute the real Service Worker script against our isolated Worker global bindings
    const runner = new Function('self', 'caches', 'fetch', 'Response', 'URL', SW_SOURCE) as (
      selfArg: typeof mockSelf,
      cachesArg: typeof mockCaches,
      fetchArg: typeof mockFetch,
      ResponseArg: typeof Response,
      URLArg: typeof URL,
    ) => void;
    runner(mockSelf, mockCaches, mockFetch, Response, URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to intercept or cache un-fingerprinted JS, CSS, HTML, or API requests', async () => {
    const unFingerprintedUrls = [
      'https://app.bslt.dev/theme-init.js',
      'https://app.bslt.dev/sw.js',
      'https://app.bslt.dev/app.js',
      'https://app.bslt.dev/styles.css',
      'https://app.bslt.dev/',
      'https://app.bslt.dev/dashboard',
      'https://app.bslt.dev/index.html',
      'https://app.bslt.dev/api/users/me',
      'https://app.bslt.dev/api/status',
    ];

    for (const url of unFingerprintedUrls) {
      const event = new MockFetchEvent(new Request(url, { method: 'GET' }));
      for (const handler of listeners.fetch) handler(event);
      const res = await event.resolveResponse();
      if (res !== null) {
        expect(res.status).toBe(200);
      }
    }

    expect(totalCachedEntries()).toBe(0);
  });

  it('refuses to cache fingerprinted assets when response carries Cache-Control: no-store', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('console.log("secret")', {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }),
    );

    const event = new MockFetchEvent(
      new Request('https://app.bslt.dev/assets/entry-public-Ba9_X12z.js'),
    );
    for (const handler of listeners.fetch) handler(event);
    const response = await event.resolveResponse();

    expect(response?.status).toBe(200);
    expect(totalCachedEntries()).toBe(0);
  });

  it('refuses to cache fingerprinted assets when response carries Cache-Control: private', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('console.log("viewer-specific")', {
        status: 200,
        headers: { 'Cache-Control': 'private, max-age=31536000' },
      }),
    );

    const event = new MockFetchEvent(
      new Request('https://app.bslt.dev/assets/entry-public-Ba9_X12z.js'),
    );
    for (const handler of listeners.fetch) handler(event);
    const response = await event.resolveResponse();

    expect(response?.status).toBe(200);
    expect(totalCachedEntries()).toBe(0);
  });

  it('refuses to cache non-OK (404 / 500) responses for fingerprinted assets', async () => {
    for (const status of [404, 500]) {
      mockFetch.mockResolvedValueOnce(new Response('err', { status }));
      const event = new MockFetchEvent(
        new Request(`https://app.bslt.dev/assets/missing-${String(status)}abcd1234.js`),
      );
      for (const handler of listeners.fetch) handler(event);
      const response = await event.resolveResponse();
      expect(response?.status).toBe(status);
    }

    expect(totalCachedEntries()).toBe(0);
  });

  it('ignores non-GET requests and cross-origin asset requests', () => {
    const postEvent = new MockFetchEvent(
      new Request('https://app.bslt.dev/assets/entry-public-Ba9_X12z.js', { method: 'POST' }),
    );
    for (const handler of listeners.fetch) handler(postEvent);
    expect(postEvent.responded).toBe(false);

    const crossOriginEvent = new MockFetchEvent(
      new Request('https://cdn.evil.example/assets/entry-public-Ba9_X12z.js', { method: 'GET' }),
    );
    for (const handler of listeners.fetch) handler(crossOriginEvent);
    expect(crossOriginEvent.responded).toBe(false);
  });

  it('rejects cross-origin and sourceless CLEAR_CACHE / SKIP_WAITING messages', async () => {
    const firstFetch = new MockFetchEvent(
      new Request('https://app.bslt.dev/assets/entry-public-Ba9_X12z.js'),
    );
    for (const handler of listeners.fetch) handler(firstFetch);
    await firstFetch.resolveResponse();
    expect(totalCachedEntries()).toBe(1);

    // Cross-origin attacker
    const crossOriginMsg = Object.assign(new MockExtendableEvent('message'), {
      data: { type: 'CLEAR_CACHE' },
      origin: 'https://evil.example',
      source: {},
    });
    for (const handler of listeners.message) handler(crossOriginMsg);
    await crossOriginMsg.settle();
    expect(totalCachedEntries()).toBe(1);

    // Missing source
    const sourcelessMsg = Object.assign(new MockExtendableEvent('message'), {
      data: { type: 'SKIP_WAITING' },
      origin: 'https://app.bslt.dev',
      source: null,
    });
    for (const handler of listeners.message) handler(sourcelessMsg);
    expect(skipWaiting).not.toHaveBeenCalled();
  });

  it('caches fingerprinted assets on first GET and serves subsequent GETs from cache without network', async () => {
    const url = 'https://app.bslt.dev/assets/entry-public-Ba9_X12z.js';

    const first = new MockFetchEvent(new Request(url));
    for (const handler of listeners.fetch) handler(first);
    const res1 = await first.resolveResponse();
    expect(await res1?.text()).toBe(`body:${url}`);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(totalCachedEntries()).toBe(1);

    const second = new MockFetchEvent(new Request(url));
    for (const handler of listeners.fetch) handler(second);
    const res2 = await second.resolveResponse();
    expect(await res2?.text()).toBe(`body:${url}`);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clears all Service Worker caches on same-origin CLEAR_CACHE message (logout)', async () => {
    const installEvent = new MockExtendableEvent('install');
    for (const handler of listeners.install) handler(installEvent);
    await installEvent.settle();

    const assetFetch = new MockFetchEvent(
      new Request('https://app.bslt.dev/assets/vendor-react-9a8b7c6d.js'),
    );
    for (const handler of listeners.fetch) handler(assetFetch);
    await assetFetch.resolveResponse();

    expect(cacheMap.size).toBeGreaterThanOrEqual(2);
    expect(totalCachedEntries()).toBeGreaterThanOrEqual(4);

    const logoutMsg = Object.assign(new MockExtendableEvent('message'), {
      data: { type: 'CLEAR_CACHE' },
      origin: 'https://app.bslt.dev',
      source: {},
    });
    for (const handler of listeners.message) handler(logoutMsg);
    await logoutMsg.settle();

    expect(cacheMap.size).toBe(0);
    expect(totalCachedEntries()).toBe(0);
  });

  it('prunes stale cache versions on activate and claims clients', async () => {
    cacheMap.set('assets-v0', new MockCache('assets-v0'));
    cacheMap.set('api-v4', new MockCache('api-v4'));

    const activateEvent = new MockExtendableEvent('activate');
    for (const handler of listeners.activate) handler(activateEvent);
    await activateEvent.settle();

    expect(cacheMap.has('assets-v0')).toBe(false);
    expect(cacheMap.has('api-v4')).toBe(false);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('handles push notifications and notificationclick window navigation', async () => {
    // Null push data is ignored
    const emptyPush = Object.assign(new MockExtendableEvent('push'), { data: null });
    for (const handler of listeners.push) handler(emptyPush);
    expect(showNotification).not.toHaveBeenCalled();

    // JSON push payload displays notification
    const pushEvent = Object.assign(new MockExtendableEvent('push'), {
      data: {
        json: () => ({ title: 'Incident Resolved', body: 'API is healthy', url: '/status' }),
        text: () => 'Incident Resolved',
      },
    });
    for (const handler of listeners.push) handler(pushEvent);
    await pushEvent.settle();
    expect(showNotification).toHaveBeenCalledWith(
      'Incident Resolved',
      expect.objectContaining({ body: 'API is healthy' }),
    );

    // Notification click focuses existing same-origin client and navigates
    const existingClient = new MockClient('https://app.bslt.dev/');
    matchAll.mockResolvedValueOnce([existingClient]);
    const closeSpy = vi.fn();
    const clickEvent = Object.assign(new MockExtendableEvent('notificationclick'), {
      action: '',
      notification: {
        data: { url: '/status' },
        close: closeSpy,
      },
    });
    for (const handler of listeners.notificationclick) handler(clickEvent);
    await clickEvent.settle();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(existingClient.focused).toBe(true);
    expect(existingClient.url).toBe('https://app.bslt.dev/status');
  });
});
