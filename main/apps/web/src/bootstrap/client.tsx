// main/apps/web/src/bootstrap/client.tsx
/**
 * Shared client bootstrap for SPA and SSR entry points.
 *
 * Keeps environment creation, auth initialization, HMR cleanup, and
 * service-worker registration in one place so both entry files stay thin.
 */

import { createTransport, QueryCache, tokenStore, type Transport } from '@bslt/client-engine';
import { startConsentSync } from '@bslt/compliance/web';
import { MS_PER_DAY, MS_PER_MINUTE } from '@bslt/contract';
import { createAuthService } from '@bslt/identity/web';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { revealAppWhenReady } from './splash';

import type { ClientEnvironment } from '#app/app/ClientEnvironment';

import { App } from '#app/app/App';
import { getAccessToken } from '#app/app/authToken';
import { onTosRequired } from '#app/app/tosHandler';
import { clientConfig } from '#app/config';
import { applyBrandTheme } from '#app/generated/brand';
import { reportError, startErrorReporter } from '#app/lib/errorReporter';
import { unregisterAllServiceWorkers } from '#app/utils/registerServiceWorker';

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
  /** The environment's transport, which `ClientEnvironment` types as optional. */
  readonly transport: Transport;
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
    tokenStore,
    onTosRequired,
  });

  const transport = createTransport({
    baseUrl: clientConfig.apiUrl,
    getToken: getAccessToken,
  });

  const environment: ClientEnvironment = {
    config: clientConfig,
    queryCache,
    auth,
    transport,
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

  return { environment, transport, authSettled };
}

function syncDocumentTitle(environment: ClientEnvironment): void {
  document.title = resolveDocumentTitle(environment.config.appName);
}

function registerPwaIfNeeded(environment: ClientEnvironment): void {
  if (environment.config.isDev) {
    void unregisterAllServiceWorkers().catch((error: unknown) => {
      reportError(error, 'unhandledrejection');
    });
  }
}

/** Event name for errors that escape React's ErrorBoundary. */
export const UNCAUGHT_ERROR_EVENT = 'app:uncaught-error';

/**
 * Report and re-broadcast errors that never reach an ErrorBoundary.
 *
 * A boundary catches errors thrown while RENDERING. It cannot see a rejected
 * promise in an event handler, a failed dynamic import, or a throw inside
 * `setTimeout` — those reach `window` and stop there.
 *
 * Each goes to the error reporter (which sends nothing without analytics
 * consent) and is re-dispatched, so a debug overlay or a test has one event to
 * listen for. This does NOT log: the browser already prints both of these, and
 * logging again just doubles every entry in the console.
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
    reportError(error, 'error', event.filename);
    window.dispatchEvent(
      new CustomEvent(UNCAUGHT_ERROR_EVENT, { detail: { error, source: 'error' } }),
    );
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    const error: unknown = event.reason;
    reportError(error, 'unhandledrejection');
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
  applyBrandTheme();

  // The ErrorBoundary cannot see rejected promises or failed chunk loads. Errors
  // are re-broadcast from here on, and reported once the reporter starts below.
  reportUncaughtErrors();

  // Before anything reads consent: applies a Global Privacy Control opt-out
  // and keeps the decision in sync across tabs — an opt-out made in one tab
  // must hold in every tab.
  startConsentSync();

  const { environment, transport, authSettled } = createEnvironment();
  syncDocumentTitle(environment);

  // Public route: the reports go without the access token, and the transport
  // supplies the CSRF token. `keepalive` lets the pagehide flush outlive the page.
  startErrorReporter((reports) =>
    transport.request('/platform/errors', {
      method: 'POST',
      body: JSON.stringify({ reports }),
      requiresAuth: false,
      keepalive: true,
    }),
  );

  const rootElement = document.getElementById('root');
  if (rootElement === null) throw new Error('Failed to find the root element');

  // If the full SPA entry ever mounts over legacy prerendered or public SSR
  // markup instead of _spa.html, clear #root before createRoot mounts App.
  if (
    rootElement.dataset['prerendered'] === 'true' ||
    rootElement.dataset['ssrPublic'] === 'true'
  ) {
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
