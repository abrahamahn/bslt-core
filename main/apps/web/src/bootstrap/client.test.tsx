// main/apps/web/src/bootstrap/client.test.tsx
import { tokenStore } from '@bslt/client-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Mocks — everything bootstrapClientApp reaches on its way to the DOM
// ============================================================================

const { createRoot, hydrateRoot } = vi.hoisted(() => ({
  createRoot: vi.fn((_container: Element) => ({ render: vi.fn(), unmount: vi.fn() })),
  hydrateRoot: vi.fn(),
}));

// hydrateRoot is mocked even though client.tsx no longer imports it: the test
// below asserts it is never called, and an assertion against a symbol nobody
// could reach would pass for the wrong reason.
vi.mock('react-dom/client', () => ({ createRoot, hydrateRoot }));

vi.mock('#app/app/App', () => ({
  App: vi.fn((): ReactElement => <div data-testid="app">App</div>),
}));

vi.mock('#app/lib/errorReporter', () => ({
  reportError: vi.fn(() => true),
  startErrorReporter: vi.fn(() => vi.fn()),
}));

vi.mock('#app/utils/registerServiceWorker', () => ({
  registerServiceWorker: vi.fn().mockResolvedValue({ status: 'registered' }),
  unregisterAllServiceWorkers: vi.fn().mockResolvedValue([]),
}));

// Partial: the real module registers user-scoped resets that other modules in the
// import graph depend on. Only the auth service is faked, so bootstrap never
// reaches the network.
vi.mock('@bslt/identity/web', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bslt/identity/web')>()),
  createAuthService: vi.fn(() => ({
    getState: vi.fn(() => ({ user: null, isLoading: false, isAuthenticated: false })),
    subscribe: vi.fn(() => vi.fn()),
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  })),
}));

import {
  UNCAUGHT_ERROR_EVENT,
  bootstrapClientApp,
  reportUncaughtErrors,
  resolveDocumentTitle,
} from './client';
import { SPLASH_ELEMENT_ID, SPLASH_FADE_OUT_MS, SPLASH_FAILSAFE_MS } from './splash';

import type { ReactElement } from 'react';

import { reportError, startErrorReporter } from '#app/lib/errorReporter';

// ============================================================================
// Helpers
// ============================================================================

function visit(path: string): void {
  window.history.replaceState({}, '', path);
}

/** The splash, which index.html ships as a SIBLING of #root — never inside it. */
const SPLASH = `<div id="${SPLASH_ELEMENT_ID}" aria-hidden="true"><div class="app-splash__mark"></div></div>`;

function splash(): HTMLElement | null {
  return document.getElementById(SPLASH_ELEMENT_ID);
}

/** The SPA shell, as index.html ships it before the prerenderer touches it. */
function mountSpaShell(): HTMLElement {
  document.head.innerHTML = '<title data-default-title>BSLT</title>';
  document.body.innerHTML = `<div id="root"></div>${SPLASH}`;

  const root = document.getElementById('root');
  if (root === null) throw new Error('no root');
  return root;
}

/**
 * A prerendered page carrying its own <title>, canonical link, and
 * data-prerendered marker on #root.
 */
function mountPrerenderedPage(routePath: string, title: string): HTMLElement {
  document.head.innerHTML = `<title>${title}</title><link rel="canonical" href="${routePath}">`;
  document.body.innerHTML = `<div id="root" data-prerendered="true"><main id="prerendered-page">${title}</main></div>${SPLASH}`;

  const root = document.getElementById('root');
  if (root === null) throw new Error('no root');
  return root;
}

// ============================================================================
// Tests
// ============================================================================

