// main/kernel/web/src/create-web-app.test.ts
import { defineModule, endpoint, mergeCapabilityContributions } from '@bslt/contract';
import { object, string } from '@bslt/schema';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import {
  createWebApp,
  eagerModulePage,
  EMPTY_CAPABILITY_CONTEXT,
  implementWeb,
  lazyModulePage,
  type AppFrameConfig,
  type ComposedAppRoute,
  type FrameAdminSurfaceContribution,
  type FrameChildRoute,
  type FrameDashboardActionContribution,
  type FrameDashboardTileContribution,
  type FramePaletteContribution,
  type FramePrimaryNavContribution,
  type FrameRouteContribution,
  type FrameRouteSlot,
  type FrameSettingsSectionContribution,
  type FrameSitePageContribution,
  type ModuleNotificationRouteRule,
  type PrimaryNavHint,
  type ResolvedAdminSurface,
  type ResolvedDeclaredRoute,
  type ResolvedPaletteEntry,
  type ResolvedSettingsSection,
  type ResolvedSitePage,
  type SiteSection,
  type WebApp,
  type WebShellConfig,
} from './index';

function StubPublicShell(): ReactElement {
  return createElement('div', null, 'public-shell');
}
function StubAuthShell(): ReactElement {
  return createElement('div', null, 'auth-shell');
}
function StubAppShell(): ReactElement {
  return createElement('div', null, 'app-shell');
}
function StubConsoleShell(): ReactElement {
  return createElement('div', null, 'console-shell');
}
function StubAdminLayout(): ReactElement {
  return createElement('div', null, 'admin-layout');
}
function StubPage(): ReactElement {
  return createElement('div', null, 'page');
}

const SHELLS: WebShellConfig = {
  publicShell: StubPublicShell,
  authShell: StubAuthShell,
  appShell: StubAppShell,
  consoleShell: StubConsoleShell,
  adminLayout: StubAdminLayout,
  lazyModuleRoutePage: () => StubPage,
};

const tasksManifest = defineModule({
  id: 'tasks',
  summary: 'Tasks module',
  status: 'stable',
  dependsOn: [],
  endpoints: {
    list: endpoint({
      method: 'GET',
      path: '/api/tasks',
      auth: 'user',
      response: object({ ok: string({ label: 'ok' }) }),
      persist: true,
      summary: 'List tasks',
    }),
    secret: endpoint({
      method: 'GET',
      path: '/api/tasks/secret',
      auth: 'user',
      response: object({ ok: string({ label: 'ok' }) }),
      summary: 'Non-persisted tasks endpoint',
    }),
  },
  events: {},
  jobs: {},
  tables: ['tasks'],
});

const notesManifest = defineModule({
  id: 'notes',
  summary: 'Notes module',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
});

interface TestFlags {
  readonly billingEnabled: boolean;
  readonly advancedAdminEnabled: boolean;
}

