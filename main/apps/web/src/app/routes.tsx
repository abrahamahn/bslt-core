// main/apps/web/src/app/routes.tsx
import { hasAdminModule } from '../generated/modules';

import { ProfileModalRoute, SettingsModalRoute } from './account';
import { AdminLayout, type AdminSurfaceId } from './admin';
import { DashboardPage } from './dashboard';
import { resolveAppRouteFlags, routeFlagsToCapabilities, type AppRouteFlags } from './routeFlags';
import { lazyModuleRoutePage, lazyPage } from './routeLoad';
import { AppShell, AuthShell, ConsoleShell, PublicShell } from './shells';
import { webApp } from './webApp';

import type { CapabilityContext } from '@bslt/contract';
import type {
  FrameRouteContribution,
  ResolvedDeclaredRoute,
  WebShellConfig,
} from '@bslt/web-platform';
import type { ElementType } from 'react';

import { ForbiddenPage } from '#app/pages/ForbiddenPage';
import { LandingPage } from '#app/pages/LandingPage';
import { NotFoundPage } from '#app/pages/NotFoundPage';
import { UnavailablePage } from '#app/pages/UnavailablePage';

const AdminDashboardPage = lazyPage(
  () => import('./admin/AdminDashboardPage'),
  'AdminDashboardPage',
);

export const appFrameShells: WebShellConfig = Object.freeze({
  publicShell: PublicShell,
  authShell: AuthShell,
  appShell: AppShell,
  consoleShell: ConsoleShell,
  adminLayout: AdminLayout,
  lazyModuleRoutePage,
});

export const appFrameRoutes: readonly FrameRouteContribution<AppRouteFlags>[] = Object.freeze([
  {
    slot: 'before-modules',
    shell: 'public',
    index: true,
    element: LandingPage,
    publicOnly: true,
  },
  {
    slot: 'before-modules',
    shell: 'app',
    path: 'settings',
    element: SettingsModalRoute,
    protected: true,
  },
  {
    slot: 'after-modules',
    shell: 'app',
    path: 'dashboard',
    element: DashboardPage,
    protected: true,
  },
  {
    slot: 'after-modules',
    shell: 'app',
    path: 'profile',
    element: ProfileModalRoute,
    protected: true,
  },
  {
    slot: 'after-modules',
    shell: 'app',
    path: 'settings/:tab',
    element: SettingsModalRoute,
    protected: true,
    unlisted: true,
  },
  {
    slot: 'after-modules',
    shell: 'app',
    path: 'forbidden',
    element: ForbiddenPage,
    unlisted: true,
  },
  {
    slot: 'after-modules',
    shell: 'app',
    path: 'unavailable',
    element: UnavailablePage,
    unlisted: true,
  },
  {
    slot: 'after-modules',
    shell: 'app',
    path: '*',
    element: NotFoundPage,
    unlisted: true,
  },
  ...(hasAdminModule
    ? []
    : [
        {
          slot: 'admin' as const,
          shell: 'console' as const,
          index: true,
          element: AdminDashboardPage,
          adminSurface: 'dashboard',
        },
      ]),
  {
    slot: 'admin',
    shell: 'console',
    path: 'dashboard',
    element: AdminDashboardPage,
    adminSurface: 'dashboard',
    ...(hasAdminModule ? { when: (f: AppRouteFlags): boolean => f.advancedAdminEnabled } : {}),
  },
]);

function mergeFlagsIntoCapabilities(
  resolvedFlags: AppRouteFlags,
  capabilities?: CapabilityContext,
): CapabilityContext {
  const base = capabilities ?? routeFlagsToCapabilities(resolvedFlags);
  return {
    ...base,
    flags: {
      ...base.flags,
      'flags.advanced_admin': resolvedFlags.advancedAdminEnabled,
      'flags.billing': resolvedFlags.billingEnabled,
      'flags.dev_tools': resolvedFlags.developerToolsEnabled,
      'orgs.teams': resolvedFlags.teamsEnabled,
    },
    authStrategies: resolvedFlags.advancedAuthEnabled
      ? base.authStrategies.includes('magic')
        ? base.authStrategies
        : [...base.authStrategies, 'magic']
      : base.authStrategies.filter((strategy) => strategy !== 'magic'),
  };
}

