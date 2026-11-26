// main/apps/web/src/app/App.tsx
/**
 * App - Root component that composes providers and routes.
 *
 * Following chet-stack pattern:
 * - Single component wraps all providers
 * - Routes defined inline
 * - Environment passed as prop (dependency injection)
 */

import {
  clearQueryCache,
  clearUserScopedLocalStorage,
  createEndpointClient,
  createPersistedClientFromQueryCache,
  createQueryPersister,
  createTransport,
  restorePersistedQueryCache,
  runUserScopedResets,
  type Persister,
} from '@bslt/client-engine';
import { complianceModule } from '@bslt/compliance/module';
import { consentAllows, CookieConsentBanner, TosAcceptanceModal } from '@bslt/compliance/web';
import { useAuth } from '@bslt/identity/web';
import { LiveRegion, QueryCacheProvider, toastStore } from '@bslt/react';
import { HistoryProvider, useRouteFocusAnnounce } from '@bslt/react/hooks';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from '@bslt/react/router';
import { AsyncBoundary, ErrorBoundary, SkipLink, ThemeProvider, Toaster } from '@bslt/ui';
import { applyClientHeadTags, useCapabilities } from '@bslt/web-platform';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type ReactElement,
} from 'react';

import { OptionalAnalyticsTracker } from '../generated/modules';
import { reportError } from '../lib/errorReporter';

import { getAccessToken } from './authToken';
import { ClientEnvironmentProvider, type ClientEnvironment } from './ClientEnvironment';
import { CommandPalette } from './command-palette';
import { NetworkStatus } from './components';
import { isPersistableQueryKey } from './queryPersistencePolicy';
import { deriveAppRouteFlags } from './routeFlags';
import { resolveRouteHead } from './routeHead';
import { createAppRoutes, createPendingAppRoutes, type AppRoute } from './routes';
import { ShellOverlays } from './shells';
import { setTosHandler, type TosRequiredPayload } from './tosHandler';

import { clientConfig } from '#app/config';
import { I18nProvider } from '#app/i18n';

// ============================================================================
// Types
// ============================================================================

interface AppProps {
  environment: ClientEnvironment;
}

// ============================================================================
// Components
// ============================================================================

const AppToaster = (): ReactElement => {
  const { messages, dismiss } = toastStore();
  // Bottom-right: a top-right stack collides with the header search and account menu.
  return <Toaster messages={messages} onDismiss={dismiss} position="bottom-right" />;
};

const AuthenticatedCommandPalette = (): ReactElement | null => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <CommandPalette /> : null;
};

/** Announces route changes to screen readers via the LiveRegion provider */
const RouteFocusAnnouncer = (): null => {
  useRouteFocusAnnounce();
  return null;
};

/** Synchronizes document.title, meta description, OpenGraph, Twitter, and canonical tags on SPA route changes. */
const RouteHeadSync = (): null => {
  const location = useLocation();
  useEffect(() => {
    const head = resolveRouteHead(location.pathname, clientConfig.appName);
    const origin = typeof window !== 'undefined' ? window.location.origin : null;
    applyClientHeadTags(document, head, {
      appName: clientConfig.appName,
      siteUrl: origin,
      pathname: location.pathname,
    });
  }, [location.pathname]);
  return null;
};

/** The root boundary's render errors go to the error reporter (consent-gated). */
const reportRenderError = (error: Error): void => {
  reportError(error, 'render');
};

/**
 * Shown while a lazy route's chunk loads, and in place of a flag-gated route
 * while the viewer's capability context loads. The `data-route-pending`
 * attribute is the contract with the boot splash (src/bootstrap/splash.ts):
 * while it is in the tree the first route is NOT on screen yet, and revealing
 * would only swap the splash for this spinner.
 */
export const RouteLoadingFallback = (): ReactElement => (
  <div className="app-route-loading" role="status" aria-label="Loading page" data-route-pending="">
    <AsyncBoundary className="app-route-loading__indicator" isLoading loadingText="" size="md" />
  </div>
);

const pendingAppRoutes = createPendingAppRoutes(RouteLoadingFallback);

/** Shell/route auth guard preserving returnTo and keeping mounted pages alive across background user refreshes. */
const ProtectedPage = ({ Component }: { Component: ElementType }): ReactElement => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading && !isAuthenticated) {
    return <RouteLoadingFallback />;
  }
  if (!isAuthenticated) {
    const currentPath = location.pathname + location.search;
    const target =
      currentPath !== '/' && currentPath !== ''
        ? `/login?returnTo=${encodeURIComponent(currentPath)}`
        : '/login';
    return <Navigate to={target} replace />;
  }
  return <Component />;
};

