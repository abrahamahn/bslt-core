// main/apps/web/src/bootstrap/client.tsx
/**
 * Shared client bootstrap for SPA and SSR entry points.
 *
 * Keeps environment creation, auth initialization, HMR cleanup, and
 * service-worker registration in one place so both entry files stay thin.
 */

import { QueryCache } from '@bslt/client-engine';
import { MS_PER_DAY, MS_PER_MINUTE } from '@bslt/shared/constants/time';
import { createAuthService } from '@features/auth';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { isWebCapabilityEnabled } from './generated/profile.generated';
import { revealAppWhenReady } from './splash';

import type { ClientEnvironment } from '@/app/ClientEnvironment';

import { App } from '@/app/App';
import { onTosRequired } from '@/app/tosHandler';
import { clientConfig } from '@/config';
import { startConsentSync } from '@/lib/consent';
import { gateSentryOnAnalyticsConsent, initSentry } from '@/lib/sentry';
import { registerServiceWorker, unregisterAllServiceWorkers } from '@/utils/registerServiceWorker';

import '@bslt/ui/styles/elements.css';

/** `/terms/` and `/terms` are the same page; the root stays `/`. */
function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/u, '') : path;
}

/**
 * The path this document was prerendered FOR, from its canonical link — or null
 * if it was not prerendered.
 *
 * It is not always the path being viewed. `/` prerenders to index.html, and
 * index.html is also the SPA fallback every unmatched route is served from, so a
 * visitor on /dashboard is looking at the landing page's document.
 */
function prerenderedPath(): string | null {
  const canonical = document.querySelector('link[rel="canonical"]');
  const href = canonical?.getAttribute('href') ?? null;

  return href === null ? null : normalizePath(href);
}

/**
 * The prerenderer replaces the SPA's placeholder `<title data-default-title>`
 * with the page's own. Keep it — overwriting "Terms of Service" with the app name
 * the moment the bundle runs is how a prerendered title survives the crawl and
 * dies in the render — but only when this document really is the page being
 * viewed, or every route served through the SPA fallback would be titled "Home".
 */
function readPrerenderedTitle(): string | null {
  if (prerenderedPath() !== normalizePath(window.location.pathname)) return null;

  const element = document.querySelector('title');
  if (element === null || element.hasAttribute('data-default-title')) return null;

  const title = element.textContent.trim();
  return title === '' ? null : title;
}

export function resolveDocumentTitle(appName: string): string {
  return readPrerenderedTitle() ?? appName;
}

interface BootstrappedEnvironment {
  readonly environment: ClientEnvironment;
  /** The session restore, for the splash to wait on. See `revealAppWhenReady`. */
  readonly authSettled: Promise<unknown>;
}

function createEnvironment(): BootstrappedEnvironment {
  const queryCache = new QueryCache({
    defaultStaleTime: 5 * MS_PER_MINUTE,
    defaultGcTime: MS_PER_DAY,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const auth = createAuthService({
    config: clientConfig,
    onTosRequired,
  });

  const environment: ClientEnvironment = {
    config: clientConfig,
    queryCache,
    auth,
  };

  // Non-blocking auth restore from refresh cookie. The app renders immediately;
  // only the splash waits on it, so a returning user does not watch the signed-out
  // shell flash past on the way to their dashboard.
  const authSettled = environment.auth.initialize();

  if (environment.config.isDev) {
    (window as unknown as { environment: ClientEnvironment }).environment = environment;
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      environment.auth.destroy();
      environment.queryCache.destroy();
    });
  }

  return { environment, authSettled };
}

function syncDocumentTitle(environment: ClientEnvironment): void {
  document.title = resolveDocumentTitle(environment.config.appName);
}

function registerPwaIfNeeded(environment: ClientEnvironment): void {
  if (environment.config.isDev) {
    void unregisterAllServiceWorkers().catch(() => {});
    return;
  }

  if (!isWebCapabilityEnabled('workers')) return;

  void registerServiceWorker({
    swPath: '/sw.js',
    scope: '/',
    immediate: false,
    callbacks: {
      onSuccess: (_registration) => {},
      onUpdate: (_info) => {},
      onError: (_error) => {},
    },
  });
}

/** Event name for errors that escape React's ErrorBoundary. */
export const UNCAUGHT_ERROR_EVENT = 'app:uncaught-error';

/**
 * Re-broadcast errors that never reach an ErrorBoundary.
 *
 * A boundary catches errors thrown while RENDERING. It cannot see a rejected
 * promise in an event handler, a failed dynamic import, or a throw inside
 * `setTimeout` — those reach `window` and stop there. With no error-tracking
 * DSN configured (the common dev and self-host case) they are then invisible.
 *
 * This does NOT log: the browser already prints both of these, and logging
 * again just doubles every entry in the console. It re-dispatches instead, so a
 * debug overlay, a test, or a future reporting endpoint has one event to
 * listen for regardless of whether a vendor SDK is present.
 *
 * @returns A cleanup function that removes both listeners
 */
export function reportUncaughtErrors(): () => void {
  const onError = (event: ErrorEvent): void => {
    // A failed <img> or <script> fires an `error` event with NO `event.error`.
    // Reporting those as crashes buries the ones that are.
    // `ErrorEvent.error` and `PromiseRejectionEvent.reason` are typed `any` by
    // the DOM lib; narrowed to `unknown` so nothing downstream inherits it.
    const error: unknown = event.error;
    if (error === null || error === undefined) return;
    window.dispatchEvent(
      new CustomEvent(UNCAUGHT_ERROR_EVENT, { detail: { error, source: 'error' } }),
    );
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    const error: unknown = event.reason;
    window.dispatchEvent(
      new CustomEvent(UNCAUGHT_ERROR_EVENT, {
        detail: { error, source: 'unhandledrejection' },
      }),
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export function bootstrapClientApp(): void {
  // Error capture is unconditional; tracing and session replay wait behind the
  // `analytics` consent gate, wired the moment the SDK is up (D3).
  void initSentry().then(gateSentryOnAnalyticsConsent);

  // Vendor-neutral, and deliberately not conditional on Sentry: with no DSN the
  // ErrorBoundary is the ONLY thing catching anything, and it cannot see
  // rejected promises or failed chunk loads.
  reportUncaughtErrors();

  // Before anything reads consent: applies a Global Privacy Control opt-out
  // and keeps the decision in sync across tabs — an opt-out made in one tab
  // must hold in every tab.
  startConsentSync();

  const { environment, authSettled } = createEnvironment();
  syncDocumentTitle(environment);

  const rootElement = document.getElementById('root');
  if (rootElement === null) throw new Error('Failed to find the root element');

  // A prerendered page is the DOCUMENT without the app shell (see
  // src/ssr/ServerApp.tsx); the client renders the whole shell around it. The two
  // trees do not match, so hydrating one against the other throws a mismatch and
  // re-renders from scratch anyway — slower than mounting fresh, and with a
  // console full of errors. Drop the markup and mount.
  if (rootElement.dataset['prerendered'] === 'true') {
    rootElement.replaceChildren();
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App environment={environment} />
    </StrictMode>,
  );

  // The splash lives outside #root, so React cannot own it: it is revealed from
  // here, once the app is really on screen — or once the ceiling says so, because
  // every signal it waits on is allowed to never arrive.
  revealAppWhenReady({ root: rootElement, authSettled });

  registerPwaIfNeeded(environment);
}
