// main/tools/snapshot/web-routes.test.ts
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { repoPath } from '../lib/paths';

import { checkSnapshot } from './snapshot-file';
import {
  WEB_ROUTES_SNAPSHOT,
  describeWebRoutes,
  loadWebSurfaces,
  routesOverlap,
  serializeWebSurfaces,
  type WebRouteNode,
  type WebSurface,
} from './web-routes';

const TREE: WebRouteNode[] = [
  { path: '/standalone', page: 'StandalonePage', publicOnly: true },
  {
    path: '/',
    page: 'AppShell',
    children: [
      { index: true, page: 'LandingPage', publicOnly: true, publicOnlyRedirectTo: '/dashboard' },
      { path: 'login', page: 'LoginPage' },
      { path: 'settings/billing', page: 'BillingSettingsPage', protected: true },
      { path: 'settings/:tab', page: 'SettingsPage', protected: true },
      {
        path: 'admin',
        page: 'AdminLayout',
        children: [
          { index: true, page: 'HealthPage', adminSurface: 'health' },
          { path: 'users/:id', page: 'UserDetailPage', adminSurface: 'users' },
        ],
      },
      { path: '*', page: 'NotFoundPage' },
    ],
  },
];

describe('routesOverlap', () => {
  it('is true when one URL can match both patterns', () => {
    expect(routesOverlap('/settings/billing', '/settings/:tab')).toBe(true);
    expect(routesOverlap('/settings/:tab', '/settings/billing')).toBe(true);
    expect(routesOverlap('/a/:x/c', '/a/b/:y')).toBe(true);
    expect(routesOverlap('/login', '/login')).toBe(true);
    expect(routesOverlap('/*', '/anything/at/all')).toBe(true);
    expect(routesOverlap('/admin/*', '/admin/users')).toBe(true);
  });

  it('is false when no URL can', () => {
    expect(routesOverlap('/login', '/register')).toBe(false);
    expect(routesOverlap('/settings', '/settings/:tab')).toBe(false);
    expect(routesOverlap('/admin/*', '/settings/billing')).toBe(false);
    expect(routesOverlap('/a/:x', '/a/:x/c')).toBe(false);
  });
});

describe('describeWebRoutes', () => {
  it('lists every page at its full path, sorted, with its guard and its layouts', () => {
    expect(describeWebRoutes(TREE)).toEqual([
      {
        path: '/',
        page: 'LandingPage',
        guard: 'publicOnly',
        publicOnlyRedirectTo: '/dashboard',
        layouts: ['AppShell'],
        adminSurface: null,
        takesPrecedenceOver: [],
      },
      {
        path: '/*',
        page: 'NotFoundPage',
        guard: 'none',
        publicOnlyRedirectTo: null,
        layouts: ['AppShell'],
        adminSurface: null,
        takesPrecedenceOver: [],
      },
      {
        path: '/admin',
        page: 'HealthPage',
        guard: 'none',
        publicOnlyRedirectTo: null,
        layouts: ['AppShell', 'AdminLayout'],
        adminSurface: 'health',
        takesPrecedenceOver: [],
      },
      {
        path: '/admin/users/:id',
        page: 'UserDetailPage',
        guard: 'none',
        publicOnlyRedirectTo: null,
        layouts: ['AppShell', 'AdminLayout'],
        adminSurface: 'users',
        takesPrecedenceOver: [],
      },
      {
        path: '/login',
        page: 'LoginPage',
        guard: 'none',
        publicOnlyRedirectTo: null,
        layouts: ['AppShell'],
        adminSurface: null,
        takesPrecedenceOver: [],
      },
      {
        path: '/settings/:tab',
        page: 'SettingsPage',
        guard: 'protected',
        publicOnlyRedirectTo: null,
        layouts: ['AppShell'],
        adminSurface: null,
        takesPrecedenceOver: [],
      },
      {
        path: '/settings/billing',
        page: 'BillingSettingsPage',
        guard: 'protected',
        publicOnlyRedirectTo: null,
        layouts: ['AppShell'],
        adminSurface: null,
        takesPrecedenceOver: ['/settings/:tab'],
      },
      {
        path: '/standalone',
        page: 'StandalonePage',
        guard: 'publicOnly',
        publicOnlyRedirectTo: null,
        layouts: [],
        adminSurface: null,
        takesPrecedenceOver: [],
      },
    ]);
  });

  it('shows a route declared after the pattern that already takes its URLs', () => {
    const [app] = TREE.slice(1);
    const swapped: WebRouteNode[] = [
      {
        ...(app as WebRouteNode),
        children: [
          { path: 'settings/:tab', page: 'SettingsPage', protected: true },
          { path: 'settings/billing', page: 'BillingSettingsPage', protected: true },
        ],
      },
    ];

    const routes = describeWebRoutes(swapped);

    expect(routes.find((route) => route.path === '/settings/:tab')?.takesPrecedenceOver).toEqual([
      '/settings/billing',
    ]);
    expect(routes.find((route) => route.path === '/settings/billing')?.takesPrecedenceOver).toEqual(
      [],
    );
  });

  it('a guard on a layout holds for the pages under it', () => {
    const routes = describeWebRoutes([
      {
        path: '/account',
        page: 'AccountLayout',
        protected: true,
        children: [{ path: 'keys', page: 'KeysPage' }],
      },
    ]);

    expect(routes).toMatchObject([{ path: '/account/keys', guard: 'protected' }]);
  });

  it('lists what a wildcard makes unreachable, not the wildcard under every route', () => {
    const routes = describeWebRoutes([
      { path: '/first', page: 'FirstPage' },
      { path: '/*', page: 'NotFoundPage' },
      { path: '/late', page: 'LatePage' },
      { path: '/late/*', page: 'LateWildcardPage' },
    ]);

    expect(routes.map((route) => [route.path, route.takesPrecedenceOver])).toEqual([
      ['/*', ['/late', '/late/*']],
      ['/first', []],
      ['/late', []],
      ['/late/*', []],
    ]);
  });

  it('keeps a path declared twice, the first before the second', () => {
    const routes = describeWebRoutes([
      { path: '/same', page: 'FirstPage' },
      { path: '/same', page: 'SecondPage' },
    ]);

    expect(routes.map((route) => [route.page, route.takesPrecedenceOver])).toEqual([
      ['FirstPage', ['/same']],
      ['SecondPage', []],
    ]);
  });
});