/** Redirects authenticated users away from public/demo pages into the logged-in app. */
const PublicOnlyPage = ({
  Component,
  redirectTo = '/dashboard',
}: {
  Component: ElementType;
  redirectTo?: string | undefined;
}): ReactElement => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <RouteLoadingFallback />;
  }
  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Component />;
};

// Helper function to render routes recursively
const renderRoutes = (routes: AppRoute[]): ReactElement[] => {
  return routes.map((route: AppRoute, index) => {
    const Element = route.element;
    const elementToRender =
      route.protected === true ? (
        <ProtectedPage Component={Element} />
      ) : route.publicOnly === true ? (
        <PublicOnlyPage Component={Element} redirectTo={route.publicOnlyRedirectTo} />
      ) : (
        <Element />
      );
    const routeElement = <Suspense fallback={<RouteLoadingFallback />}>{elementToRender}</Suspense>;

    const routeProps: {
      element: ReactElement;
      path?: string;
      index?: boolean;
    } = {
      element: routeElement,
    };

    if (route.path !== undefined) {
      routeProps.path = route.path;
    }

    if (route.index !== undefined) {
      routeProps.index = route.index;
    }

    const childRoutes =
      Array.isArray(route.children) && route.children.length > 0
        ? renderRoutes(route.children)
        : null;

    return (
      <Route key={index} {...routeProps}>
        {childRoutes}
      </Route>
    );
  });
};

const AppRoutes = (): ReactElement => {
  const { context, status } = useCapabilities();
  const routes = useMemo(
    () =>
      status === 'loading'
        ? pendingAppRoutes
        : createAppRoutes(deriveAppRouteFlags(context, { isDev: import.meta.env.DEV }), context),
    [context, status],
  );
  return <Routes>{renderRoutes(routes)}</Routes>;
};
// ============================================================================
// App
// ============================================================================

/**
 * Hook to manage query cache persistence in the background.
 *
 * Non-blocking approach for instant app load:
 * - App renders immediately without waiting for IndexedDB
 * - Cache restoration happens in background
 * - Persists cache changes to IndexedDB (throttled)
 */
function useQueryPersistence(environment: ClientEnvironment): void {
  const { queryCache, config } = environment;
  const { maxAge, throttleTime } = config.queryPersistence;

  const persister: Persister = createQueryPersister({
    maxAge,
    throttleTime,
  });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const init = async (): Promise<void> => {
      // Restore cached data from IndexedDB in background
      try {
        const persistedClient = await persister.restoreClient();
        restorePersistedQueryCache(queryCache, persistedClient, isPersistableQueryKey);
      } catch {
        await persister.removeClient();
      }

      // Subscribe to cache changes for persistence
      unsubscribe = queryCache.subscribeAll(() => {
        const persisted = createPersistedClientFromQueryCache(queryCache.getAll(), {
          shouldPersist: isPersistableQueryKey,
        });
        persister.persistClient(persisted);
      });
    };

    void init();

    return (): void => {
      unsubscribe?.();
    };
  }, [queryCache, maxAge, throttleTime, persister]);
}

function clearServiceWorkerCachesOnLogout(): void {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    const controller = sw?.controller ?? null;
    if (controller !== null) {
      controller.postMessage({ type: 'CLEAR_CACHE' });
    }
  }
  if (typeof window !== 'undefined' && 'caches' in window) {
    void window.caches
      .keys()
      .then((names) => Promise.all(names.map((name) => window.caches.delete(name))))
      .catch(() => false);
  }
}

/**
 * Clears the query cache when the authenticated user identity changes.
 *
 * Without this, after a logout → login (or switching accounts) in the same tab,
 * the previous user's cached `['user', …]`, tasks, settings, etc. remain and are
 * shown to the new user until a manual refresh. We only clear when transitioning
 * away from a logged-in user (logout or switch) so a cold-start cache restore for
 * the legitimate current user is preserved. The clear cascades to IndexedDB via
 * the persistence subscription, so it also prevents stale cross-user cold loads.
 */
function useAuthScopedCacheReset(environment: ClientEnvironment): void {
  const { auth, queryCache } = environment;

  useEffect(() => {
    let previousUserId = auth.getState().user?.id ?? null;

    return auth.subscribe(() => {
      const nextUserId = auth.getState().user?.id ?? null;
      if (nextUserId === previousUserId) return;
      const leavingPreviousUser = previousUserId !== null;
      previousUserId = nextUserId;
      if (leavingPreviousUser) {
        // A different user (or sign-out) took over this browser. Drop ALL of
        // the previous user's client state so nothing stale leaks across:
        //  - the in-memory query cache (server data — balances, lists, …)
        //  - the IndexedDB-persisted query cache (else a cold start restores it)
        //  - single-slot user-scoped localStorage (active org, export id, …)
        //  - Service Worker CacheStorage (`CLEAR_CACHE`)
        // Per-user preferences stored via createUserScopedStorage are namespaced
        // by id, so they are preserved and restored on that user's next login.
        queryCache.clear();
        clearUserScopedLocalStorage();
        runUserScopedResets();
        clearServiceWorkerCachesOnLogout();
        void clearQueryCache().catch(() => false);
      }
    });
  }, [auth, queryCache]);
}

