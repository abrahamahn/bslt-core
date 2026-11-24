// main/apps/web/src/app/routes.test.ts

import { describe, expect, it } from 'vitest';

import {
  devOnlyWebModules,
  hasAdminModule,
  hasBillingModule,
  hasFilesModule,
  hasNotificationsModule,
  hasOrgsModule,
  installedModules,
  installedWebModules,
} from '../generated/modules';

import { ADMIN_NAV_SURFACES, ADMIN_SURFACES, AdminLayout, getAdminNavSurfaces } from './admin';
import { routePageName } from './routeLoad';
import {
  createAppRoutes,
  createPendingAppRoutes,
  flattenAppRoutes,
  getDeclaredAppRoutes,
} from './routes';
import { AppShell, AuthShell, ConsoleShell, PublicShell } from './shells';
import { livePages } from './siteMap';

import type { AppRoute, AppRouteOptions } from './routes';

import { LandingPage } from '#app/pages/LandingPage';

const INSTALLED_IDS: ReadonlySet<string> = new Set(installedModules.map((m) => m.id));
const hasMod = (id: string): boolean => INSTALLED_IDS.has(id);

function flattenRoutes(routes: readonly AppRoute[]): AppRoute[] {
  return routes.flatMap((route) => [route, ...flattenRoutes(route.children ?? [])]);
}

function appShellChildren(routes: readonly AppRoute[]): AppRoute[] {
  return routes.find((route) => route.element === AppShell)?.children ?? [];
}

function adminRoutes(routes: readonly AppRoute[]): AppRoute[] {
  const consoleRoute = routes.find((route) => route.element === ConsoleShell);
  const adminRoute = consoleRoute?.children?.find((route) => route.path === 'admin');
  return adminRoute?.children ?? [];
}