describe('bslt snapshot web-routes', () => {
  let surfaces: WebSurface[] | undefined;
  const load = async (): Promise<WebSurface[]> => (surfaces ??= await loadWebSurfaces());

  it('is byte-identical on two runs', async () => {
    const first = serializeWebSurfaces(await load());
    const second = serializeWebSurfaces(await loadWebSurfaces());

    expect(second).toBe(first);
  }, 120_000);

  it('records the routes, guards, navigation, settings and admin entries of the web app', async () => {
    const [starter, everything] = await load();
    if (starter === undefined || everything === undefined) throw new Error('two configurations');
    const route = (surface: WebSurface, path: string): unknown =>
      describeWebRoutes(surface.routes).find((entry) => entry.path === path);

    expect([starter.name, everything.name]).toEqual(['starter', 'everything']);
    expect(Object.values(starter.flags).every((flag) => !flag)).toBe(true);
    expect(Object.values(everything.flags).every((flag) => flag)).toBe(true);

    const hasAdmin = existsSync(repoPath('main/modules/admin'));
    const hasBilling = existsSync(repoPath('main/modules/billing'));
    const hasOrgs = existsSync(repoPath('main/modules/orgs'));
    const hasTasks = existsSync(repoPath('main/modules/tasks'));
    const hasFiles = existsSync(repoPath('main/modules/files'));

    expect(route(starter, '/dashboard')).toMatchObject({
      page: 'DashboardPage',
      guard: 'protected',
      layouts: ['AppShell'],
    });
    expect(route(starter, '/')).toMatchObject({
      page: 'LandingPage',
      guard: 'publicOnly',
      layouts: ['PublicShell'],
    });
    if (hasAdmin) {
      expect(route(starter, '/admin/users')).toMatchObject({
        page: 'UserListPage',
        layouts: ['ConsoleShell', 'AdminLayout'],
        adminSurface: 'users',
      });
    } else {
      expect(route(starter, '/admin')).toMatchObject({
        page: 'AdminDashboardPage',
        layouts: ['ConsoleShell', 'AdminLayout'],
        adminSurface: 'dashboard',
      });
    }
    if (hasBilling) {
      // The same path, another page: billing off shows the notice.
      expect(route(starter, '/pricing')).toMatchObject({ page: 'BillingUnavailablePage' });
      expect(route(everything, '/pricing')).toMatchObject({ page: 'PricingPage' });
      // First match wins: the billing tab is declared before the tab pattern.
      expect(route(everything, '/settings/billing')).toMatchObject({
        takesPrecedenceOver: ['/settings/:tab'],
      });
    }
    expect(route(starter, '/admin/tenants')).toBeUndefined();
    if (hasOrgs) {
      expect(route(everything, '/admin/tenants')).toMatchObject({ adminSurface: 'tenants' });
    }

    expect(starter.navigation.primary.signedOut).toEqual([
      { label: 'Home', to: '/' },
      { label: 'App Guide', to: '/docs' },
      { label: 'Changelog', to: '/changelog' },
    ]);
    const signedInLinks = starter.navigation.primary.signedIn.map((link) => link.to);
    expect(signedInLinks[0]).toBe('/dashboard');
    expect(signedInLinks).not.toContain('/profile');
    if (hasTasks) expect(signedInLinks).toContain('/tasks');
    if (hasFiles) expect(signedInLinks).toContain('/files');
    expect(signedInLinks.slice(-2)).toEqual(['/activities', '/settings']);
    expect(starter.navigation.primary.admin.at(-1)).toEqual({ label: 'Admin', to: '/admin' });
    expect(everything.navigation.primary.signedIn.map((link) => link.to)).toContain('/activities');
    if (hasOrgs) {
      expect(everything.navigation.primary.signedIn.map((link) => link.to)).toContain(
        '/organization',
      );
    }
    expect(starter.navigation.footer.flatMap((section) => section.links)).toContainEqual({
      title: 'Terms of Service',
      path: '/terms',
    });
    expect(starter.navigation.commandPalette).toContainEqual({
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      category: 'navigation',
      navigatesTo: '/dashboard',
    });
    if (hasBilling) {
      expect(everything.navigation.commandPalette.map((command) => command.navigatesTo)).toContain(
        '/pricing',
      );
    }

    expect(starter.settings.map((tab) => tab.id)).not.toContain('billing');
    if (hasBilling) {
      expect(everything.settings.map((tab) => tab.id)).toContain('billing');
    }
    const adminNavIds = starter.admin
      .filter((entry) => entry.inNavigation)
      .map((entry) => entry.id);
    const hasGrowth = existsSync(repoPath('main/modules/growth/module.ts'));
    const hasSupport = existsSync(repoPath('main/modules/support/module.ts'));
    const hasModeration = existsSync(repoPath('main/modules/moderation/module.ts'));
    const hasFlags = existsSync(repoPath('main/modules/flags/module.ts'));
    const hasWebhooks = existsSync(repoPath('main/modules/webhooks/module.ts'));
    const hasEntitlements = existsSync(repoPath('main/modules/entitlements/module.ts'));
    const hasNotifications = existsSync(repoPath('main/modules/notifications/module.ts'));
    const expectedAdminNavIds = [
      ...(hasAdmin ? ['health', 'users'] : ['dashboard']),
      'security',
      ...(hasGrowth ? ['growth'] : []),
      'audit',
      ...(hasSupport ? ['support'] : []),
      ...(hasModeration ? ['moderation'] : []),
      ...(hasFlags ? ['feature-flags'] : []),
      ...(hasWebhooks ? ['webhooks', 'webhook-endpoints'] : []),
      ...(hasEntitlements ? ['entitlements'] : []),
      'legal',
      'compliance',
      ...(hasNotifications ? ['notifications'] : []),
    ];
    expect(adminNavIds).toEqual(expectedAdminNavIds);
    expect(everything.admin.find((entry) => entry.id === 'route-manifest')).toMatchObject({
      href: '/admin/routes',
      inNavigation: false,
    });
  }, 120_000);

  it('detects a route that was added and a guard that was dropped', async () => {
    const current = await load();
    const seeded = structuredClone(current);
    const app = seeded[0]?.routes.find((node) => node.page === 'AppShell');
    app?.children?.unshift({ path: 'seeded', page: 'SeededPage' });
    const dashboard = app?.children?.find((node) => node.path === 'dashboard');
    if (dashboard === undefined) throw new Error('no dashboard route');
    delete dashboard.protected;

    expect(serializeWebSurfaces(current)).not.toBe(serializeWebSurfaces(seeded));
    const result = checkSnapshot(WEB_ROUTES_SNAPSHOT, serializeWebSurfaces(seeded));
    expect(result.ok).toBe(false);
    const problems = (result.problems ?? []).join('\n');
    expect(problems).toContain('"path": "/seeded"');
    expect(problems).toContain('-           "guard": "protected",');
    expect(problems).toContain('pnpm bslt snapshot web-routes');
  }, 120_000);
});