describe('createWebApp', () => {
  it('rejects duplicate module route paths across installed web modules', () => {
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const modA = implementWeb(tasksManifest, {
      routes: [{ path: '/shared', shell: 'app', auth: 'user', title: 'tasks.title', page }],
      messages: { 'tasks.title': 'Tasks' },
    });
    const modB = implementWeb(notesManifest, {
      routes: [{ path: '/shared', shell: 'app', auth: 'user', title: 'notes.title', page }],
      messages: { 'notes.title': 'Notes' },
    });

    expect(() => createWebApp<TestFlags>({ modules: [modA, modB] })).toThrow(/\/shared/u);
  });

  it('rejects duplicate palette entry ids between modules and frame contributions', () => {
    const mod = implementWeb(tasksManifest, {
      routes: [],
      nav: [
        {
          to: '/tasks',
          slot: 'palette',
          label: 'tasks.palette',
          icon: 'check-square',
          order: 10,
        },
      ],
      messages: { 'tasks.palette': 'Go to Tasks' },
    });
    const framePalette: FramePaletteContribution<TestFlags> = {
      id: 'nav-tasks',
      label: 'Duplicate Tasks',
      description: 'Duplicate',
      category: 'navigation',
      to: '/tasks',
      keywords: [],
      order: 20,
    };

    expect(() =>
      createWebApp<TestFlags>({
        modules: [mod],
        frame: { palette: [framePalette] },
      }),
    ).toThrow(/nav-tasks/u);
  });

  it('rejects duplicate settings section ids or colliding aliases', () => {
    const mod = implementWeb(tasksManifest, {
      routes: [],
      settings: [
        {
          id: 'tasks',
          label: 'tasks.settings',
          kind: 'section',
          aliases: ['work'],
          order: 10,
        },
      ],
      messages: { 'tasks.settings': 'Tasks' },
    });

    expect(() =>
      createWebApp<TestFlags>({
        modules: [mod],
        frame: {
          settingsSections: [{ id: 'tasks', label: 'Duplicate', kind: 'section', order: 20 }],
        },
      }),
    ).toThrow(/tasks/u);

    expect(() =>
      createWebApp<TestFlags>({
        modules: [mod],
        frame: {
          settingsSections: [
            { id: 'other', label: 'Other', kind: 'section', aliases: ['work'], order: 20 },
          ],
        },
      }),
    ).toThrow(/work/u);
  });

  it('rejects duplicate admin surface ids across modules and frame', () => {
    const mod = implementWeb(tasksManifest, {
      routes: [],
      admin: [
        {
          id: 'tasks',
          label: 'tasks.admin',
          href: '/admin/tasks',
          routePath: 'tasks',
          order: 10,
        },
      ],
      messages: { 'tasks.admin': 'Tasks' },
    });

    expect(() =>
      createWebApp<TestFlags>({
        modules: [mod],
        frame: {
          adminSurfaces: [
            {
              id: 'tasks',
              label: 'Tasks Frame',
              href: '/admin/tasks',
              routePath: 'tasks',
              order: 20,
            },
          ],
        },
      }),
    ).toThrow(/tasks/u);
  });

  it('rejects duplicate sitePage paths across modules and frame', () => {
    const mod = implementWeb(tasksManifest, {
      routes: [],
      sitePages: [
        {
          path: '/terms',
          title: 'tasks.terms',
          section: 'legal',
          live: true,
          order: 10,
        },
      ],
      messages: { 'tasks.terms': 'Terms' },
    });

    expect(() =>
      createWebApp<TestFlags>({
        modules: [mod],
        frame: {
          sitePages: [{ path: '/terms', title: 'Terms', section: 'legal', live: true, order: 20 }],
        },
      }),
    ).toThrow(/\/terms/u);
  });

  it('rejects duplicate notificationRoutes keys and rejects unsafe non-slash notification URLs', () => {
    const modA = implementWeb(tasksManifest, {
      routes: [],
      notificationRoutes: { 'tasks.assigned': () => '/tasks' },
      messages: {},
    });
    const modB = implementWeb(tasksManifest, {
      routes: [],
      notificationRoutes: { 'tasks.assigned': () => '/tasks' },
      messages: {},
    });

    expect(() => createWebApp<TestFlags>({ modules: [modA, modB] })).toThrow(/tasks\.assigned/u);

    const app = createWebApp<TestFlags>({ modules: [modA] });
    expect(app.resolveNotificationRoute({ url: 'https://evil.example/phish' })).toBeNull();
    expect(app.resolveNotificationRoute({ url: '//evil.example/phish' })).toBeNull();
    expect(app.resolveNotificationRoute(null)).toBeNull();
    expect(app.resolveNotificationRoute({})).toBeNull();
  });

  it('enforces default-deny query persistence on empty, non-string, unpersisted module, and unlisted heads', () => {
    const app = createWebApp<TestFlags>({
      modules: [],
      installedManifests: [tasksManifest],
    });

    expect(app.isPersistableQueryKey([])).toBe(false);
    expect(app.isPersistableQueryKey([42, 'user'])).toBe(false);
    expect(app.isPersistableQueryKey(['tasks', 'secret'])).toBe(false);
    expect(app.isPersistableQueryKey(['billing', 'invoices'])).toBe(false);
    expect(app.isPersistableQueryKey(['unknownHead'])).toBe(false);
    expect(app.isPersistableQueryKey(['files', 'list'])).toBe(false);
    expect(app.isPersistableQueryKey(['tasks', 'list'])).toBe(true);
  });

  it('Throws when getRoutes is called without configured shells', () => {
    const app = createWebApp<TestFlags>({ modules: [] });
    expect(() => app.getRoutes({ billingEnabled: false, advancedAdminEnabled: false })).toThrow(
      /shells/u,
    );
  });

  it('aggregates module and frame contributions across all 10 surfaces deterministically', () => {
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const moduleNotifRules: readonly ModuleNotificationRouteRule[] = [
      { field: 'actionPrefix', match: 'billing.', to: '/settings/billing' },
      { field: 'notificationType', match: 'security_alert', to: '/settings?tab=security' },
      { field: 'notificationTypePrefix', match: 'billing_', to: '/settings/billing' },
    ];
    const tasksWeb = implementWeb(tasksManifest, {
      routes: [
        { path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.title', page },
        {
          path: '/admin/tasks',
          shell: 'console',
          auth: 'admin',
          title: 'tasks.adminTitle',
          page,
        },
      ],
      nav: [
        {
          to: '/tasks',
          slot: 'app.primary',
          label: 'tasks.nav',
          hint: 'tasks.hint',
          icon: 'check-square',
          order: 40,
        },
        {
          to: '/tasks',
          slot: 'palette',
          label: 'tasks.paletteLabel',
          description: 'tasks.paletteDesc',
          keywords: ['todo'],
          icon: 'check-square',
          order: 35,
        },
        {
          to: '/tasks',
          slot: 'dashboard',
          label: 'tasks.nav',
          description: 'tasks.dashDesc',
          actionLabel: 'tasks.dashAction',
          icon: 'check-square',
          order: 15,
        },
      ],
      admin: [
        {
          id: 'tasks',
          label: 'tasks.adminTitle',
          href: '/admin/tasks',
          routePath: 'tasks',
          order: 30,
        },
      ],
      notificationRoutes: {
        'tasks.assigned': (data) =>
          typeof data['taskId'] === 'string' ? `/tasks?id=${data['taskId']}` : '/tasks',
      },
      notificationRules: moduleNotifRules,
      messages: {
        'tasks.title': 'Tasks',
        'tasks.adminTitle': 'Admin Tasks',
        'tasks.nav': 'Tasks',
        'tasks.hint': 'Track work',
        'tasks.paletteLabel': 'Go to Tasks',
        'tasks.paletteDesc': 'Navigate to tasks',
        'tasks.dashDesc': 'Personal task tracking.',
        'tasks.dashAction': 'Open tasks',
      },
    });

    const slot: FrameRouteSlot = 'before-modules';
    const childRoute: FrameChildRoute = { index: true, element: StubPage, unlisted: true };
    const frameRoutes: readonly FrameRouteContribution<TestFlags>[] = [
      { slot, shell: 'public', index: true, element: StubPage, publicOnly: true },
      {
        slot: 'after-modules',
        path: 'search',
        element: StubAdminLayout,
        children: [childRoute],
        unlisted: true,
      },
      { slot: 'after-modules', path: 'files', element: StubPage, protected: true },
      { slot: 'admin', path: 'health', element: StubPage, adminSurface: 'health' },
      { slot: 'after-modules', path: '*', element: StubPage, unlisted: true },
    ];
    const hint: PrimaryNavHint = {
      featureKey: 'files',
      title: 'Files',
      description: 'Manage files',
    };
    const framePrimaryNav: readonly FramePrimaryNavContribution<TestFlags>[] = [
      { to: '/', label: 'Home', audience: 'public', order: 10 },
      { to: '/dashboard', label: 'Dashboard', audience: 'authenticated', order: 10 },
      { to: '/files', label: 'Files', audience: 'authenticated', hint, order: 50 },
      { to: '/admin', label: 'Admin', audience: 'admin', order: 90 },
    ];
    const framePalette: readonly FramePaletteContribution<TestFlags>[] = [
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        description: 'Main dashboard',
        category: 'navigation',
        to: '/dashboard',
        keywords: ['home'],
        order: 10,
      },
      {
        id: 'action-theme',
        label: 'Change Theme',
        description: 'Toggle theme',
        category: 'action',
        actionId: 'cycle-theme',
        keywords: ['dark'],
        order: 100,
      },
    ];
    const frameAdmin: readonly FrameAdminSurfaceContribution<TestFlags>[] = [
      { id: 'health', label: 'Health', href: '/admin/health', routePath: 'health', order: 10 },
      {
        id: 'audit',
        label: 'Audit',
        href: '/admin/audit',
        routePath: 'audit',
        order: 20,
        when: (flags) => flags.advancedAdminEnabled,
      },
      {
        id: 'route-manifest',
        label: 'API Routes',
        href: '/admin/routes',
        routePath: 'routes',
        unlisted: true,
        order: 40,
      },
    ];
    const frameSettings: readonly FrameSettingsSectionContribution<TestFlags>[] = [
      { id: 'profile', label: 'Profile', kind: 'section', order: 10 },
      {
        id: 'data-controls',
        label: 'Data Controls',
        kind: 'section',
        aliases: ['privacy'],
        order: 20,
      },
      {
        id: 'billing',
        label: 'Billing',
        kind: 'route',
        to: '/settings/billing',
        order: 30,
        when: (flags) => flags.billingEnabled,
      },
    ];
    const siteSections: readonly SiteSection[] = [
      { id: 'product', label: 'Product' },
      { id: 'legal', label: 'Legal' },
    ];
    const frameSitePages: readonly FrameSitePageContribution<'terms_of_service'>[] = [
      { path: '/', title: 'Home', section: 'product', live: true, order: 10 },
      {
        path: '/terms',
        title: 'Terms',
        section: 'legal',
        document: 'terms_of_service',
        live: true,
        order: 20,
      },
    ];
    const frameDashActions: readonly FrameDashboardActionContribution[] = [
      { label: 'Files', to: '/files', order: 20 },
    ];
    const frameDashTiles: readonly FrameDashboardTileContribution[] = [
      {
        id: 'files',
        label: 'Files',
        value: 'Ready',
        description: 'Uploads ready.',
        href: '/files',
        actionLabel: 'Open files',
        order: 20,
      },
    ];

    const frame: AppFrameConfig<TestFlags, 'terms_of_service'> = {
      shells: SHELLS,
      routes: frameRoutes,
      primaryNav: framePrimaryNav,
      palette: framePalette,
      adminSurfaces: frameAdmin,
      settingsSections: frameSettings,
      siteSections,
      sitePages: frameSitePages,
      dashboardQuickActions: frameDashActions,
      dashboardTiles: frameDashTiles,
    };

    const webApp: WebApp<TestFlags, 'terms_of_service'> = createWebApp({
      modules: [null, tasksWeb],
      installedManifests: [tasksManifest],
      frame,
    });

    const starterFlags: TestFlags = { billingEnabled: false, advancedAdminEnabled: false };
    const fullFlags: TestFlags = { billingEnabled: true, advancedAdminEnabled: true };

    const routes: readonly ComposedAppRoute[] = webApp.getRoutes(starterFlags);
    expect(routes.map((r) => r.element)).toEqual([StubPublicShell, StubConsoleShell, StubAppShell]);
    expect(routes[0]?.children?.map((c) => c.path ?? '(index)')).toEqual(['(index)']);
    expect(routes[1]?.children?.map((c) => c.path ?? '(index)')).toEqual(['admin']);
    expect(routes[2]?.children?.map((c) => c.path ?? '(index)')).toEqual([
      'tasks',
      'search',
      'files',
      '*',
    ]);

    const declared: readonly ResolvedDeclaredRoute[] = webApp.getDeclaredRoutes(starterFlags);
    expect(declared).toContainEqual({ path: '/tasks', unlisted: false });
    expect(declared).toContainEqual({ path: '/*', unlisted: true });

    expect(
      webApp.getPrimaryNavLinks({ authenticated: false, admin: false, flags: starterFlags }),
    ).toEqual([{ label: 'Home', to: '/' }]);
    expect(
      webApp.getPrimaryNavLinks({ authenticated: true, admin: true, flags: starterFlags }),
    ).toEqual([
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Tasks', to: '/tasks' },
      { label: 'Files', to: '/files' },
      { label: 'Admin', to: '/admin' },
    ]);
    expect(webApp.getPrimaryNavHints()['Tasks']?.description).toBe('Track work');
    expect(webApp.getPrimaryNavHints()['Files']?.description).toBe('Manage files');

    const palette: readonly ResolvedPaletteEntry[] = webApp.getPaletteEntries({
      admin: false,
      flags: starterFlags,
    });
    expect(palette.map((p) => p.id)).toEqual(['nav-dashboard', 'nav-tasks', 'action-theme']);

    const allAdmin: readonly ResolvedAdminSurface[] = webApp.adminSurfaces;
    expect(allAdmin.map((a) => a.id)).toEqual(['health', 'audit', 'tasks', 'route-manifest']);
    expect(webApp.getAdminNavSurfaces(starterFlags).map((a) => a.id)).toEqual(['health', 'tasks']);
    expect(webApp.getAdminNavSurfaces(fullFlags).map((a) => a.id)).toEqual([
      'health',
      'audit',
      'tasks',
    ]);

    const allSettings: readonly ResolvedSettingsSection[] = webApp.settingsSections;
    expect(allSettings.map((s) => s.id)).toEqual(['profile', 'data-controls', 'billing']);
    expect(webApp.panelSettingsSectionIds).toEqual(['profile', 'data-controls']);
    expect(webApp.getSettingsNavItems(starterFlags).map((s) => s.id)).toEqual([
      'profile',
      'data-controls',
    ]);
    expect(webApp.getSettingsNavItems(fullFlags).map((s) => s.id)).toEqual([
      'profile',
      'data-controls',
      'billing',
    ]);
    expect(webApp.normalizeSettingsTab('#Privacy')).toBe('data-controls');

    const pages: readonly ResolvedSitePage<'terms_of_service'>[] = webApp.sitePages;
    expect(pages.map((p) => p.path)).toEqual(['/', '/terms']);
    expect(webApp.siteSections.map((s) => s.id)).toEqual(['product', 'legal']);

    expect(webApp.resolveNotificationRoute({ url: '/custom' })).toBe('/custom');
    expect(
      webApp.resolveNotificationRoute({ notificationType: 'tasks.assigned', taskId: '99' }),
    ).toBe('/tasks?id=99');
    expect(webApp.resolveNotificationRoute({ action: 'billing.invoice_paid' })).toBe(
      '/settings/billing',
    );
    expect(webApp.resolveNotificationRoute({ notificationType: 'security_alert' })).toBe(
      '/settings?tab=security',
    );
    expect(webApp.resolveNotificationRoute({ notificationType: 'billing_failed' })).toBe(
      '/settings/billing',
    );

    expect(webApp.dashboardQuickActions.map((a) => a.label)).toEqual(['Tasks', 'Files']);
    expect(webApp.dashboardTiles.map((t) => t.id)).toEqual(['tasks', 'files']);
  });

  it('maps nested console routes (/admin/<surface>/:id) to their parent adminSurface id', () => {
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const tasksAdminWeb = implementWeb(tasksManifest, {
      routes: [
        {
          path: '/admin/tasks',
          shell: 'console',
          auth: 'admin',
          title: 'tasks.listTitle',
          page,
        },
        {
          path: '/admin/tasks/:id',
          shell: 'console',
          auth: 'admin',
          title: 'tasks.detailTitle',
          page,
        },
      ],
      admin: [
        {
          id: 'task-endpoints',
          label: 'tasks.listTitle',
          href: '/admin/tasks',
          routePath: 'tasks',
          order: 10,
        },
      ],
      messages: {
        'tasks.listTitle': 'Task Endpoints',
        'tasks.detailTitle': 'Task Endpoint Detail',
      },
    });

    const webApp = createWebApp<TestFlags>({
      modules: [tasksAdminWeb],
      frame: { shells: SHELLS },
    });

    const routes = webApp.getRoutes({ billingEnabled: false, advancedAdminEnabled: false });
    const consoleShellNode = routes.find((r) => r.element === StubConsoleShell);
    const adminNode = consoleShellNode?.children?.find((c) => c.path === 'admin');
    expect(adminNode?.element).toBe(StubAdminLayout);
    expect(
      adminNode?.children?.map((c) => ({ path: c.path, adminSurface: c.adminSurface })),
    ).toEqual([
      { path: 'tasks', adminSurface: 'task-endpoints' },
      { path: 'tasks/:id', adminSurface: 'task-endpoints' },
    ]);
  });

  it('mounts non-/admin console shell routes (e.g. /search and devtools) under ConsoleShell with adminLayout only for admin-auth routes', () => {
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const searchManifest = defineModule({
      id: 'search',
      summary: 'Search module',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    const searchWeb = implementWeb(searchManifest, {
      routes: [
        {
          path: '/search',
          shell: 'console',
          auth: 'admin',
          title: 'search.title',
          unlisted: true,
          page,
        },
        {
          path: '/ui-library',
          shell: 'console',
          auth: 'public',
          publicOnly: true,
          title: 'search.catalogTitle',
          page,
        },
      ],
      messages: {
        'search.title': 'Search',
        'search.catalogTitle': 'UI Library',
      },
    });

    const webApp = createWebApp<TestFlags>({
      modules: [searchWeb],
      frame: { shells: SHELLS },
    });

    const routes = webApp.getRoutes({ billingEnabled: false, advancedAdminEnabled: false });
    expect(routes).toHaveLength(1);
    expect(routes[0]?.element).toBe(StubConsoleShell);
    const topChildren = routes[0]?.children ?? [];
    expect(topChildren.find((c) => c.path === 'admin')).toBeUndefined();
    expect(topChildren.find((c) => c.path === 'search')).toEqual({
      path: 'search',
      element: StubAdminLayout,
      children: [{ index: true, element: StubPage }],
    });
    expect(topChildren.find((c) => c.path === 'ui-library')).toEqual({
      path: 'ui-library',
      element: StubPage,
      publicOnly: true,
    });

    const declared = webApp.getDeclaredRoutes({
      billingEnabled: false,
      advancedAdminEnabled: false,
    });
    expect(declared).toEqual([
      { path: '/search', unlisted: true },
      { path: '/ui-library', unlisted: false },
    ]);
  });

  it('routes public, auth, app, and console module routes into their declared named shells', () => {
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const multiShellMod = implementWeb(tasksManifest, {
      routes: [
        { path: '/status', shell: 'public', auth: 'public', title: 'tasks.status', page },
        { path: '/login', shell: 'auth', auth: 'public', title: 'tasks.login', page },
        { path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.app', page },
        { path: '/admin/tasks', shell: 'console', auth: 'admin', title: 'tasks.console', page },
      ],
      messages: {
        'tasks.status': 'Status',
        'tasks.login': 'Login',
        'tasks.app': 'Tasks',
        'tasks.console': 'Admin Tasks',
      },
    });
    const webApp = createWebApp<TestFlags>({
      modules: [multiShellMod],
      frame: { shells: SHELLS },
    });

    const routes = webApp.getRoutes({ billingEnabled: false, advancedAdminEnabled: false });
    expect(routes.map((r) => r.element)).toEqual([
      StubPublicShell,
      StubAuthShell,
      StubConsoleShell,
      StubAppShell,
    ]);
    expect(routes[0]?.children?.map((c) => c.path)).toEqual(['status']);
    expect(routes[1]?.children?.map((c) => c.path)).toEqual(['login']);
    expect(routes[2]?.children?.[0]?.path).toBe('admin');
    expect(routes[3]?.children?.map((c) => c.path)).toEqual(['tasks']);
  });

  it('enforces WebRoute.requires against CapabilityContext and holds gated routes with pending while loading', () => {
    function PendingFallback(): ReactElement {
      return createElement('div', null, 'pending');
    }
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const gatedWeb = implementWeb(tasksManifest, {
      routes: [
        {
          path: '/tasks',
          shell: 'app',
          auth: 'user',
          title: 'tasks.openTitle',
          page,
        },
        {
          path: '/tasks/beta',
          shell: 'app',
          auth: 'user',
          requires: ['flag:tasks.beta'],
          title: 'tasks.betaTitle',
          page,
        },
        {
          path: '/admin/tasks-beta',
          shell: 'console',
          auth: 'admin',
          requires: ['flag:tasks.beta'],
          title: 'tasks.adminBetaTitle',
          page,
        },
      ],
      admin: [
        {
          id: 'tasks-beta',
          label: 'tasks.adminBetaTitle',
          href: '/admin/tasks-beta',
          routePath: 'tasks-beta',
          order: 20,
        },
      ],
      messages: {
        'tasks.openTitle': 'Tasks',
        'tasks.betaTitle': 'Beta Tasks',
        'tasks.adminBetaTitle': 'Admin Beta Tasks',
      },
    });

    const webApp = createWebApp<TestFlags>({
      modules: [gatedWeb],
      frame: { shells: SHELLS },
    });
    const flags: TestFlags = { billingEnabled: false, advancedAdminEnabled: false };

    const pendingRoutes = webApp.getRoutes(flags, { pending: PendingFallback });
    const pendingAppChildren =
      pendingRoutes.find((r) => r.element === StubAppShell)?.children ?? [];
    expect(pendingAppChildren.find((c) => c.path === 'tasks')).toEqual({
      path: 'tasks',
      element: StubPage,
      protected: true,
    });
    expect(pendingAppChildren.find((c) => c.path === 'tasks/beta')).toEqual({
      path: 'tasks/beta',
      element: PendingFallback,
    });
    const pendingConsoleChildren =
      pendingRoutes.find((r) => r.element === StubConsoleShell)?.children ?? [];
    const pendingAdmin = pendingConsoleChildren.find((c) => c.path === 'admin')?.children ?? [];
    expect(pendingAdmin.find((c) => c.path === 'tasks-beta')).toEqual({
      path: 'tasks-beta',
      element: PendingFallback,
    });

    const disabledCaps = mergeCapabilityContributions({
      modules: [tasksManifest],
      viewer: { userId: 'u-1', role: 'admin' },
      contributions: [{ flags: { 'tasks.beta': false } }],
    });
    const settledOff = webApp.getRoutes(flags, { capabilities: disabledCaps });
    const offChildren = settledOff.find((r) => r.element === StubAppShell)?.children ?? [];
    expect(offChildren.find((c) => c.path === 'tasks')).toBeDefined();
    expect(offChildren.find((c) => c.path === 'tasks/beta')).toBeUndefined();
    expect(settledOff.find((r) => r.element === StubConsoleShell)).toBeUndefined();

    const enabledCaps = mergeCapabilityContributions({
      modules: [tasksManifest],
      viewer: { userId: 'u-1', role: 'admin' },
      contributions: [{ flags: { 'tasks.beta': true } }],
    });
    const settledOn = webApp.getRoutes(flags, { capabilities: enabledCaps });
    const onAppChildren = settledOn.find((r) => r.element === StubAppShell)?.children ?? [];
    expect(onAppChildren.find((c) => c.path === 'tasks/beta')).toEqual({
      path: 'tasks/beta',
      element: StubPage,
      protected: true,
    });
    const onConsoleChildren = settledOn.find((r) => r.element === StubConsoleShell)?.children ?? [];
    expect(onConsoleChildren.find((c) => c.path === 'admin')?.children).toEqual([
      {
        path: 'tasks-beta',
        element: StubPage,
        adminSurface: 'tasks-beta',
      },
    ]);
  });

  it('preserves optional document metadata on module sitePages while rejecting duplicates', () => {
    const page = lazyModulePage(async () => ({ StubPage }), 'StubPage');
    const complianceManifest = defineModule({
      id: 'compliance',
      summary: 'Compliance',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    const complianceWeb = implementWeb(complianceManifest, {
      routes: [
        { path: '/terms', shell: 'public', auth: 'public', page, title: 'compliance.termsTitle' },
        {
          path: '/cookies',
          shell: 'public',
          auth: 'public',
          page,
          title: 'compliance.cookiesTitle',
        },
      ],
      sitePages: [
        {
          path: '/terms',
          title: 'compliance.termsTitle',
          section: 'legal',
          document: 'terms_of_service',
          live: true,
          order: 20,
        },
        {
          path: '/cookies',
          title: 'compliance.cookiesTitle',
          section: 'legal',
          live: true,
          order: 40,
        },
      ],
      messages: {
        'compliance.termsTitle': 'Terms of Service',
        'compliance.cookiesTitle': 'Cookie Policy',
      },
    });

    // Failure: duplicate sitePage path throws
    expect(() =>
      createWebApp({
        modules: [complianceWeb],
        frame: {
          sitePages: [{ path: '/terms', title: 'Terms', section: 'legal', live: true, order: 10 }],
        },
      }),
    ).toThrow(/Duplicate sitePage path/);

    const app = createWebApp({ modules: [complianceWeb] });
    expect(app.sitePages).toEqual([
      {
        path: '/terms',
        title: 'Terms of Service',
        section: 'legal',
        document: 'terms_of_service',
        live: true,
        order: 20,
      },
      {
        path: '/cookies',
        title: 'Cookie Policy',
        section: 'legal',
        live: true,
        order: 40,
      },
    ]);
  });

  it('filters module routes and admin surfaces by requires against CapabilityContext', () => {
    const orgsMod = defineModule({
      id: 'orgs',
      summary: 'Orgs',
      status: 'stable',
      dependsOn: [],
      flags: { 'orgs.teams': { default: false, summary: 'Teams' } },
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    const OrgsPage = () => null;
    const AdminOrgsPage = () => null;
    const orgsWeb = implementWeb(orgsMod, {
      messages: {
        'orgs.title': 'Organization',
        'orgs.admin': 'Tenants',
      },
      routes: [
        {
          path: '/organization',
          shell: 'app',
          auth: 'user',
          requires: ['flag:orgs.teams'],
          page: lazyModulePage(() => Promise.resolve({ OrgsPage }), 'OrgsPage'),
          title: 'orgs.title',
          unlisted: true,
        },
        {
          path: '/admin/tenants',
          shell: 'console',
          auth: 'admin',
          requires: ['flag:flags.advanced_admin'],
          page: lazyModulePage(() => Promise.resolve({ AdminOrgsPage }), 'AdminOrgsPage'),
          title: 'orgs.admin',
        },
      ],
      admin: [
        {
          id: 'tenants',
          label: 'orgs.admin',
          href: '/admin/tenants',
          routePath: 'tenants',
          requires: ['flag:flags.advanced_admin'],
          order: 40,
        },
      ],
    });
    const app = createWebApp({ modules: [orgsWeb] });

    expect(app.getAdminNavSurfaces({}, EMPTY_CAPABILITY_CONTEXT)).toEqual([]);
    expect(
      app.getDeclaredRoutes({}, { capabilities: EMPTY_CAPABILITY_CONTEXT }).map((r) => r.path),
    ).toEqual([]);

    const enabledCaps = {
      ...EMPTY_CAPABILITY_CONTEXT,
      flags: { 'orgs.teams': true, 'flags.advanced_admin': true },
    };
    expect(app.getAdminNavSurfaces({}, enabledCaps).map((s) => s.id)).toEqual(['tenants']);
    expect(app.getDeclaredRoutes({}, { capabilities: enabledCaps }).map((r) => r.path)).toEqual([
      '/admin/tenants',
      '/organization',
    ]);
  });

  it('supports frame config, standalone/publicOnly/fallbackPage/admin-index routes, gated nav/settings, and module notificationRules', () => {
    const billingMod = defineModule({
      id: 'billing',
      summary: 'Billing',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    const adminMod = defineModule({
      id: 'admin',
      summary: 'Admin',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    const devtoolsMod = defineModule({
      id: 'devtools',
      summary: 'Devtools',
      status: 'experimental',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });

    const PricingPage = () => null;
    const BillingUnavailablePage = () => null;
    const SystemHealthPage = () => null;
    const SidePeekPage = () => null;
    const HomePage = () => null;
    const LandingPage = () => null;

    const billingWeb = implementWeb(billingMod, {
      messages: {
        'billing.pricing': 'Pricing',
        'billing.palette': 'Go to Billing',
        'billing.paletteDesc': 'Navigate to billing',
        'billing.settings': 'Billing',
      },
      routes: [
        {
          path: '/pricing',
          shell: 'app',
          auth: 'user',
          requires: ['flag:flags.billing'],
          page: eagerModulePage(PricingPage, 'PricingPage'),
          fallbackPage: eagerModulePage(BillingUnavailablePage, 'BillingUnavailablePage'),
          title: 'billing.pricing',
        },
      ],
      nav: [
        {
          id: 'nav-billing',
          to: '/pricing',
          slot: 'palette',
          label: 'billing.palette',
          description: 'billing.paletteDesc',
          icon: 'credit-card',
          requires: ['flag:flags.billing'],
          order: 50,
        },
      ],
      settings: [
        {
          id: 'billing',
          label: 'billing.settings',
          kind: 'route',
          to: '/settings/billing',
          requires: ['flag:flags.billing'],
          order: 90,
        },
      ],
      notificationRules: [{ field: 'actionPrefix', match: 'security.', to: '/settings/security' }],
    });

    const adminWeb = implementWeb(adminMod, {
      messages: {
        'admin.health': 'Health',
        'admin.nav': 'Admin',
        'admin.palette': 'Go to Admin',
      },
      routes: [
        {
          path: '/admin',
          shell: 'console',
          auth: 'admin',
          adminSurface: 'health',
          page: eagerModulePage(SystemHealthPage, 'SystemHealthPage'),
          title: 'admin.health',
        },
      ],
      nav: [
        {
          to: '/admin',
          slot: 'app.primary',
          audience: 'admin',
          label: 'admin.nav',
          icon: 'shield',
          order: 100,
        },
        {
          id: 'nav-admin',
          to: '/admin',
          slot: 'palette',
          label: 'admin.palette',
          icon: 'shield',
          order: 40,
        },
      ],
      admin: [
        {
          id: 'health',
          label: 'admin.health',
          href: '/admin/health',
          routePath: 'health',
          order: 20,
        },
      ],
    });

    const devtoolsWeb = implementWeb(devtoolsMod, {
      messages: {
        'devtools.sidePeek': 'Side Peek',
        'devtools.docs': 'Docs',
      },
      routes: [
        {
          path: '/side-peek-ui-library',
          shell: 'public',
          standalone: true,
          auth: 'public',
          publicOnly: true,
          unlisted: true,
          requires: ['flag:flags.dev_tools'],
          page: eagerModulePage(SidePeekPage, 'SidePeekPage'),
          title: 'devtools.sidePeek',
        },
        {
          path: '/clean',
          shell: 'public',
          auth: 'public',
          publicOnly: true,
          requires: ['flag:flags.dev_tools'],
          page: eagerModulePage(HomePage, 'HomePage'),
          title: 'devtools.docs',
        },
      ],
      nav: [
        {
          to: '/clean?doc=readme',
          slot: 'app.primary',
          audience: 'public',
          requires: ['flag:flags.dev_tools'],
          label: 'devtools.docs',
          icon: 'book',
          order: 20,
        },
      ],
    });

    const app = createWebApp({
      modules: [billingWeb, adminWeb, devtoolsWeb],
      frame: {
        primaryNav: [{ to: '/', label: 'Home', audience: 'public', order: 10 }],
        palette: [
          {
            id: 'action-change-theme',
            label: 'Change Theme',
            description: 'Cycle theme',
            category: 'action',
            actionId: 'change-theme',
            keywords: ['theme'],
            order: 100,
          },
        ],
        settingsSections: [{ id: 'preferences', label: 'Theme', kind: 'section', order: 50 }],
        sitePages: [{ path: '/', title: 'Home', section: 'product', live: true, order: 10 }],
        dashboardQuickActions: [{ label: 'Settings', to: '/settings', order: 40 }],
      },
    });

    const frameRoutes = [
      {
        slot: 'before-modules' as const,
        shell: 'public' as const,
        index: true,
        element: LandingPage,
        publicOnly: true,
      },
    ];

    // Denial assertions when capabilities are empty (flags off)
    expect(
      app.getPrimaryNavLinks({
        authenticated: false,
        admin: false,
        flags: {},
        capabilities: EMPTY_CAPABILITY_CONTEXT,
      }),
    ).toEqual([{ label: 'Home', to: '/' }]);
    expect(
      app.getPrimaryNavLinks({
        authenticated: true,
        admin: false,
        flags: {},
        capabilities: EMPTY_CAPABILITY_CONTEXT,
      }),
    ).toEqual([]);
    expect(
      app
        .getPaletteEntries({ admin: false, flags: {}, capabilities: EMPTY_CAPABILITY_CONTEXT })
        .map((e) => e.id),
    ).toEqual(['action-change-theme']);
    expect(app.getSettingsNavItems({}, EMPTY_CAPABILITY_CONTEXT).map((s) => s.id)).toEqual([
      'preferences',
    ]);

    const starterDeclared = app.getDeclaredRoutes(
      {},
      { frameRoutes, capabilities: EMPTY_CAPABILITY_CONTEXT },
    );
    expect(starterDeclared.find((r) => r.path === '/side-peek-ui-library')).toBeUndefined();
    expect(starterDeclared.find((r) => r.path === '/clean')).toBeUndefined();
    expect(starterDeclared.find((r) => r.path === '/pricing')?.unlisted).toBe(true);
    expect(starterDeclared.find((r) => r.path === '/admin')?.unlisted).toBe(false);

    // Enabled assertions when flags are active
    const enabledCaps = {
      ...EMPTY_CAPABILITY_CONTEXT,
      flags: { 'flags.billing': true, 'flags.dev_tools': true },
    };
    expect(
      app.getPrimaryNavLinks({
        authenticated: false,
        admin: false,
        flags: {},
        capabilities: enabledCaps,
      }),
    ).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Docs', to: '/clean?doc=readme' },
    ]);
    expect(
      app.getPrimaryNavLinks({
        authenticated: true,
        admin: true,
        flags: {},
        capabilities: enabledCaps,
      }),
    ).toEqual([{ label: 'Admin', to: '/admin' }]);
    expect(
      app.getPaletteEntries({ admin: true, flags: {}, capabilities: enabledCaps }).map((e) => e.id),
    ).toEqual(['nav-admin', 'nav-billing', 'action-change-theme']);
    expect(app.getSettingsNavItems({}, enabledCaps).map((s) => s.id)).toEqual([
      'preferences',
      'billing',
    ]);

    const enabledRoutes = app.getRoutes(
      {},
      { shells: SHELLS, frameRoutes, capabilities: enabledCaps },
    );
    expect(enabledRoutes[0]).toMatchObject({
      path: '/side-peek-ui-library',
      publicOnly: true,
    });
    const publicChildren = enabledRoutes.find((r) => r.element === StubPublicShell)?.children ?? [];
    expect(publicChildren.find((r) => r.path === 'clean')?.publicOnly).toBe(true);
    const consoleChildren =
      enabledRoutes.find((r) => r.element === StubConsoleShell)?.children ?? [];
    const adminNode = consoleChildren.find((r) => r.path === 'admin');
    expect(adminNode?.children?.[0]).toMatchObject({ index: true, adminSurface: 'health' });
    expect(app.resolveNotificationRoute({ action: 'security.password_changed' })).toBe(
      '/settings/security',
    );
    expect(app.siteSections.map((s) => s.id)).toEqual(['product', 'legal', 'support']);
  });

  it('wraps module /settings/* app routes in settingsLayout when provided, and leaves non-settings or pending routes unwrapped', () => {
    const StubSettingsLayout = (): null => null;
    const StubPending = (): null => null;
    const StubBillingSettings = (): null => null;
    const StubTasks = (): null => null;

    const mod = implementWeb(tasksManifest, {
      routes: [
        {
          path: '/settings/billing',
          shell: 'app',
          auth: 'user',
          requires: ['flag:flags.billing'],
          page: lazyModulePage(async () => ({ StubBillingSettings }), 'StubBillingSettings'),
          title: 'tasks.billing',
        },
        {
          path: '/tasks',
          shell: 'app',
          auth: 'user',
          page: lazyModulePage(async () => ({ StubTasks }), 'StubTasks'),
          title: 'tasks.title',
        },
      ],
      messages: {
        'tasks.billing': 'Billing',
        'tasks.title': 'Tasks',
      },
    });

    const app = createWebApp({ modules: [mod] });
    const enabledCaps = {
      ...EMPTY_CAPABILITY_CONTEXT,
      flags: { 'flags.billing': true },
    };

    const withLayout = app.getRoutes(
      {},
      {
        shells: { ...SHELLS, settingsLayout: StubSettingsLayout },
        capabilities: enabledCaps,
      },
    );
    const appChildren = withLayout.find((r) => r.element === StubAppShell)?.children ?? [];
    const billingRoute = appChildren.find((r) => r.path === 'settings/billing');
    const tasksRoute = appChildren.find((r) => r.path === 'tasks');

    expect(billingRoute?.element).toBe(StubSettingsLayout);
    expect(billingRoute?.protected).toBe(true);
    expect(billingRoute?.children).toHaveLength(1);
    expect(billingRoute?.children?.[0]?.index).toBe(true);
    expect(tasksRoute?.element).not.toBe(StubSettingsLayout);
    expect(tasksRoute?.children).toBeUndefined();

    // Pending capability routes stay unwrapped as pending
    const pendingRoutes = app.getRoutes(
      {},
      {
        shells: { ...SHELLS, settingsLayout: StubSettingsLayout },
        pending: StubPending,
      },
    );
    const pendingAppChildren =
      pendingRoutes.find((r) => r.element === StubAppShell)?.children ?? [];
    const pendingBilling = pendingAppChildren.find((r) => r.path === 'settings/billing');
    expect(pendingBilling?.element).toBe(StubPending);
    expect(pendingBilling?.children).toBeUndefined();

    // Without settingsLayout, /settings/billing renders directly without wrapper
    const withoutLayout = app.getRoutes({}, { shells: SHELLS, capabilities: enabledCaps });
    const unwrappedBilling = withoutLayout
      .find((r) => r.element === StubAppShell)
      ?.children?.find((r) => r.path === 'settings/billing');
    expect(unwrappedBilling?.element).not.toBe(StubSettingsLayout);
    expect(unwrappedBilling?.children).toBeUndefined();
  });
});
