// main/tools/snapshot/web-routes.ts
/**
 * `bslt snapshot web-routes`: the web route surface oracle (restructure plan,
 * sections 6.4, 14.3 and Phase 5).
 *
 * It records what the web app routes and links, read from the app's own
 * definitions: every page with its path, guard and layouts; the primary
 * navigation, the footer and the command palette; the settings tabs; the admin
 * surfaces.
 *
 * The definitions are TypeScript modules full of React components, so they are
 * loaded the way the app's own prerender build loads them: through Vite, on the
 * server side, with nothing rendered. Each configuration calls the app's
 * builders with explicit flags; no `VITE_*` variable and no env file is read.
 *
 * Two configurations are recorded: `starter` (every optional surface off, what
 * a clone runs) and `everything` (every one on). Both are settled tables. While
 * the viewer's capability context is loading, the app instead holds every
 * flag-gated route in its slot with a placeholder (`createPendingAppRoutes`);
 * this snapshot does not see that table, and `routes.test.ts` pins it.
 *
 * Order: the routes are sorted by path. The router takes the first route that
 * matches, so declaration order matters where two patterns overlap; that is
 * recorded per route as `takesPrecedenceOver`. Navigation, settings and admin
 * entries are in the order the user sees them.
 */
import path from 'node:path';

import { sourceResolveConfig } from '@bslt/build-config/vite';

import { REPO_ROOT } from '../lib/paths';

import {
  WEB_ROUTES_SNAPSHOT,
  checkSnapshot,
  compareText,
  serializeSnapshot,
} from './snapshot-file';

import type { CheckResult } from '../gates/types';

export { WEB_ROUTES_SNAPSHOT } from './snapshot-file';

/** The web app, relative to the repository root. */
const WEB_APP = 'main/apps/web';

// ============================================================================
// The route table
// ============================================================================

/** A node of the app's route table, with its element reduced to the page's name. */
export interface WebRouteNode {
  path?: string;
  index?: boolean;
  /** The component the route renders; a layout when the route has children. */
  page: string;
  children?: WebRouteNode[];
  protected?: boolean;
  publicOnly?: boolean;
  publicOnlyRedirectTo?: string;
  adminSurface?: string;
}

/** One page of the snapshot. */
export interface WebRoute {
  readonly path: string;
  readonly page: string;
  /**
   * `protected`: signed-in users only. `publicOnly`: signed-out visitors only.
   * Set on the route or on a layout above it. Role checks are not flags: a
   * layout does them (`AdminLayout` in `layouts`).
   */
  readonly guard: 'none' | 'protected' | 'publicOnly';
  readonly publicOnlyRedirectTo: string | null;
  /** The layout routes above the page, outermost first. */
  readonly layouts: readonly string[];
  readonly adminSurface: string | null;
  /**
   * Routes declared after this one that can match one of its URLs. The router
   * takes the first match, so this route wins over them. A wildcard route
   * declared later is the ordinary fallback and is not listed; a wildcard route
   * lists what is declared after it, which it makes unreachable.
   */
  readonly takesPrecedenceOver: readonly string[];
}

/** Whether one URL can match both route patterns. `:name` is one segment, `*` the rest. */
export function routesOverlap(left: string, right: string): boolean {
  const a = left.split('/').filter((segment) => segment !== '');
  const b = right.split('/').filter((segment) => segment !== '');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const [x, y] = [a[index], b[index]];
    if (x === '*' || y === '*') return true;
    if (x === undefined || y === undefined) return false;
    if (x !== y && !x.startsWith(':') && !y.startsWith(':')) return false;
  }
  return true;
}

const isWildcard = (pattern: string): boolean => pattern.endsWith('*');

/** A child path hangs off its parent; an index route is its parent; `/x` is absolute. */
function resolvePath(node: WebRouteNode, base: string): string {
  if (node.path === undefined) return base;
  if (node.path.startsWith('/')) return node.path;
  return base === '/' ? `/${node.path}` : `${base}/${node.path}`;
}