describe('bootstrapClientApp', () => {
  beforeEach(() => {
    createRoot.mockClear();
    hydrateRoot.mockClear();
    visit('/');
  });

  it('mounts fresh on an SPA route', () => {
    const root = mountSpaShell();

    bootstrapClientApp();

    expect(createRoot).toHaveBeenCalledWith(root);
  });

  it('DROPS prerendered markup and mounts fresh — it never hydrates it', () => {
    // The prerendered markup is the page WITHOUT the app shell; the client renders
    // the shell. Hydrating one against the other throws a mismatch and re-renders
    // from scratch anyway, with a console full of errors. Mount fresh instead.
    visit('/terms');
    const root = mountPrerenderedPage('/terms', 'Terms of Service');

    bootstrapClientApp();

    expect(hydrateRoot).not.toHaveBeenCalled();
    expect(createRoot).toHaveBeenCalledWith(root);
    // The stale tree is gone before React ever sees the container.
    expect(document.getElementById('prerendered-page')).toBeNull();
    expect(root.firstElementChild).toBeNull();
  });

  it('drops the landing page markup the SPA fallback served for another route', () => {
    // nginx serves index.html — the prerendered LANDING page — for every route it
    // has no file for. On /dashboard the visitor is looking at /'s markup.
    visit('/dashboard');
    const root = mountPrerenderedPage('/', 'Home');

    bootstrapClientApp();

    expect(hydrateRoot).not.toHaveBeenCalled();
    expect(root.firstElementChild).toBeNull();
  });

  it('starts the error reporter once, over the app transport', async () => {
    // The sender must POST without the access token: the route is public, and a
    // crash report is no reason to send a bearer credential.
    mountSpaShell();
    vi.mocked(startErrorReporter).mockClear();
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchSpy);
    tokenStore.set('signed-in-access-token');
    try {
      bootstrapClientApp();

      expect(startErrorReporter).toHaveBeenCalledTimes(1);
      const send = vi.mocked(startErrorReporter).mock.calls[0]?.[0];
      const reports = [{ source: 'error', name: 'Error', message: 'boom', path: '/' }] as const;
      await send?.(reports);

      const [url, init] = fetchSpy.mock.calls.at(-1) ?? [];
      expect(url).toMatch(/\/api\/platform\/errors$/u);
      expect(init?.method).toBe('POST');
      expect(init?.keepalive).toBe(true);
      expect(init?.body).toBe(JSON.stringify({ reports }));
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
    } finally {
      tokenStore.clear();
      vi.unstubAllGlobals();
    }
  });

  it('leaves the splash alone when it drops the prerendered markup', () => {
    // The splash is a sibling of #root precisely so that clearing the root — the
    // §1.7 fix above — cannot take it with it, and so that React never has to
    // reconcile against it.
    visit('/terms');
    mountPrerenderedPage('/terms', 'Terms of Service');

    bootstrapClientApp();

    expect(splash()).not.toBeNull();
    expect(document.getElementById('root')?.contains(splash())).toBe(false);
  });
});

describe('bootstrapClientApp — the splash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createRoot.mockClear();
    visit('/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals the app once React has put the first route on screen', async () => {
    const root = mountSpaShell();
    createRoot.mockImplementationOnce((container: Element) => ({
      render: vi.fn(() => {
        container.appendChild(document.createElement('main'));
      }),
      unmount: vi.fn(),
    }));

    bootstrapClientApp();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SPLASH_FADE_OUT_MS);

    expect(root.firstElementChild).not.toBeNull();
    expect(splash()).toBeNull();
  });

  it('reveals the app even when it NEVER mounts — the splash cannot outlive it', async () => {
    // createRoot is mocked here, so nothing is ever rendered into #root: the
    // "first route on screen" signal can never arrive. This is a stand-in for the
    // production versions of the same thing — a chunk that 404s, a render that
    // throws — and in every one of them the failsafe is the only way out. A
    // bootstrap that wires the signals but no ceiling fails here.
    mountSpaShell();

    bootstrapClientApp();

    await vi.advanceTimersByTimeAsync(SPLASH_FAILSAFE_MS - 1);
    expect(splash()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1 + SPLASH_FADE_OUT_MS);
    expect(splash()).toBeNull();
  });
});

