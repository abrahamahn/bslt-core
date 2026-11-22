// main/modules/devtools/web/index.ts
import { implementWeb, lazyModulePage } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';
import { devtoolsModule } from '../module';

export { ApiRoutesPage, type ApiRoutesPageProps } from './ApiRoutesPage';
export {
  componentCatalog,
  getAllCategories,
  getComponentsByCategory,
  getTotalComponentCount,
  type ComponentCategory,
  type ComponentDemo,
  type ComponentVariant,
  type UILibraryPaneConfig,
} from './catalog';
export { STORY_INDEX, type StoryIndexEntry } from './generated/story-index.generated';
export {
  useDocContent,
  useRouteManifest,
  useUILibraryPanes,
  type UseDocContentResult,
  type UseRouteManifestOptions,
  type UseRouteManifestResult,
  type UseUILibraryPanesResult,
} from './hooks';
export {
  apiRouteInventory,
  getApiRouteCoverage,
  type ApiRouteCoverage,
  type ApiRouteDefinition,
} from './routeInventory';
export { RouteManifestPage } from './RouteManifestPage';
export {
  SidePeekUILibraryContent,
  SidePeekUILibraryLayout,
  SidePeekUILibraryPage,
  UILibraryPage,
  UILibraryPreviewArea,
  type SidePeekUILibraryLayoutProps,
  type UILibraryPreviewAreaProps,
} from './UILibraryPages';

export const devtoolsWeb = implementWeb(devtoolsModule, {
  routes: [
    {
      path: '/side-peek-ui-library',
      shell: 'console',
      auth: 'public',
      standalone: true,
      publicOnly: true,
      unlisted: true,
      requires: ['flag:flags.dev_tools'],
      page: lazyModulePage(() => import('./UILibraryPages'), 'SidePeekUILibraryPage'),
      title: 'devtools.routes.sidePeekTitle',
    },
    {
      path: '/clean',
      shell: 'console',
      auth: 'public',
      publicOnly: true,
      requires: ['flag:flags.dev_tools'],
      page: lazyModulePage(() => import('./HomePage'), 'HomePage'),
      title: 'devtools.routes.cleanTitle',
    },
    {
      path: '/ui-library',
      shell: 'console',
      auth: 'public',
      publicOnly: true,
      requires: ['flag:flags.dev_tools'],
      page: lazyModulePage(() => import('./UILibraryPages'), 'UILibraryPage'),
      title: 'devtools.routes.uiLibraryTitle',
    },
    {
      path: '/developer/api-routes',
      shell: 'console',
      auth: 'public',
      publicOnly: true,
      requires: ['flag:flags.dev_tools'],
      page: lazyModulePage(() => import('./ApiRoutesPage'), 'ApiRoutesPage'),
      title: 'devtools.routes.apiRoutesTitle',
    },
    {
      path: '/admin/routes',
      shell: 'console',
      auth: 'admin',
      adminSurface: 'route-manifest',
      unlisted: true,
      requires: ['flag:flags.advanced_admin'],
      page: lazyModulePage(() => import('./RouteManifestPage'), 'RouteManifestPage'),
      title: 'devtools.routes.routeManifestTitle',
    },
  ],
  nav: [
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
  ],
  admin: [
    {
      id: 'route-manifest',
      label: 'devtools.admin.routeManifestLabel',
      href: '/admin/routes',
      routePath: 'routes',
      unlisted: true,
      order: 150,
      requires: ['flag:flags.advanced_admin'],
    },
  ],
  messages: enUsMessages,
});
