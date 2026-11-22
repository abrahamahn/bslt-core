// main/modules/devtools/web/index.test.ts
import { describe, expect, it } from 'vitest';

import { devtoolsModule } from '../module';

import { devtoolsWeb } from './index';

describe('devtoolsWeb', () => {
  it('registers all 5 gated devtools routes, 3 public dev nav items, route-manifest admin surface, and en-US messages', () => {
    expect(devtoolsWeb.module).toBe(devtoolsModule);
    expect(
      devtoolsWeb.routes.map((r) => ({
        path: r.path,
        shell: r.shell,
        auth: r.auth,
        standalone: r.standalone,
        publicOnly: r.publicOnly,
        unlisted: r.unlisted,
        adminSurface: r.adminSurface,
        requires: r.requires,
      })),
    ).toEqual([
      {
        path: '/side-peek-ui-library',
        shell: 'console',
        auth: 'public',
        standalone: true,
        publicOnly: true,
        unlisted: true,
        adminSurface: undefined,
        requires: ['flag:flags.dev_tools'],
      },
      {
        path: '/clean',
        shell: 'console',
        auth: 'public',
        standalone: undefined,
        publicOnly: true,
        unlisted: undefined,
        adminSurface: undefined,
        requires: ['flag:flags.dev_tools'],
      },
      {
        path: '/ui-library',
        shell: 'console',
        auth: 'public',
        standalone: undefined,
        publicOnly: true,
        unlisted: undefined,
        adminSurface: undefined,
        requires: ['flag:flags.dev_tools'],
      },
      {
        path: '/developer/api-routes',
        shell: 'console',
        auth: 'public',
        standalone: undefined,
        publicOnly: true,
        unlisted: undefined,
        adminSurface: undefined,
        requires: ['flag:flags.dev_tools'],
      },
      {
        path: '/admin/routes',
        shell: 'console',
        auth: 'admin',
        standalone: undefined,
        publicOnly: undefined,
        unlisted: true,
        adminSurface: 'route-manifest',
        requires: ['flag:flags.advanced_admin'],
      },
    ]);
    expect(devtoolsWeb.nav).toEqual([
      {
        to: '/clean?doc=readme',
        label: 'devtools.nav.docs',
        icon: 'book',
        slot: 'app.primary',
        audience: 'public',
        order: 20,
        requires: ['flag:flags.dev_tools'],
      },
      {
        to: '/developer/api-routes',
        label: 'devtools.nav.apiRoutes',
        icon: 'code',
        slot: 'app.primary',
        audience: 'public',
        order: 30,
        requires: ['flag:flags.dev_tools'],
      },
      {
        to: '/ui-library',
        label: 'devtools.nav.uiLibrary',
        icon: 'layers',
        slot: 'app.primary',
        audience: 'public',
        order: 40,
        requires: ['flag:flags.dev_tools'],
      },
    ]);
    expect(devtoolsWeb.admin).toEqual([
      {
        id: 'route-manifest',
        label: 'devtools.admin.routeManifestLabel',
        href: '/admin/routes',
        routePath: 'routes',
        unlisted: true,
        order: 150,
        requires: ['flag:flags.advanced_admin'],
      },
    ]);
  });

  it('REJECTS runtime mutation of frozen devtoolsWeb collections', () => {
    expect(Object.isFrozen(devtoolsWeb)).toBe(true);
    expect(() => {
      (devtoolsWeb.routes as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (devtoolsWeb.nav as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (devtoolsWeb.admin as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });
});