describe('appRoutes', () => {
  it('keeps the starter product route surface small by default', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const paths = new Set(flattenRoutes(routes).map((route) => route.path));

    for (const path of ['dashboard', 'profile', 'settings', 'settings/:tab', 'activities']) {
      expect(paths.has(path)).toBe(true);
    }
    expect(paths.has('files')).toBe(hasFilesModule);
    expect(paths.has('tasks')).toBe(hasMod('tasks'));
    if (hasMod('tasks')) {
      const tasksRoute = flattenRoutes(routes).find((route) => route.path === 'tasks');
      expect(tasksRoute?.protected).toBe(true);
    }
    const activitiesRoute = flattenRoutes(routes).find((route) => route.path === 'activities');
    expect(activitiesRoute?.protected).toBe(true);

    for (const path of [
      'auth/magic-link/verify',
      'settings/accounts',
      'settings/billing',
      'billing/success',
      'billing/cancel',
    ]) {
      expect(paths.has(path)).toBe(false);
    }

    expect(paths.has('/side-peek-ui-library')).toBe(false);
    expect(paths.has('clean')).toBe(false);
    expect(paths.has('developer/api-routes')).toBe(false);
    expect(paths.has('ui-library')).toBe(false);
    expect(paths.has('t/:slug')).toBe(false);
  });

  it('registers profile as a protected starter route', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const profileRoute = flattenRoutes(routes).find((route) => route.path === 'profile');

    expect(profileRoute?.protected).toBe(true);
  });

  it('includes developer routes only when developer tools are enabled', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: true,
    });
    const paths = new Set(flattenRoutes(routes).map((route) => route.path));

    expect(paths.has('/side-peek-ui-library')).toBe(true);
    expect(paths.has('clean')).toBe(true);
    expect(paths.has('developer/api-routes')).toBe(true);
    expect(paths.has('ui-library')).toBe(true);
  });

  it('marks demo pages as public-only', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: true,
    });
    const flatRoutes = flattenRoutes(routes);
    const homeRoute = flatRoutes.find((route) => route.index === true);
    const demoRoutes = [
      homeRoute,
      flatRoutes.find((route) => route.path === 'clean'),
      flatRoutes.find((route) => route.path === '/side-peek-ui-library'),
      flatRoutes.find((route) => route.path === 'developer/api-routes'),
      flatRoutes.find((route) => route.path === 'ui-library'),
    ];

    for (const route of demoRoutes) {
      expect(route?.publicOnly).toBe(true);
    }
  });

  it.runIf(hasBillingModule)('adds billing routes only when billing is enabled', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: true,
      developerToolsEnabled: false,
    });
    const pricingRoute = flattenRoutes(routes).find((route) => route.path === 'pricing');

    expect(pricingRoute).toBeDefined();
    expect(pricingRoute?.protected).toBeUndefined();
    expect(
      flattenRoutes(routes).find((route) => route.path === 'settings/billing')?.protected,
    ).toBe(true);
  });

  it.runIf(hasBillingModule)(
    'registers settings/billing before the settings/:tab catch-all (first-match router)',
    () => {
      const routes = createAppRoutes({
        advancedAdminEnabled: false,
        advancedAuthEnabled: false,
        billingEnabled: true,
        developerToolsEnabled: false,
      });
      const children = appShellChildren(routes);
      const billingIndex = children.findIndex((route) => route.path === 'settings/billing');
      const tabIndex = children.findIndex((route) => route.path === 'settings/:tab');

      expect(billingIndex).toBeGreaterThan(-1);
      expect(tabIndex).toBeGreaterThan(-1);
      expect(billingIndex).toBeLessThan(tabIndex);
    },
  );

  it.runIf(hasBillingModule)(
    'keeps /pricing routed to a graceful fallback when billing is disabled',
    () => {
      const routes = createAppRoutes({
        advancedAdminEnabled: false,
        advancedAuthEnabled: false,
        billingEnabled: false,
        developerToolsEnabled: false,
      });
      const flatRoutes = flattenRoutes(routes);
      const paths = new Set(flatRoutes.map((route) => route.path));

      expect(flatRoutes.find((route) => route.path === 'pricing')).toBeDefined();
      expect(flatRoutes.find((route) => route.path === 'pricing')?.protected).toBeUndefined();
      expect(paths.has('settings/billing')).toBe(false);
      expect(paths.has('billing/success')).toBe(false);
      expect(paths.has('billing/cancel')).toBe(false);
    },
  );

  it.runIf(hasBillingModule)(
    'routes /pricing to different pages depending on the billing flag',
    () => {
      const routeFor = (billingEnabled: boolean): AppRoute | undefined =>
        flattenRoutes(
          createAppRoutes({
            advancedAdminEnabled: false,
            advancedAuthEnabled: false,
            billingEnabled,
            developerToolsEnabled: false,
          }),
        ).find((route) => route.path === 'pricing');

      expect(routeFor(true)?.element).not.toBe(routeFor(false)?.element);
    },
  );

  it('falls back to settings/:tab for /settings/billing when billing is disabled', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const children = appShellChildren(routes);

    expect(children.some((route) => route.path === 'settings/billing')).toBe(false);
    expect(children.some((route) => route.path === 'settings/:tab')).toBe(true);
  });

  it('partitions routes across PublicShell, AuthShell, ConsoleShell, and AppShell', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: true,
      advancedAuthEnabled: true,
      billingEnabled: true,
      developerToolsEnabled: true,
      teamsEnabled: true,
    });

    const publicShell = routes.find((r) => r.element === PublicShell);
    const authShell = routes.find((r) => r.element === AuthShell);
    const consoleShell = routes.find((r) => r.element === ConsoleShell);
    const appShell = routes.find((r) => r.element === AppShell);

    expect(publicShell?.children?.some((c) => c.index === true)).toBe(true);
    expect(publicShell?.children?.some((c) => c.path === 'terms')).toBe(true);
    expect(publicShell?.children?.some((c) => c.path === 'status')).toBe(hasMod('status'));
    expect(authShell?.children?.some((c) => c.path === 'login')).toBe(true);
    expect(authShell?.children?.some((c) => c.path === 'auth/reset-password')).toBe(true);
    expect(consoleShell?.children?.some((c) => c.path === 'admin')).toBe(true);
    expect(consoleShell?.children?.some((c) => c.path === 'ui-library')).toBe(true);
    expect(appShell?.children?.some((c) => c.path === 'dashboard')).toBe(true);
    expect(appShell?.children?.some((c) => c.path === 'activities')).toBe(true);
    expect(appShell?.children?.some((c) => c.path === 'tasks')).toBe(hasMod('tasks'));
  });

  it.runIf(hasMod('search'))(
    'registers /search as a user-protected app route for workspace search',
    () => {
      const routes = createAppRoutes({
        advancedAdminEnabled: false,
        advancedAuthEnabled: false,
        billingEnabled: false,
        developerToolsEnabled: false,
      });
      const searchRoute = flattenRoutes(routes).find((route) => route.path === 'search');

      expect(searchRoute?.protected).toBe(true);
      expect(searchRoute?.element).not.toBe(AdminLayout);
    },
  );

  it('registers installed audit module activity feed route as protected', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const activityRoute = flattenRoutes(routes).find((route) => route.path === 'activities');

    expect(activityRoute?.protected).toBe(true);
  });

  it('adds advanced auth routes only when advanced auth is enabled', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: true,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const paths = new Set(flattenRoutes(routes).map((route) => route.path));

    expect(paths.has('auth/magic-link/verify')).toBe(true);
    expect(paths.has('settings/accounts')).toBe(true);
    expect(
      flattenRoutes(routes).find((route) => route.path === 'settings/accounts')?.protected,
    ).toBe(true);
  });

  it('keeps starter admin routes to health, users, and installed module surfaces by default', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const adminRouteList = adminRoutes(routes);
    const surfaceIds = new Set(
      adminRouteList.flatMap((route) =>
        route.adminSurface === undefined ? [] : [route.adminSurface],
      ),
    );

    for (const surfaceId of ['security', 'audit', 'legal']) {
      expect(surfaceIds.has(surfaceId)).toBe(true);
    }
    expect(surfaceIds.has('health')).toBe(hasAdminModule);
    expect(surfaceIds.has('users')).toBe(hasAdminModule);
    expect(surfaceIds.has('support')).toBe(hasMod('support'));
    expect(surfaceIds.has('feature-flags')).toBe(hasMod('flags'));
    expect(surfaceIds.has('webhooks')).toBe(hasMod('webhooks'));
    expect(surfaceIds.has('webhook-endpoints')).toBe(hasMod('webhooks'));

    expect(surfaceIds.has('dashboard')).toBe(!hasAdminModule);
    expect(surfaceIds.has('billing')).toBe(false);
    expect(surfaceIds.has('jobs')).toBe(false);
  });

  it.runIf(hasMod('webhooks'))(
    'routes installed outbound webhook module surfaces regardless of legacy advanced admin flag',
    () => {
      const advancedPaths = new Set(
        adminRoutes(
          createAppRoutes({
            advancedAdminEnabled: true,
            advancedAuthEnabled: false,
            billingEnabled: false,
            developerToolsEnabled: false,
          }),
        ).map((route) => route.path),
      );
      const starterPaths = new Set(
        adminRoutes(
          createAppRoutes({
            advancedAdminEnabled: false,
            advancedAuthEnabled: false,
            billingEnabled: false,
            developerToolsEnabled: false,
          }),
        ).map((route) => route.path),
      );

      expect(advancedPaths.has('webhooks')).toBe(true);
      expect(advancedPaths.has('webhooks/:id')).toBe(true);
      expect(advancedPaths.has('webhook-monitor')).toBe(true);
      expect(starterPaths.has('webhooks')).toBe(true);
      expect(starterPaths.has('webhooks/:id')).toBe(true);
      expect(starterPaths.has('webhook-monitor')).toBe(true);
    },
  );

  it('keeps admin surface metadata aligned with advanced admin routes', () => {
    const routes = createAppRoutes({
      advancedAdminEnabled: true,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
    });
    const surfaceIds: ReadonlySet<string> = new Set(ADMIN_SURFACES.map((surface) => surface.id));
    const surfaceRoutePaths: ReadonlySet<string> = new Set(
      ADMIN_SURFACES.map((surface) => surface.routePath),
    );
    const adminRouteList = adminRoutes(routes);

    for (const surface of ADMIN_SURFACES) {
      if (surface.unlisted) continue;
      expect(adminRouteList.some((route) => route.path === surface.routePath)).toBe(true);
    }

    for (const route of adminRouteList) {
      expect(route.adminSurface).toBeDefined();
      expect(surfaceIds.has(route.adminSurface ?? '')).toBe(true);
      if (route.path !== undefined && !route.path.includes('/:')) {
        expect(surfaceRoutePaths.has(route.path)).toBe(true);
      }
    }
  });

  it('keeps internal admin diagnostics out of primary admin navigation', () => {
    const routeManifestSurface = ADMIN_SURFACES.find((surface) => surface.id === 'route-manifest');
    const navIds: ReadonlySet<string> = new Set(ADMIN_NAV_SURFACES.map((surface) => surface.id));

    expect(routeManifestSurface?.unlisted).toBe(true);
    expect(navIds.has('route-manifest')).toBe(false);
  });

  it('keeps unmigrated optional admin extensions out of primary admin navigation while linking installed module surfaces', () => {
    const navIds: ReadonlySet<string> = new Set(ADMIN_NAV_SURFACES.map((surface) => surface.id));

    expect(navIds.has('dashboard')).toBe(!hasAdminModule);
    expect(navIds.has('billing')).toBe(false);
    expect(navIds.has('jobs')).toBe(false);
    expect(navIds.has('notifications')).toBe(hasNotificationsModule);
    expect(navIds.has('security')).toBe(true);
    expect(navIds.has('audit')).toBe(true);
    expect(navIds.has('feature-flags')).toBe(hasMod('flags'));
    expect(navIds.has('webhooks')).toBe(hasMod('webhooks'));
    expect(navIds.has('webhook-endpoints')).toBe(hasMod('webhooks'));
    expect(navIds.has('legal')).toBe(true);
  });

  it('links every routed advanced admin surface from the advanced navigation', () => {
    const navIds: ReadonlySet<string> = new Set(
      getAdminNavSurfaces({ advancedAdminEnabled: true }).map((surface) => surface.id),
    );

    expect(navIds.has('security')).toBe(true);
    expect(navIds.has('audit')).toBe(true);
    expect(navIds.has('legal')).toBe(true);
    expect(navIds.has('support')).toBe(hasMod('support'));
    expect(navIds.has('feature-flags')).toBe(hasMod('flags'));
    expect(navIds.has('notifications')).toBe(hasNotificationsModule);
    expect(navIds.has('webhooks')).toBe(hasMod('webhooks'));
    expect(navIds.has('webhook-endpoints')).toBe(hasMod('webhooks'));
    // The internal route manifest stays URL-routable but is never linked from
    // navigation, even under advanced admin.
    expect(navIds.has('route-manifest')).toBe(false);
  });
});