describe('resolveDocumentTitle', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    visit('/');
  });

  it('uses the configured app name on an SPA route', () => {
    document.head.innerHTML = '<title data-default-title>BSLT</title>';

    expect(resolveDocumentTitle('Acme Console')).toBe('Acme Console');
  });

  it('keeps the title a prerendered page brought with it', () => {
    // The point of prerendering /terms is that its title says "Terms of Service".
    // A bundle that overwrites it with the app name on mount hands the crawler a
    // site where every page is called "Acme Console".
    visit('/terms');
    mountPrerenderedPage('/terms', 'Terms of Service');

    expect(resolveDocumentTitle('Acme Console')).toBe('Terms of Service');
  });

  it('keeps it when the path is the same page with a trailing slash', () => {
    visit('/terms/');
    mountPrerenderedPage('/terms', 'Terms of Service');

    expect(resolveDocumentTitle('Acme Console')).toBe('Terms of Service');
  });

  it('IGNORES a prerendered title the SPA fallback served for another route', () => {
    // /dashboard has no prerendered file, so nginx serves index.html — the landing
    // page, titled "Home". Trusting that title names every unprerendered route in
    // the product "Home".
    visit('/dashboard');
    mountPrerenderedPage('/', 'Home');

    expect(resolveDocumentTitle('Acme Console')).toBe('Acme Console');
  });

  it('falls back to the app name when the document has no usable title', () => {
    mountPrerenderedPage('/', '   ');

    expect(resolveDocumentTitle('Acme Console')).toBe('Acme Console');
  });
});

/**
 * These are the errors an ErrorBoundary cannot see: it catches throws during
 * RENDER, not a rejected promise in a handler or a failed dynamic import. They
 * are re-broadcast and handed to the error reporter.
 *
 * Assertions match on the specific error object rather than on array length:
 * `bootstrapClientApp` registers its own permanent listener, so by this point
 * in the file a dispatch can be re-broadcast more than once. What matters is
 * that the event carrying THIS error arrives (or does not).
 */
describe('reportUncaughtErrors', () => {
  function collect(): { seen: { error: unknown; source: string }[]; stop: () => void } {
    const seen: { error: unknown; source: string }[] = [];
    const listener = (e: Event): void => {
      seen.push((e as CustomEvent<{ error: unknown; source: string }>).detail);
    };
    window.addEventListener(UNCAUGHT_ERROR_EVENT, listener);
    return { seen, stop: () => window.removeEventListener(UNCAUGHT_ERROR_EVENT, listener) };
  }

  it('re-broadcasts an uncaught error', () => {
    const cleanup = reportUncaughtErrors();
    const { seen, stop } = collect();

    const boom = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error: boom }));

    expect(seen.some((d) => d.error === boom && d.source === 'error')).toBe(true);
    stop();
    cleanup();
  });

  /**
   * A failed <img> or <script> fires an `error` event with no `event.error`.
   * Reporting those as crashes buries the ones that are.
   */
  it('ignores resource-load errors that carry no error object', () => {
    const cleanup = reportUncaughtErrors();
    const { seen, stop } = collect();

    window.dispatchEvent(new ErrorEvent('error'));

    expect(seen).toEqual([]);
    stop();
    cleanup();
  });

  it('re-broadcasts an unhandled promise rejection', () => {
    const cleanup = reportUncaughtErrors();
    const { seen, stop } = collect();

    // jsdom does not construct PromiseRejectionEvent, so the shape is built by
    // hand — the listener only reads `reason`.
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    const nope = new Error('nope');
    event.reason = nope;
    window.dispatchEvent(event);

    expect(seen.some((d) => d.error === nope && d.source === 'unhandledrejection')).toBe(true);
    stop();
    cleanup();
  });

  it('reports an uncaught error with the script it came from', () => {
    const cleanup = reportUncaughtErrors();
    vi.mocked(reportError).mockClear();

    const boom = new Error('reported');
    const filename = 'https://app.example/assets/index.js';
    window.dispatchEvent(new ErrorEvent('error', { error: boom, filename }));

    expect(reportError).toHaveBeenCalledWith(boom, 'error', filename);
    cleanup();
  });

  it('reports an unhandled rejection', () => {
    const cleanup = reportUncaughtErrors();
    vi.mocked(reportError).mockClear();

    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    const nope = new Error('rejected');
    event.reason = nope;
    window.dispatchEvent(event);

    expect(reportError).toHaveBeenCalledWith(nope, 'unhandledrejection');
    cleanup();
  });

  it('reports nothing for a resource-load error with no error object', () => {
    const cleanup = reportUncaughtErrors();
    vi.mocked(reportError).mockClear();

    window.dispatchEvent(new ErrorEvent('error'));

    expect(reportError).not.toHaveBeenCalled();
    cleanup();
  });

  it('removes both listeners on cleanup', () => {
    const remove = vi.spyOn(window, 'removeEventListener');

    reportUncaughtErrors()();

    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('error');
    expect(removed).toContain('unhandledrejection');
    remove.mockRestore();
  });
});