/** The pages of a route table: sorted by path, a path declared twice in declaration order. */
export function describeWebRoutes(tree: readonly WebRouteNode[]): WebRoute[] {
  interface Inherited {
    readonly base: string;
    readonly layouts: readonly string[];
    readonly guard: WebRoute['guard'];
    readonly redirect: string | null;
  }
  const declared: Array<Omit<WebRoute, 'takesPrecedenceOver'>> = [];

  const walk = (nodes: readonly WebRouteNode[], inherited: Inherited): void => {
    for (const node of nodes) {
      const guard: WebRoute['guard'] =
        node.protected === true
          ? 'protected'
          : node.publicOnly === true
            ? 'publicOnly'
            : inherited.guard;
      const redirect = node.publicOnlyRedirectTo ?? inherited.redirect;
      const full = resolvePath(node, inherited.base);
      if (node.children !== undefined && node.children.length > 0) {
        walk(node.children, {
          base: full,
          layouts: [...inherited.layouts, node.page],
          guard,
          redirect,
        });
        continue;
      }
      declared.push({
        path: full,
        page: node.page,
        guard,
        publicOnlyRedirectTo: guard === 'publicOnly' ? redirect : null,
        layouts: inherited.layouts,
        adminSurface: node.adminSurface ?? null,
      });
    }
  };
  walk(tree, { base: '/', layouts: [], guard: 'none', redirect: null });

  return declared
    .map((route, index) => ({
      index,
      route: {
        ...route,
        takesPrecedenceOver: declared
          .slice(index + 1)
          .filter(
            (later) =>
              routesOverlap(route.path, later.path) &&
              (isWildcard(route.path) || !isWildcard(later.path)),
          )
          .map((later) => later.path)
          .sort(compareText),
      },
    }))
    .sort((a, b) => compareText(a.route.path, b.route.path) || a.index - b.index)
    .map(({ route }) => route);
}

// ============================================================================
// A configuration of the web app
// ============================================================================

/** The optional surfaces the web app's builders take as flags. */
export interface WebFlags {
  readonly advancedAdminEnabled: boolean;
  readonly advancedAuthEnabled: boolean;
  readonly billingEnabled: boolean;
  readonly developerToolsEnabled: boolean;
  readonly teamsEnabled: boolean;
}

const flags = (enabled: boolean): WebFlags => ({
  advancedAdminEnabled: enabled,
  advancedAuthEnabled: enabled,
  billingEnabled: enabled,
  developerToolsEnabled: enabled,
  teamsEnabled: enabled,
});

/** The configurations the snapshot records, in file order. */
export const WEB_CONFIGURATIONS: ReadonlyArray<{
  readonly name: string;
  readonly flags: WebFlags;
}> = [
  { name: 'starter', flags: flags(false) },
  { name: 'everything', flags: flags(true) },
];

interface NavLink {
  readonly label: string;
  readonly to: string;
}

/** What the web app's definitions give for one configuration. */
export interface WebSurface {
  readonly name: string;
  readonly flags: WebFlags;
  /** The `media` capability of the generated web profile; not a flag of the builders. */
  readonly mediaEnabled: boolean;
  readonly routes: WebRouteNode[];
  readonly navigation: {
    readonly primary: {
      readonly signedOut: readonly NavLink[];
      readonly signedIn: readonly NavLink[];
      /** A signed-in admin. */
      readonly admin: readonly NavLink[];
    };
    readonly footer: ReadonlyArray<{
      readonly section: string;
      readonly links: ReadonlyArray<{ readonly title: string; readonly path: string }>;
    }>;
    /** The commands an admin sees; `navigatesTo` is where a navigation command goes. */
    readonly commandPalette: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly category: string;
      readonly navigatesTo: string | null;
    }>;
  };
  readonly settings: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly admin: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly routePath: string;
    /** Linked from the admin sidebar in this configuration. */
    readonly inNavigation: boolean;
  }>;
}