// ============================================================================
// flattenAppRoutes — the prerenderer resolves site-map paths through this
// ============================================================================

describe('flattenAppRoutes', () => {
  const pages = flattenAppRoutes(createAppRoutes({ developerToolsEnabled: true }));

  it('resolves / to the page the router renders there, not to the layout that holds it', () => {
    // PublicShell holds the index LandingPage. A flattener that stopped at the
    // parent would hand the prerenderer the shell instead of the page.
    expect(pages.get('/')?.element).toBe(LandingPage);
  });

  it('composes a child path onto its parent', () => {
    expect(pages.get('/terms')?.element).toBeDefined();
    expect(pages.get('/privacy')?.element).toBeDefined();
    expect(pages.get('/terms')?.element).not.toBe(pages.get('/privacy')?.element);
    // Not '//terms', and not the bare segment.
    expect(pages.has('//terms')).toBe(false);
    expect(pages.has('terms')).toBe(false);
  });

  it('keeps an alias distinct from the page it aliases', () => {
    // /terms-of-service exists to keep old links alive. It resolves, but it is
    // its own key — the site map lists only /terms, so only /terms is rendered.
    expect(pages.get('/terms-of-service')?.element).toBeDefined();
    expect(pages.has('/terms')).toBe(true);
    expect(pages.has('/terms-of-service')).toBe(true);
  });

  it('serves the file-owned legal pages — and their aliases — from @bslt/compliance/web', () => {
    expect(pages.get('/cookies')?.element).toBeDefined();
    expect(pages.get('/cookie-policy')?.element).toBeDefined();
    expect(pages.get('/acceptable-use')?.element).toBeDefined();
    expect(pages.get('/disclaimer')?.element).toBeDefined();
  });

  it('treats a child path that starts with / as already absolute', () => {
    expect(pages.has('/side-peek-ui-library')).toBe(true);
  });

  it('resolves a nested layout to its index page', () => {
    if (hasAdminModule) {
      expect(pages.get('/admin')?.adminSurface).toBe('health');
      expect(pages.get('/admin/users')?.adminSurface).toBe('users');
    } else {
      expect(pages.get('/admin')?.adminSurface).toBe('dashboard');
    }
  });

  it('holds pages only — a route with children is a layout, and is recursed into', () => {
    for (const route of pages.values()) {
      expect(route.children ?? []).toHaveLength(0);
    }
  });

  it('exposes declared route unlisted metadata aligned with flattened page paths', () => {
    const opts: AppRouteOptions = {
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
      teamsEnabled: false,
    };
    const declared = getDeclaredAppRoutes(opts);
    expect(declared.find((r) => r.path === '/activities')?.unlisted).toBe(false);
    if (hasMod('tasks')) {
      expect(declared.find((r) => r.path === '/tasks')?.unlisted).toBe(false);
    }
    expect(declared.find((r) => r.path === '/login')?.unlisted).toBe(true);
    expect(declared.find((r) => r.path === '/*')?.unlisted).toBe(true);
  });
});