function holdGatedRoutes(
  routes: readonly FrameRouteContribution<AppRouteFlags>[],
  pending: ElementType,
): FrameRouteContribution<AppRouteFlags>[] {
  return routes.map((route): FrameRouteContribution<AppRouteFlags> =>
    route.when === undefined
      ? route
      : {
          slot: route.slot,
          ...(route.shell !== undefined ? { shell: route.shell } : {}),
          ...(route.path !== undefined ? { path: route.path } : {}),
          ...(route.index === true ? { index: true } : {}),
          element: pending,
        },
  );
}

// Define a type for our route objects to ensure consistency
export interface AppRoute {
  path?: string;
  index?: boolean;
  element: ElementType;
  children?: AppRoute[];
  protected?: boolean; // Custom property for ProtectedRoute
  publicOnly?: boolean;
  publicOnlyRedirectTo?: string;
  adminSurface?: AdminSurfaceId;
}

export interface AppRouteOptions {
  advancedAdminEnabled?: boolean;
  advancedAuthEnabled?: boolean;
  billingEnabled?: boolean;
  developerToolsEnabled?: boolean;
  teamsEnabled?: boolean;
}

export function createAppRoutes(
  options: AppRouteOptions = {},
  capabilities?: CapabilityContext,
): AppRoute[] {
  const resolvedFlags = resolveAppRouteFlags(options);
  return webApp.getRoutes(resolvedFlags, {
    shells: appFrameShells,
    frameRoutes: appFrameRoutes,
    capabilities: mergeFlagsIntoCapabilities(resolvedFlags, capabilities),
  });
}

/**
 * The table while the viewer's capability context is loading.
 *
 * Whether a flag-gated route exists depends on a context that is not the
 * viewer's yet, so deciding now would be a guess: an absent route falls through
 * to `settings/:tab` (which replaces the URL for good), to NotFound, or to a
 * blank admin outlet. Every route with a `when` or `requires` therefore keeps
 * its slot with `pending` as its element and no guard, so the URL is held and
 * nothing, not even a login redirect, is decided until the settled table takes
 * over. Ungated routes are as in the settled table. `pending` is a parameter so
 * this module does not import from App.tsx.
 */
export function createPendingAppRoutes(pending: ElementType): AppRoute[] {
  return webApp.getRoutes(resolveAppRouteFlags(), {
    shells: appFrameShells,
    pending,
    frameRoutes: holdGatedRoutes(appFrameRoutes, pending),
  });
}

export function getDeclaredAppRoutes(
  options: AppRouteOptions = {},
  capabilities?: CapabilityContext,
): readonly ResolvedDeclaredRoute[] {
  const resolvedFlags = resolveAppRouteFlags(options);
  return webApp.getDeclaredRoutes(resolvedFlags, {
    frameRoutes: appFrameRoutes,
    capabilities: mergeFlagsIntoCapabilities(resolvedFlags, capabilities),
  });
}

/**
 * Default route table built at module load with fail-closed capabilities
 * (used by SSR prerendering of public pages). Client `AppRoutes` recomputes
 * routes reactively from `CapabilityProvider` as `/api/platform/context` resolves.
 */
const appRoutes: AppRoute[] = createAppRoutes();

/**
 * The page routes keyed by the absolute path the router resolves them at.
 *
 * Layout routes (PublicShell, AuthShell, AppShell, ConsoleShell, AdminLayout)
 * are not pages: they hold children and are recursed into, so `/` maps to the
 * index route's page rather than to the shell. Paths compose the way React
 * Router composes them — a child path hangs off its parent, an index route IS
 * its parent, and a child that starts with `/` is already absolute. First
 * declaration wins, because the router is first-match.
 *
 * The build-time prerenderer resolves each site-map path through this, so the
 * HTML it ships is rendered from the same route table the browser runs. A second
 * hand-written table is exactly the drift that ships a prerendered page for a URL
 * nobody serves.
 */
export function flattenAppRoutes(
  routes: readonly AppRoute[] = appRoutes,
  basePath = '/',
  pages: Map<string, AppRoute> = new Map(),
): ReadonlyMap<string, AppRoute> {
  for (const route of routes) {
    const path = resolveRoutePath(route, basePath);

    if (route.children !== undefined && route.children.length > 0) {
      flattenAppRoutes(route.children, path, pages);
      continue;
    }

    if (!pages.has(path)) pages.set(path, route);
  }

  return pages;
}

function resolveRoutePath(route: AppRoute, basePath: string): string {
  // An index route has no path of its own: it renders at its parent's.
  if (route.path === undefined) return basePath;
  if (route.path.startsWith('/')) return route.path;

  return basePath === '/' ? `/${route.path}` : `${basePath}/${route.path}`;
}