// ============================================================================
// ToS Acceptance State
// ============================================================================

interface TosModalState {
  open: boolean;
  documentId: string | null;
  requiredVersion: number | null;
}

const TOS_INITIAL_STATE: TosModalState = {
  open: false,
  documentId: null,
  requiredVersion: null,
};

/**
 * useTosAcceptance - Manages ToS acceptance modal state.
 *
 * Registers a handler with the tosHandler module so the API client's
 * onTosRequired callback can trigger the modal from any API call.
 */
function useTosAcceptance(environment: ClientEnvironment): {
  state: TosModalState;
  handleAccept: (documentId: string) => Promise<void>;
  handleDismiss: () => void;
} {
  const [state, setState] = useState<TosModalState>(TOS_INITIAL_STATE);
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);

  useEffect(() => {
    const cleanup = setTosHandler((payload: TosRequiredPayload) => {
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setState({
          open: true,
          documentId: payload.documentId,
          requiredVersion: payload.requiredVersion,
        });
      });
    });
    return cleanup;
  }, []);

  const handleAccept = useCallback(
    async (documentId: string) => {
      const transport =
        environment.transport ??
        createTransport({
          baseUrl: environment.config.apiUrl,
          getToken: getAccessToken,
        });
      await createEndpointClient(complianceModule, transport).acceptTos({
        body: { documentId },
      });

      // Close modal and resolve true so the original request retries
      setState(TOS_INITIAL_STATE);
      resolveRef.current?.(true);
      resolveRef.current = null;
    },
    [environment.config.apiUrl, environment.transport],
  );

  const handleDismiss = useCallback(() => {
    setState(TOS_INITIAL_STATE);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return { state, handleAccept, handleDismiss };
}

/**
 * Root component that sets up all application infrastructure.
 *
 * Provider stack (outer to inner):
 * - ErrorBoundary: Catches unhandled render errors and hands them to the error reporter
 * - QueryCacheProvider: Custom query cache infrastructure
 * - I18nProvider: Locale state and translation context
 * - BrowserRouter: React Router infrastructure
 * - ClientEnvironmentProvider: Our unified service context
 * - HistoryProvider: Navigation history tracking
 * - LiveRegion: Screen reader announcement support
 *
 * Query persistence is handled manually via useQueryPersistence hook,
 * which restores from and persists to IndexedDB.
 */
export const App = ({ environment }: AppProps): ReactElement => {
  // Start background cache restoration (non-blocking)
  useQueryPersistence(environment);
  useAuthScopedCacheReset(environment);

  // ToS acceptance modal state
  const {
    state: tosState,
    handleAccept: handleTosAccept,
    handleDismiss: handleTosDismiss,
  } = useTosAcceptance(environment);

  const canTrackAnalytics = useCallback((): boolean => consentAllows('analytics'), []);

  return (
    <ErrorBoundary onError={reportRenderError}>
      <QueryCacheProvider cache={environment.queryCache}>
        {/* Single source of truth for appearance — same storage keys the
            Settings → Theme controls write, so the choice applies app-wide. */}
        <ThemeProvider>
          <I18nProvider>
            <BrowserRouter>
              <ClientEnvironmentProvider value={environment}>
                <HistoryProvider>
                  <LiveRegion>
                    <div className="h-screen flex flex-col overflow-hidden">
                      <SkipLink />
                      <RouteFocusAnnouncer />
                      <RouteHeadSync />
                      <OptionalAnalyticsTracker canTrack={canTrackAnalytics} />
                      <div className="flex-1 min-h-0 relative">
                        <AppRoutes />
                      </div>
                      <ShellOverlays />
                      <AppToaster />
                      <NetworkStatus />
                      <AuthenticatedCommandPalette />
                      <CookieConsentBanner />
                      <TosAcceptanceModal
                        open={tosState.open}
                        documentId={tosState.documentId}
                        requiredVersion={tosState.requiredVersion}
                        onAccept={handleTosAccept}
                        onDismiss={handleTosDismiss}
                      />
                    </div>
                  </LiveRegion>
                </HistoryProvider>
              </ClientEnvironmentProvider>
            </BrowserRouter>
          </I18nProvider>
        </ThemeProvider>
      </QueryCacheProvider>
    </ErrorBoundary>
  );
};