// ============================================================================
// createPendingAppRoutes — the table while the viewer's context is loading
// ============================================================================

describe('createPendingAppRoutes', () => {
  const Pending = (): null => null;
  const pendingPages = (): ReadonlyMap<string, AppRoute> =>
    flattenAppRoutes(createPendingAppRoutes(Pending));

  const everything: AppRouteOptions = {
    advancedAdminEnabled: true,
    advancedAuthEnabled: true,
    billingEnabled: true,
    developerToolsEnabled: true,
    teamsEnabled: true,
  };
  const starter: AppRouteOptions = {
    advancedAdminEnabled: false,
    advancedAuthEnabled: false,
    billingEnabled: false,
    developerToolsEnabled: false,
    teamsEnabled: false,
  };

  /** What a page resolves to, comparable across tables (module pages are rebuilt per table). */
  const resolution = (route: AppRoute | undefined): readonly unknown[] => [
    route === undefined ? undefined : routePageName(route.element),
    route?.protected,
    route?.publicOnly,
  ];
  const resolutions = (routes: readonly AppRoute[]): ReadonlyMap<string, readonly unknown[]> =>
    new Map([...flattenAppRoutes(routes)].map(([path, route]) => [path, resolution(route)]));

  // Taken while the suite is collected, before any test builds the pending
  // table: a build that wrote into the shared route entries would already be
  // in a capture taken later.
  const settledStarter = resolutions(createAppRoutes(starter));
  const settledEverything = resolutions(createAppRoutes(everything));

  it('holds every flag-gated route in its slot, with no guard', () => {
    const pages = pendingPages();
    for (const path of flattenAppRoutes(createAppRoutes(everything)).keys()) {
      expect(pages.has(path), path).toBe(true);
    }

    const expectedHeldPaths = [
      '/side-peek-ui-library',
      '/settings/accounts',
      '/auth/magic-link/verify',
      ...(hasAdminModule ? ['/admin/dashboard'] : []),
      ...(hasBillingModule
        ? ['/settings/billing', '/pricing', '/billing/success', '/billing/cancel']
        : []),
      ...(hasOrgsModule ? ['/organization', '/invitations/:id/accept'] : []),
    ];
    for (const path of expectedHeldPaths) {
      const route = pages.get(path);
      // Deciding before the viewer's context settles would be a guess, even a
      // login redirect: the held route only keeps the URL.
      expect(route?.element, path).toBe(Pending);
      expect(route?.protected, path).toBeUndefined();
      expect(route?.publicOnly, path).toBeUndefined();
      expect(route?.adminSurface, path).toBeUndefined();
    }
  });

  it('keeps first-match order', () => {
    const pendingRoutes = createPendingAppRoutes(Pending);
    const children = appShellChildren(pendingRoutes);
    const indexOf = (path: string): number => children.findIndex((route) => route.path === path);

    expect(indexOf('settings/accounts')).toBeGreaterThan(-1);
    expect(indexOf('settings/accounts')).toBeLessThan(indexOf('settings/:tab'));
    if (hasBillingModule) {
      expect(indexOf('settings/billing')).toBeGreaterThan(-1);
      expect(indexOf('settings/billing')).toBeLessThan(indexOf('settings/:tab'));
      expect(children.find((route) => route.path === 'pricing')?.element).toBe(Pending);
    }
    expect(children.at(-1)?.path).toBe('*');
    if (hasAdminModule) {
      expect(adminRoutes(pendingRoutes).find((route) => route.path === 'dashboard')?.element).toBe(
        Pending,
      );
    }
  });

  it('exposes no page the settled starter table excludes', () => {
    for (const [path, route] of pendingPages()) {
      if (route.element === Pending) continue;
      expect(resolution(route), path).toEqual(settledStarter.get(path));
    }

    // Building the pending table leaves the settled tables as they were.
    expect(resolutions(createAppRoutes(starter))).toEqual(settledStarter);
    expect(resolutions(createAppRoutes(everything))).toEqual(settledEverything);
  });

  it('leaves every live site page as it is', () => {
    const pages = pendingPages();
    // The settled table the prerenderer resolves live pages through.
    const settled = flattenAppRoutes();

    for (const { path } of livePages()) {
      const route = pages.get(path);
      expect(route?.element, path).not.toBe(Pending);
      expect(route?.element, path).toBe(settled.get(path)?.element);
      expect(route?.protected, path).toBe(settled.get(path)?.protected);
      expect(route?.publicOnly, path).toBe(settled.get(path)?.publicOnly);
    }
  });
});