// The shapes of the web app's modules this reader calls. Structural: the tools
// do not depend on the web package, they load its source.
interface AppRouteLike {
  readonly path?: string;
  readonly index?: boolean;
  readonly element: unknown;
  readonly children?: readonly AppRouteLike[];
  readonly protected?: boolean;
  readonly publicOnly?: boolean;
  readonly publicOnlyRedirectTo?: string;
  readonly adminSurface?: string;
}

interface WebModules {
  readonly routes: { createAppRoutes(options: WebFlags): readonly AppRouteLike[] };
  readonly routeLoad: { routePageName(element: unknown): string | undefined };
  readonly installedModules: {
    readonly installedModules: ReadonlyArray<{ readonly id: string }>;
  };
  readonly primaryNav: {
    getPrimaryNavLinks(state: {
      authenticated: boolean;
      admin: boolean;
      developerToolsEnabled: boolean;
      teamsEnabled?: boolean;
    }): NavLink[];
  };
  readonly siteMap: {
    liveSiteSections(): ReadonlyArray<{
      readonly section: { readonly label: string };
      readonly pages: ReadonlyArray<{ readonly title: string; readonly path: string }>;
    }>;
  };
  readonly commands: {
    createCommands(
      deps: { navigate: (to: unknown) => void; cycleTheme: () => void },
      options: { adminEnabled: boolean; billingEnabled: boolean; teamsEnabled?: boolean },
    ): ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly category: string;
      readonly action: () => void;
    }>;
  };
  readonly settingsTabs: {
    getSettingsNavItems(options: {
      billingEnabled: boolean;
    }): ReadonlyArray<{ readonly id: string; readonly label: string }>;
  };
  readonly adminSurface: {
    readonly ADMIN_SURFACES: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly href: string;
      readonly routePath: string;
    }>;
    getAdminNavSurfaces(options: {
      advancedAdminEnabled: boolean;
    }): ReadonlyArray<{ readonly id: string }>;
  };
}

/** The module files, relative to the web app's `src`. */
const WEB_MODULE_FILES: Readonly<Record<keyof WebModules, string>> = {
  routes: 'app/routes.tsx',
  routeLoad: 'app/routeLoad.ts',
  installedModules: 'generated/modules.ts',
  primaryNav: 'app/shells/primaryNav.ts',
  siteMap: 'app/siteMap.ts',
  commands: 'app/command-palette/commands.ts',
  settingsTabs: 'app/account/settingsTabs.ts',
  adminSurface: 'app/admin/adminSurface.ts',
};

function routeNodes(
  routes: readonly AppRouteLike[],
  pageName: (element: unknown) => string | undefined,
): WebRouteNode[] {
  return routes.map((route) => {
    const page = pageName(route.element);
    if (page === undefined) {
      throw new Error(
        `the route ${route.path ?? '(index)'} renders a component without a name; the snapshot cannot say which page it is`,
      );
    }
    return {
      ...(route.path === undefined ? {} : { path: route.path }),
      ...(route.index === true ? { index: true } : {}),
      page,
      ...(route.protected === true ? { protected: true } : {}),
      ...(route.publicOnly === true ? { publicOnly: true } : {}),
      ...(route.publicOnlyRedirectTo === undefined
        ? {}
        : { publicOnlyRedirectTo: route.publicOnlyRedirectTo }),
      ...(route.adminSurface === undefined ? {} : { adminSurface: route.adminSurface }),
      ...(route.children === undefined || route.children.length === 0
        ? {}
        : { children: routeNodes(route.children, pageName) }),
    };
  });
}

