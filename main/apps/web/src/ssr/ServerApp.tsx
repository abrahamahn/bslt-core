// main/apps/web/src/ssr/ServerApp.tsx
/**
 * The tree the build-time prerenderer renders.
 *
 * What it is
 * ----------
 * The public pages — the ones in `siteMap` — rendered without the app shell.
 * A prerendered page is what a crawler and a first-time visitor see before any
 * JavaScript runs: the document (heading, prose, links) and the footer that
 * makes every other public page reachable. It is deliberately NOT the shell:
 * the shell is chrome (auth modals, resizable panes, the command palette) that
 * reads localStorage and window on mount and says nothing about the page.
 *
 * Because of that, the markup here does NOT match what the client renders, and
 * it must not be hydrated against it. The prerenderer marks the root
 * `data-prerendered` and `bootstrapClientApp` drops the markup and mounts fresh
 * — see main/apps/web/src/bootstrap/client.tsx.
 *
 * Where the routes come from
 * --------------------------
 * `flattenAppRoutes()` — the app's own route table, not a copy of it. A page is
 * prerendered only if `siteMap` declares it live AND the router serves that
 * path; a live path with no route throws here rather than shipping HTML for a
 * URL nobody serves.
 *
 * Server-safety
 * -------------
 * Every provider below is browser-free. The environment is signed-out (no
 * session exists at build time), which is exactly the state a crawler sees, so
 * `useAuth()` reports "logged out" and `publicOnly` pages render their public
 * face. Query hooks fetch from effects, which never run during SSR, so no page
 * calls the API at build time: data-backed pages (the legal documents) prerender
 * their title and chrome, and fill in on the client.
 */

import { ClientEnvironmentProvider, type ClientEnvironment } from '@app/ClientEnvironment';
import { AppFooter } from '@app/layouts';
import { flattenAppRoutes } from '@app/routes';
import { livePages } from '@app/siteMap';
import { QueryCache } from '@bslt/client-engine';
import { QueryCacheProvider } from '@bslt/react';
import { MemoryRouter, Route, Routes } from '@bslt/react/router';
import { ThemeProvider } from '@bslt/ui';
import { clientConfig } from '@config';
import { createAuthService } from '@features/auth';
import { Suspense } from 'react';

import { SsrDataProvider, type SsrData } from './SsrContext';

import type { ReactElement } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface ServerAppProps {
  /** The path being rendered, e.g. `/terms`. */
  url: string;
  /** Data the prerenderer resolved for this path (title, description). */
  ssrData: SsrData;
}

// ============================================================================
// Environment
// ============================================================================

/**
 * One environment for the whole build. `initialize()` is never called, so the
 * auth service stays in its signed-out state and never reaches the network.
 */
function createServerEnvironment(): ClientEnvironment {
  return {
    config: clientConfig,
    queryCache: new QueryCache(),
    auth: createAuthService({ config: clientConfig }),
  };
}

const serverEnvironment: ClientEnvironment = createServerEnvironment();

// ============================================================================
// Routes
// ============================================================================

/**
 * A `<Route>` per live site-map page, carrying the element the app's own route
 * table declares for that path.
 */
function publicRoutes(): ReactElement[] {
  const routes = flattenAppRoutes();

  return livePages().map((page) => {
    const route = routes.get(page.path);
    if (route === undefined) {
      throw new Error(
        `siteMap declares ${page.path} live, but no route serves it. Add the route, or set live: false.`,
      );
    }

    const Page = route.element;
    return (
      <Route
        key={page.path}
        path={page.path}
        element={
          // Code-split pages suspend; `prerender()` waits for them, so the
          // fallback never reaches the output. It is null rather than a spinner
          // so a bug here shows up as an empty page the guard catches, not as a
          // plausible-looking loading state that ships.
          <Suspense fallback={null}>
            <Page />
          </Suspense>
        }
      />
    );
  });
}

// ============================================================================
// Component
// ============================================================================

export const ServerApp = ({ url, ssrData }: ServerAppProps): ReactElement => (
  <SsrDataProvider value={ssrData}>
    {/* Same appearance storage keys as App.tsx, so the client reads the same
        preferences it would have read anyway. */}
    <ThemeProvider
      storageKey="app-theme-mode"
      densityStorageKey="app-density"
      contrastStorageKey="app-contrast"
    >
      <QueryCacheProvider cache={serverEnvironment.queryCache}>
        <ClientEnvironmentProvider value={serverEnvironment}>
          <MemoryRouter initialEntries={[url]}>
            <Routes>{publicRoutes()}</Routes>
            {/* The crawlable path from any prerendered page to every other one.
                In the browser this lives in AppLayout; the shell is not
                prerendered, so it is mounted here explicitly. */}
            <AppFooter />
          </MemoryRouter>
        </ClientEnvironmentProvider>
      </QueryCacheProvider>
    </ThemeProvider>
  </SsrDataProvider>
);