describe('installed web module routes', () => {
  it('enforces WebRoute.requires in settled tables and holds gated module routes while context is loading', () => {
    const Pending = () => null;
    const starterPages = flattenAppRoutes(
      createAppRoutes({
        advancedAdminEnabled: false,
        advancedAuthEnabled: false,
        billingEnabled: false,
        developerToolsEnabled: false,
        teamsEnabled: false,
      }),
    );
    const everythingPages = flattenAppRoutes(
      createAppRoutes({
        advancedAdminEnabled: true,
        advancedAuthEnabled: true,
        billingEnabled: true,
        developerToolsEnabled: true,
        teamsEnabled: true,
      }),
    );
    const pendingPages = flattenAppRoutes(createPendingAppRoutes(Pending));

    for (const web of [...installedWebModules, ...devOnlyWebModules]) {
      for (const route of web?.routes ?? []) {
        if (route.requires === undefined || route.requires.length === 0) continue;
        if (route.path === '/pricing') {
          // Stale-bookmark fallback registers BillingUnavailablePage when billing is disabled.
          const starterPricing = starterPages.get(route.path);
          const everythingPricing = everythingPages.get(route.path);
          expect(
            starterPricing !== undefined ? routePageName(starterPricing.element) : undefined,
            '/pricing uses fallback in starter',
          ).toBe('BillingUnavailablePage');
          expect(
            everythingPricing !== undefined ? routePageName(everythingPricing.element) : undefined,
            '/pricing uses module page in everything',
          ).toBe('PricingPage');
        } else {
          expect(starterPages.has(route.path), `${route.path} excluded in starter`).toBe(false);
          expect(everythingPages.has(route.path), `${route.path} included in everything`).toBe(
            true,
          );
        }
        expect(pendingPages.get(route.path)?.element, `${route.path} held as Pending`).toBe(
          Pending,
        );
      }
    }
  });
});