function surfaceOf(
  modules: WebModules,
  configuration: (typeof WEB_CONFIGURATIONS)[number],
): WebSurface {
  const { flags: configured } = configuration;
  const mediaEnabled = modules.installedModules.installedModules.some((m) => m.id === 'media');
  const navState = {
    developerToolsEnabled: configured.developerToolsEnabled,
    teamsEnabled: configured.teamsEnabled,
  };
  const inAdminNavigation = new Set(
    modules.adminSurface
      .getAdminNavSurfaces({ advancedAdminEnabled: configured.advancedAdminEnabled })
      .map((surface) => surface.id),
  );

  let navigatedTo: string | null = null;
  const commands = modules.commands.createCommands(
    {
      navigate: (to) => {
        navigatedTo = typeof to === 'string' ? to : null;
      },
      cycleTheme: () => undefined,
    },
    {
      adminEnabled: true,
      billingEnabled: configured.billingEnabled,
      teamsEnabled: configured.teamsEnabled,
    },
  );

  return {
    name: configuration.name,
    flags: configured,
    mediaEnabled,
    routes: routeNodes(modules.routes.createAppRoutes(configured), (element) =>
      modules.routeLoad.routePageName(element),
    ),
    navigation: {
      primary: {
        signedOut: modules.primaryNav.getPrimaryNavLinks({
          ...navState,
          authenticated: false,
          admin: false,
        }),
        signedIn: modules.primaryNav.getPrimaryNavLinks({
          ...navState,
          authenticated: true,
          admin: false,
        }),
        admin: modules.primaryNav.getPrimaryNavLinks({
          ...navState,
          authenticated: true,
          admin: true,
        }),
      },
      footer: modules.siteMap.liveSiteSections().map(({ section, pages }) => ({
        section: section.label,
        links: pages.map((page) => ({ title: page.title, path: page.path })),
      })),
      commandPalette: commands.map((command) => {
        navigatedTo = null;
        // A navigation command only calls `navigate`; that call is its target.
        if (command.category === 'navigation') command.action();
        return {
          id: command.id,
          label: command.label,
          category: command.category,
          navigatesTo: navigatedTo,
        };
      }),
    },
    settings: modules.settingsTabs
      .getSettingsNavItems({ billingEnabled: configured.billingEnabled })
      .map((tab) => ({ id: tab.id, label: tab.label })),
    admin: modules.adminSurface.ADMIN_SURFACES.map((surface) => ({
      id: surface.id,
      label: surface.label,
      href: surface.href,
      routePath: surface.routePath,
      inNavigation: inAdminNavigation.has(surface.id),
    })),
  };
}

/**
 * Load the web app's definitions and evaluate them for each configuration.
 *
 * Vite loads the modules for the server side (as the prerender build does), in
 * middleware mode: no port, no watcher, no dependency scan. The app's own
 * `vite.config.ts` is not used (it configures the dev server and reads env
 * files); the only setting the modules need is the `source` export condition.
 */
export async function loadWebSurfaces(root: string = REPO_ROOT): Promise<WebSurface[]> {
  const { createServer } = await import('vite');
  const server = await createServer({
    ...sourceResolveConfig,
    configFile: false,
    envDir: false,
    root: path.join(root, WEB_APP),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const loaded: Partial<Record<keyof WebModules, unknown>> = {};
    for (const [name, file] of Object.entries(WEB_MODULE_FILES)) {
      loaded[name as keyof WebModules] = await server.ssrLoadModule(`/src/${file}`);
    }
    const modules = loaded as WebModules;
    return WEB_CONFIGURATIONS.map((configuration) => surfaceOf(modules, configuration));
  } finally {
    await server.close();
  }
}

/** The content of the snapshot file for the loaded configurations. */
export function serializeWebSurfaces(surfaces: readonly WebSurface[]): string {
  return serializeSnapshot(WEB_ROUTES_SNAPSHOT, {
    configurations: surfaces.map((surface) => ({
      name: surface.name,
      flags: surface.flags,
      mediaEnabled: surface.mediaEnabled,
      routes: describeWebRoutes(surface.routes),
      navigation: surface.navigation,
      settings: surface.settings,
      admin: surface.admin,
    })),
  });
}

/** Load the web app and return the content of the snapshot file. */
export async function buildWebRoutesSnapshot(root: string = REPO_ROOT): Promise<string> {
  return serializeWebSurfaces(await loadWebSurfaces(root));
}

/** The `snapshot-web-routes` gate: the committed snapshot equals what the web app defines now. */
export async function run(root: string = REPO_ROOT): Promise<CheckResult> {
  return checkSnapshot(WEB_ROUTES_SNAPSHOT, await buildWebRoutesSnapshot(root), root);
}
