// main/kernel/web/src/web-module.test.tsx
import { defineConfig, defineModule } from '@bslt/contract';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  eagerModulePage,
  implementWeb,
  lazyModulePage,
  useModuleMessages,
  type LazyPageDescriptor,
  type ModuleAdminSurface,
  type ModuleSettingsSection,
  type ModuleSitePage,
  type NavSlot,
  type NotificationRouteResolver,
  type ShellName,
  type SiteSectionId,
  type WebImpls,
  type WebModule,
  type WebNavItem,
  type WebRoute,
} from './index';

import type { ReactElement } from 'react';

const tasksManifest = defineModule({
  id: 'tasks',
  summary: 'Tasks module',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: ['tasks'],
});

const headlessManifest = defineModule({
  id: 'identity',
  summary: 'Identity shell',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});

function StubTasksPage(): ReactElement {
  return <div>Tasks Page</div>;
}

describe('web-module', () => {
  it('rejects unprefixed message keys in implementWeb', () => {
    const page: LazyPageDescriptor = lazyModulePage(
      async () => ({ StubTasksPage }),
      'StubTasksPage',
    );

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [{ path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.title', page }],
        messages: {
          'tasks.title': 'Tasks',
          'other.badKey': 'Wrong prefix',
        },
      }),
    ).toThrow(/tasks\./u);
  });

  it('rejects routes whose path is invalid or whose title key is missing from messages', () => {
    const page = lazyModulePage(async () => ({ StubTasksPage }), 'StubTasksPage');

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [
          {
            path: 'tasks' as `/${string}`,
            shell: 'app',
            auth: 'user',
            title: 'tasks.title',
            page,
          },
        ],
        messages: { 'tasks.title': 'Tasks' },
      }),
    ).toThrow(/start with "\/"/u);

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [{ path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.missing', page }],
        messages: { 'tasks.title': 'Tasks' },
      }),
    ).toThrow(/tasks\.missing/u);
  });

  it('rejects nav items with invalid targets or missing label/hint/description/actionLabel keys', () => {
    const page = lazyModulePage(async () => ({ StubTasksPage }), 'StubTasksPage');

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        nav: [
          {
            to: 'tasks' as `/${string}`,
            slot: 'app.primary',
            label: 'tasks.nav',
            icon: 'check-square',
            order: 40,
          },
        ],
        messages: { 'tasks.nav': 'Tasks' },
      }),
    ).toThrow(/start with "\/"/u);

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [{ path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.title', page }],
        nav: [
          {
            to: '/tasks',
            slot: 'palette',
            label: 'tasks.nav',
            description: 'tasks.missingDesc',
            icon: 'check-square',
            order: 35,
          },
        ],
        messages: { 'tasks.title': 'Tasks', 'tasks.nav': 'Go to Tasks' },
      }),
    ).toThrow(/tasks\.missingDesc/u);

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [{ path: '/tasks', shell: 'app', auth: 'user', title: 'tasks.title', page }],
        nav: [
          {
            to: '/tasks',
            slot: 'dashboard',
            label: 'tasks.nav',
            actionLabel: 'tasks.missingAction',
            icon: 'check-square',
            order: 15,
          },
        ],
        messages: { 'tasks.title': 'Tasks', 'tasks.nav': 'Tasks' },
      }),
    ).toThrow(/tasks\.missingAction/u);
  });

  it('rejects settings sections with empty id, missing route target, or missing label key', () => {
    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        settings: [{ id: '', label: 'tasks.settings', kind: 'section', order: 10 }],
        messages: { 'tasks.settings': 'Tasks' },
      }),
    ).toThrow(/settings section id/u);

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        settings: [{ id: 'tasks', label: 'tasks.settings', kind: 'route', order: 10 }],
        messages: { 'tasks.settings': 'Tasks' },
      }),
    ).toThrow(/route settings section/u);
  });

  it('rejects admin surfaces with non-admin href or missing label key', () => {
    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        admin: [
          {
            id: 'tasks',
            label: 'tasks.admin',
            href: '/tasks' as `/admin${string}`,
            routePath: 'tasks',
            order: 10,
          },
        ],
        messages: { 'tasks.admin': 'Tasks' },
      }),
    ).toThrow(/\/admin/u);
  });

  it('rejects sitePages with invalid path or missing description message key', () => {
    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        sitePages: [
          {
            path: '/tasks-public',
            title: 'tasks.siteTitle',
            description: 'tasks.missingSiteDesc',
            section: 'product',
            live: true,
            order: 10,
          },
        ],
        messages: { 'tasks.siteTitle': 'Tasks' },
      }),
    ).toThrow(/tasks\.missingSiteDesc/u);
  });

  it('rejects unprefixed notificationRoutes keys', () => {
    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        notificationRoutes: {
          'other.assigned': () => '/tasks',
        },
        messages: {},
      }),
    ).toThrow(/tasks\./u);
  });

  it('rejects lazyModulePage non-component exports and unknown useModuleMessages keys', async () => {
    const broken = lazyModulePage(async () => ({ NotAComponent: 42 }), 'NotAComponent');
    expect(broken.pageName).toBe('NotAComponent');
    await expect(broken.load()).rejects.toThrow(/NotAComponent/u);

    const messages = {
      'tasks.title': 'Tasks',
      'tasks.count': '{count} tasks in {bucket}',
    } as const;
    const { result } = renderHook(() => useModuleMessages(messages));
    expect(() => result.current('tasks.unknown' as keyof typeof messages)).toThrow(
      /tasks\.unknown/u,
    );
    expect(() => result.current('tasks.count', { count: 3 })).toThrow(/bucket/u);
    expect(result.current('tasks.count', { count: 3, bucket: 'inbox' })).toBe('3 tasks in inbox');
  });

  it('binds a complete WebModule, freezes collections, loads lazy pages, and satisfies WebImpls', async () => {
    const shell: ShellName = 'app';
    const slot: NavSlot = 'app.primary';
    const sectionId: SiteSectionId = 'product';
    const page = lazyModulePage(async () => ({ StubTasksPage }), 'StubTasksPage');
    const route: WebRoute = {
      path: '/tasks',
      shell,
      auth: 'user',
      title: 'tasks.title',
      page,
    };
    const navItem: WebNavItem = {
      to: '/tasks',
      slot,
      label: 'tasks.nav',
      hint: 'tasks.hint',
      icon: 'check-square',
      order: 40,
    };
    const settingsSection: ModuleSettingsSection = {
      id: 'tasks',
      label: 'tasks.nav',
      kind: 'section',
      aliases: ['todo'],
      order: 50,
    };
    const adminSurface: ModuleAdminSurface = {
      id: 'tasks-admin',
      label: 'tasks.nav',
      href: '/admin/tasks',
      routePath: 'tasks',
      order: 50,
    };
    const sitePage: ModuleSitePage = {
      path: '/tasks-info',
      title: 'tasks.title',
      section: sectionId,
      live: false,
      order: 50,
    };
    const resolver: NotificationRouteResolver = () => '/tasks';

    const tasksWeb: WebModule<typeof tasksManifest> = implementWeb(tasksManifest, {
      routes: [route],
      nav: [navItem],
      settings: [settingsSection],
      admin: [adminSurface],
      sitePages: [sitePage],
      notificationRoutes: { 'tasks.assigned': resolver },
      messages: {
        'tasks.title': 'Tasks',
        'tasks.nav': 'Tasks',
        'tasks.hint': 'Track work',
      },
    });

    const _config = defineConfig({
      name: 'BSLT',
      installedModules: [headlessManifest, tasksManifest] as const,
      devOnly: [],
      locales: ['en-US'],
      brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
    });

    const impls = [null, tasksWeb] as const satisfies WebImpls<typeof _config>;
    expect(impls[0]).toBeNull();
    expect(impls[1].module.id).toBe('tasks');
    expect(Object.isFrozen(tasksWeb)).toBe(true);
    expect(Object.isFrozen(tasksWeb.routes)).toBe(true);

    const Loaded = await page.load();
    expect(Loaded).toBe(StubTasksPage);

    function Probe(): ReactElement {
      const t = useModuleMessages(tasksWeb.messages);
      return <span data-testid="probe">{t('tasks.title')}</span>;
    }

    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('Tasks');
  });

  it('rejects non-functions or empty names in eagerModulePage and exposes eager component when valid', async () => {
    expect(() => eagerModulePage(null as unknown as () => ReactElement, 'BadPage')).toThrow(
      /React component function/u,
    );
    expect(() => eagerModulePage(StubTasksPage, '   ')).toThrow(/pageName/u);

    const eager = eagerModulePage(StubTasksPage, 'StubTasksPage');
    expect(eager.pageName).toBe('StubTasksPage');
    expect(eager.eager).toBe(StubTasksPage);
    expect(await eager.load()).toBe(StubTasksPage);
  });

  it('rejects invalid notificationRules targets or empty match patterns and freezes valid rules', () => {
    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        notificationRules: [
          { field: 'actionPrefix', match: 'tasks.', to: 'https://evil.example' as `/${string}` },
        ],
        messages: {},
      }),
    ).toThrow(/start with "\/"/u);

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        notificationRules: [{ field: 'actionPrefix', match: 'tasks.', to: '//evil.example' }],
        messages: {},
      }),
    ).toThrow(/protocol-relative/u);

    expect(() =>
      implementWeb(tasksManifest, {
        routes: [],
        notificationRules: [{ field: 'notificationType', match: '   ', to: '/tasks' }],
        messages: {},
      }),
    ).toThrow(/match pattern/u);

    const valid = implementWeb(tasksManifest, {
      routes: [],
      notificationRules: [{ field: 'actionPrefix', match: 'tasks.', to: '/tasks' }],
      messages: {},
    });
    expect(Object.isFrozen(valid.notificationRules)).toBe(true);
  });
});
