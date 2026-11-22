// main/kernel/web/src/create-web-app.ts
/**
 * `createWebApp({ modules, installedManifests, frame })`: rung-2 flatMap
 * aggregation across all 10 web platform contribution surfaces (plan §11.1–11.2).
 */

import { createPersistAllowlist } from '@bslt/client-engine';
import {
  evaluateRequirement,
  type CapabilityContext,
  type ModuleDefinition,
  type Requirement,
} from '@bslt/contract';

import type {
  LazyPageDescriptor,
  ModuleAdminSurface,
  ModuleNotificationRouteRule,
  NotificationRouteResolver,
  ShellName,
  SiteSectionId,
  WebModule,
  WebRoute,
} from './web-module';
import type { ElementType } from 'react';

export interface WebShellConfig {
  readonly publicShell: ElementType;
  readonly authShell: ElementType;
  readonly appShell: ElementType;
  readonly consoleShell: ElementType;
  readonly adminLayout?: ElementType | undefined;
  readonly settingsLayout?: ElementType | undefined;
  readonly lazyModuleRoutePage: (descriptor: LazyPageDescriptor) => ElementType;
}

export interface ComposedAppRoute<AdminId extends string = string> {
  path?: string;
  index?: boolean;
  element: ElementType;
  children?: ComposedAppRoute<AdminId>[];
  protected?: boolean;
  publicOnly?: boolean;
  publicOnlyRedirectTo?: string;
  adminSurface?: AdminId;
}

export type FrameRouteSlot = 'root' | 'before-modules' | 'after-modules' | 'admin';

export interface FrameChildRoute {
  readonly path?: string;
  readonly index?: boolean;
  readonly element: ElementType;
  readonly children?: readonly FrameChildRoute[];
  readonly protected?: boolean;
  readonly publicOnly?: boolean;
  readonly publicOnlyRedirectTo?: string;
  readonly adminSurface?: string;
  readonly unlisted?: true;
}

export interface FrameRouteContribution<Flags = Record<string, never>> extends FrameChildRoute {
  readonly slot: FrameRouteSlot;
  readonly shell?: ShellName;
  readonly when?: (flags: Flags) => boolean;
}

export interface ResolvedDeclaredRoute {
  readonly path: string;
  readonly unlisted: boolean;
}

export interface PrimaryNavHint {
  readonly featureKey: string;
  readonly title: string;
  readonly description: string;
}

export interface FramePrimaryNavContribution<Flags = Record<string, never>> {
  readonly to: string;
  readonly label: string;
  readonly audience: 'public' | 'authenticated' | 'admin';
  readonly hint?: PrimaryNavHint;
  readonly order: number;
  readonly when?: (flags: Flags) => boolean;
}

export interface FramePaletteContribution<Flags = Record<string, never>> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: 'navigation' | 'action';
  readonly to?: `/${string}`;
  readonly actionId?: string;
  readonly keywords: readonly string[];
  readonly order: number;
  readonly adminOnly?: boolean;
  readonly when?: (flags: Flags) => boolean;
}

export interface ResolvedPaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: 'navigation' | 'action';
  readonly to?: `/${string}`;
  readonly actionId?: string;
  readonly keywords: readonly string[];
  readonly order: number;
}

export interface FrameAdminSurfaceContribution<Flags = Record<string, never>> {
  readonly id: string;
  readonly label: string;
  readonly href: `/admin${string}`;
  readonly routePath: string;
  readonly unlisted?: true;
  readonly order: number;
  readonly when?: (flags: Flags) => boolean;
}

export interface ResolvedAdminSurface {
  readonly id: string;
  readonly label: string;
  readonly href: `/admin${string}`;
  readonly routePath: string;
  readonly unlisted: boolean;
  readonly order: number;
}

export interface FrameSettingsSectionContribution<Flags = Record<string, never>> {
  readonly id: string;
  readonly label: string;
  readonly kind: 'section' | 'route';
  readonly to?: `/${string}`;
  readonly aliases?: readonly string[];
  readonly order: number;
  readonly when?: (flags: Flags) => boolean;
}

export interface ResolvedSettingsSection {
  readonly id: string;
  readonly label: string;
  readonly kind: 'section' | 'route';
  readonly to?: `/${string}`;
  readonly order: number;
}

export interface SiteSection {
  readonly id: SiteSectionId;
  readonly label: string;
}

export interface FrameSitePageContribution<DocType extends string = string> {
  readonly path: `/${string}`;
  readonly title: string;
  readonly description?: string;
  readonly section: SiteSectionId;
  readonly document?: DocType;
  readonly live: boolean;
  readonly order: number;
}

export interface ResolvedSitePage<DocType extends string = string> {
  readonly path: `/${string}`;
  readonly title: string;
  readonly description?: string;
  readonly section: SiteSectionId;
  readonly document?: DocType;
  readonly live: boolean;
  readonly order: number;
}

export interface FrameDashboardActionContribution {
  readonly label: string;
  readonly to: `/${string}`;
  readonly order: number;
}

export interface FrameDashboardTileContribution {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly description: string;
  readonly href: `/${string}`;
  readonly actionLabel: string;
  readonly order: number;
}

export interface AppFrameConfig<Flags = Record<string, never>, DocType extends string = string> {
  readonly shells?: WebShellConfig;
  readonly routes?: readonly FrameRouteContribution<Flags>[];
  readonly primaryNav?: readonly FramePrimaryNavContribution<Flags>[];
  readonly palette?: readonly FramePaletteContribution<Flags>[];
  readonly adminSurfaces?: readonly FrameAdminSurfaceContribution<Flags>[];
  readonly settingsSections?: readonly FrameSettingsSectionContribution<Flags>[];
  readonly siteSections?: readonly SiteSection[];
  readonly sitePages?: readonly FrameSitePageContribution<DocType>[];
  readonly dashboardQuickActions?: readonly FrameDashboardActionContribution[];
  readonly dashboardTiles?: readonly FrameDashboardTileContribution[];
}

export const DEFAULT_SITE_SECTIONS: readonly SiteSection[] = Object.freeze([
  Object.freeze({ id: 'product', label: 'Product' }),
  Object.freeze({ id: 'legal', label: 'Legal' }),
  Object.freeze({ id: 'support', label: 'Support' }),
]);

export interface WebApp<Flags = Record<string, never>, DocType extends string = string> {
  getRoutes(
    flags: Flags,
    routeConfig?: {
      readonly shells?: WebShellConfig;
      readonly frameRoutes?: readonly FrameRouteContribution<Flags>[];
      readonly routes?: readonly FrameRouteContribution<Flags>[];
      readonly capabilities?: CapabilityContext | undefined;
      readonly pending?: ElementType | undefined;
    },
  ): ComposedAppRoute[];
  getDeclaredRoutes(
    flags: Flags,
    routeConfig?: {
      readonly frameRoutes?: readonly FrameRouteContribution<Flags>[];
      readonly routes?: readonly FrameRouteContribution<Flags>[];
      readonly capabilities?: CapabilityContext | undefined;
    },
  ): readonly ResolvedDeclaredRoute[];
  getPrimaryNavLinks(state: {
    readonly authenticated: boolean;
    readonly admin: boolean;
    readonly flags: Flags;
    readonly capabilities?: CapabilityContext | undefined;
  }): Array<{ label: string; to: string }>;
  getPrimaryNavHints(): Readonly<Record<string, PrimaryNavHint>>;
  getPaletteEntries(state: {
    readonly admin: boolean;
    readonly flags: Flags;
    readonly capabilities?: CapabilityContext | undefined;
  }): readonly ResolvedPaletteEntry[];
  readonly adminSurfaces: readonly ResolvedAdminSurface[];
  getAdminNavSurfaces(
    flags: Flags,
    capabilities?: CapabilityContext,
  ): readonly ResolvedAdminSurface[];
  readonly settingsSections: readonly ResolvedSettingsSection[];
  readonly panelSettingsSectionIds: readonly string[];
  getSettingsNavItems(
    flags: Flags,
    capabilities?: CapabilityContext,
  ): readonly ResolvedSettingsSection[];
  normalizeSettingsTab(value: string | null): string | null;
  readonly siteSections: readonly SiteSection[];
  readonly sitePages: readonly ResolvedSitePage<DocType>[];
  resolveNotificationRoute(
    data: Readonly<Record<string, unknown>> | null | undefined,
  ): string | null;
  isPersistableQueryKey(queryKey: readonly unknown[]): boolean;
  readonly dashboardQuickActions: readonly FrameDashboardActionContribution[];
  readonly dashboardTiles: readonly FrameDashboardTileContribution[];
}

function resolveMessage(mod: WebModule, key: string): string {
  return mod.messages[key] ?? key;
}

function derivePaletteId(moduleId: string, to: `/${string}`): string {
  const slug = to
    .replace(/^\/+/u, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  if (slug === '' || slug === moduleId.toLowerCase()) {
    return `nav-${moduleId}`;
  }
  return `nav-${moduleId}-${slug}`;
}

function toComposedChild(child: FrameChildRoute): ComposedAppRoute {
  return {
    ...(child.path !== undefined ? { path: child.path } : {}),
    ...(child.index === true ? { index: true } : {}),
    element: child.element,
    ...(child.children !== undefined
      ? { children: child.children.map((nested) => toComposedChild(nested)) }
      : {}),
    ...(child.protected === true ? { protected: true } : {}),
    ...(child.publicOnly === true ? { publicOnly: true } : {}),
    ...(child.publicOnlyRedirectTo !== undefined
      ? { publicOnlyRedirectTo: child.publicOnlyRedirectTo }
      : {}),
    ...(child.adminSurface !== undefined ? { adminSurface: child.adminSurface } : {}),
  };
}

function resolveRelativePath(segment: string | undefined, basePath: string): string {
  if (segment === undefined) return basePath;
  if (segment.startsWith('/')) return segment;
  return basePath === '/' ? `/${segment}` : `${basePath}/${segment}`;
}

interface DeclaredNode {
  readonly path?: string;
  readonly unlisted?: boolean;
  readonly children?: readonly DeclaredNode[];
}

function collectDeclaredRoutes(
  nodes: readonly DeclaredNode[],
  basePath = '/',
  inheritedUnlisted = false,
  seen: Set<string> = new Set(),
  out: ResolvedDeclaredRoute[] = [],
): ResolvedDeclaredRoute[] {
  for (const node of nodes) {
    const resolvedPath = resolveRelativePath(node.path, basePath);
    const unlisted = inheritedUnlisted || node.unlisted === true;
    if (node.children !== undefined && node.children.length > 0) {
      collectDeclaredRoutes(node.children, resolvedPath, unlisted, seen, out);
      continue;
    }
    if (!seen.has(resolvedPath)) {
      seen.add(resolvedPath);
      out.push({ path: resolvedPath, unlisted });
    }
  }
  return out;
}

/**
 * Aggregate installed `WebModule` bindings and optional `frame` contributions
 * into a single deterministic `WebApp` composition object.
 */
export function createWebApp<
  Flags = Record<string, never>,
  DocType extends string = string,
>(options: {
  readonly modules: readonly (WebModule | null)[];
  readonly installedManifests?: readonly ModuleDefinition[];
  readonly frame?: AppFrameConfig<Flags, DocType>;
}): WebApp<Flags, DocType> {
  const activeModules = options.modules.filter((mod): mod is WebModule => mod !== null);
  const frame = options.frame;

  // 1. Validate & pre-index module routes (duplicate path check across modules).
  const seenModuleRoutePaths = new Set<string>();
  const moduleStandaloneRoutes: WebRoute[] = [];
  const modulePublicShellRoutes: WebRoute[] = [];
  const moduleAuthShellRoutes: WebRoute[] = [];
  const moduleAppShellRoutes: WebRoute[] = [];
  const moduleConsoleRoutes: Array<{ readonly mod: WebModule; readonly route: WebRoute }> = [];

  for (const mod of activeModules) {
    for (const route of mod.routes) {
      if (seenModuleRoutePaths.has(route.path)) {
        throw new Error(
          `Duplicate web route path "${route.path}" registered across installed web modules`,
        );
      }
      seenModuleRoutePaths.add(route.path);
      if (route.standalone === true) {
        moduleStandaloneRoutes.push(route);
      } else if (route.shell === 'public') {
        modulePublicShellRoutes.push(route);
      } else if (route.shell === 'auth') {
        moduleAuthShellRoutes.push(route);
      } else if (route.shell === 'console') {
        moduleConsoleRoutes.push({ mod, route });
      } else {
        moduleAppShellRoutes.push(route);
      }
    }
  }

  // 2. Primary navigation & hints (`slot: 'app.primary'` + `frame.primaryNav`).
  interface InternalPrimaryNav<F> {
    readonly to: string;
    readonly label: string;
    readonly audience: 'public' | 'authenticated' | 'admin';
    readonly hint?: PrimaryNavHint;
    readonly order: number;
    readonly requires?: readonly Requirement[];
    readonly when?: (flags: F) => boolean;
  }

  const modulePrimaryNav: InternalPrimaryNav<Flags>[] = activeModules.flatMap((mod) => {
    if (mod.nav === undefined) return [];
    return mod.nav
      .filter((item) => item.slot === 'app.primary')
      .map((item): InternalPrimaryNav<Flags> => {
        const label = resolveMessage(mod, item.label);
        const hintText = item.hint !== undefined ? resolveMessage(mod, item.hint) : undefined;
        return {
          to: item.to,
          label,
          audience: item.audience ?? 'authenticated',
          ...(hintText !== undefined
            ? {
                hint: {
                  featureKey: mod.module.id,
                  title: label,
                  description: hintText,
                },
              }
            : {}),
          ...(item.requires !== undefined ? { requires: item.requires } : {}),
          order: item.order,
        };
      });
  });

  const allPrimaryNav: readonly InternalPrimaryNav<Flags>[] = [
    ...(frame?.primaryNav ?? []),
    ...modulePrimaryNav,
  ];

  const primaryNavHints: Readonly<Record<string, PrimaryNavHint>> = Object.freeze(
    Object.fromEntries(
      allPrimaryNav.flatMap((entry) =>
        entry.hint !== undefined ? ([[entry.label, entry.hint]] as const) : [],
      ),
    ),
  );

  // 3. Command palette (`slot: 'palette'` + `frame.palette`).
  interface InternalPaletteEntry<F> {
    readonly resolved: ResolvedPaletteEntry;
    readonly adminOnly: boolean;
    readonly requires?: readonly Requirement[];
    readonly when?: (flags: F) => boolean;
  }

  const modulePaletteEntries: InternalPaletteEntry<Flags>[] = activeModules.flatMap((mod) => {
    if (mod.nav === undefined) return [];
    return mod.nav
      .filter((item) => item.slot === 'palette')
      .map((item): InternalPaletteEntry<Flags> => {
        const label = resolveMessage(mod, item.label);
        const description =
          item.description !== undefined ? resolveMessage(mod, item.description) : label;
        const matchingRoute = mod.routes.find((r) => r.path === item.to);
        return {
          resolved: Object.freeze({
            id: item.id ?? derivePaletteId(mod.module.id, item.to),
            label,
            description,
            category: 'navigation',
            to: item.to,
            keywords: Object.freeze(item.keywords !== undefined ? [...item.keywords] : []),
            order: item.order,
          }),
          adminOnly: item.audience === 'admin' || matchingRoute?.auth === 'admin',
          ...(item.requires !== undefined ? { requires: item.requires } : {}),
        };
      });
  });

  const extraPaletteEntries: InternalPaletteEntry<Flags>[] = [...(frame?.palette ?? [])].map(
    (entry): InternalPaletteEntry<Flags> => ({
      resolved: Object.freeze({
        id: entry.id,
        label: entry.label,
        description: entry.description,
        category: entry.category,
        ...(entry.to !== undefined ? { to: entry.to } : {}),
        ...(entry.actionId !== undefined ? { actionId: entry.actionId } : {}),
        keywords: Object.freeze([...entry.keywords]),
        order: entry.order,
      }),
      adminOnly: entry.adminOnly === true,
      ...(entry.when !== undefined ? { when: entry.when } : {}),
    }),
  );

  const allPaletteEntries = [...modulePaletteEntries, ...extraPaletteEntries].sort(
    (a, b) => a.resolved.order - b.resolved.order,
  );
  const seenPaletteIds = new Set<string>();
  for (const entry of allPaletteEntries) {
    if (seenPaletteIds.has(entry.resolved.id)) {
      throw new Error(`Duplicate command palette entry id "${entry.resolved.id}"`);
    }
    seenPaletteIds.add(entry.resolved.id);
  }

  // 4. Admin surfaces (`mod.admin` + `frame.adminSurfaces`).
  interface InternalAdminSurface<F> {
    readonly resolved: ResolvedAdminSurface;
    readonly requires?: readonly Requirement[];
    readonly when?: (flags: F) => boolean;
  }

  const moduleAdminSurfaces: InternalAdminSurface<Flags>[] = activeModules.flatMap((mod) =>
    (mod.admin ?? []).map((surface): InternalAdminSurface<Flags> => ({
      resolved: Object.freeze({
        id: surface.id,
        label: resolveMessage(mod, surface.label),
        href: surface.href,
        routePath: surface.routePath,
        unlisted: surface.unlisted === true,
        order: surface.order,
      }),
      ...(surface.requires !== undefined ? { requires: surface.requires } : {}),
    })),
  );

  const extraAdminSurfaces: InternalAdminSurface<Flags>[] = [...(frame?.adminSurfaces ?? [])].map(
    (surface): InternalAdminSurface<Flags> => ({
      resolved: Object.freeze({
        id: surface.id,
        label: surface.label,
        href: surface.href,
        routePath: surface.routePath,
        unlisted: surface.unlisted === true,
        order: surface.order,
      }),
      ...(surface.when !== undefined ? { when: surface.when } : {}),
    }),
  );

  const allAdminInternal = [...extraAdminSurfaces, ...moduleAdminSurfaces].sort(
    (a, b) => a.resolved.order - b.resolved.order,
  );
  const seenAdminIds = new Set<string>();
  for (const entry of allAdminInternal) {
    if (seenAdminIds.has(entry.resolved.id)) {
      throw new Error(`Duplicate admin surface id "${entry.resolved.id}"`);
    }
    seenAdminIds.add(entry.resolved.id);
  }
  const resolvedAdminSurfaces: readonly ResolvedAdminSurface[] = Object.freeze(
    allAdminInternal.map((entry) => entry.resolved),
  );

  // 5. Settings sections (`mod.settings` + `frame.settingsSections`).
  interface InternalSettingsSection<F> {
    readonly resolved: ResolvedSettingsSection;
    readonly aliases: readonly string[];
    readonly requires?: readonly Requirement[];
    readonly when?: (flags: F) => boolean;
  }

  const moduleSettingsSections: InternalSettingsSection<Flags>[] = activeModules.flatMap((mod) =>
    (mod.settings ?? []).map((section): InternalSettingsSection<Flags> => ({
      resolved: Object.freeze({
        id: section.id,
        label: resolveMessage(mod, section.label),
        kind: section.kind,
        ...(section.to !== undefined ? { to: section.to } : {}),
        order: section.order,
      }),
      aliases: section.aliases ?? [],
      ...(section.requires !== undefined ? { requires: section.requires } : {}),
    })),
  );

  const extraSettingsSections: InternalSettingsSection<Flags>[] = [
    ...(frame?.settingsSections ?? []),
  ].map((section): InternalSettingsSection<Flags> => ({
    resolved: Object.freeze({
      id: section.id,
      label: section.label,
      kind: section.kind,
      ...(section.to !== undefined ? { to: section.to } : {}),
      order: section.order,
    }),
    aliases: section.aliases ?? [],
    ...(section.when !== undefined ? { when: section.when } : {}),
  }));

  const allSettingsInternal = [...extraSettingsSections, ...moduleSettingsSections].sort(
    (a, b) => a.resolved.order - b.resolved.order,
  );
  const settingsIdsSet = new Set<string>();
  const settingsAliasMap = new Map<string, string>();

  for (const entry of allSettingsInternal) {
    const normalizedId = entry.resolved.id.trim().toLowerCase();
    if (settingsIdsSet.has(normalizedId) || settingsAliasMap.has(normalizedId)) {
      throw new Error(`Duplicate settings section id "${entry.resolved.id}"`);
    }
    settingsIdsSet.add(normalizedId);
    for (const rawAlias of entry.aliases) {
      const alias = rawAlias.trim().toLowerCase();
      if (alias === normalizedId) continue;
      if (settingsIdsSet.has(alias) || settingsAliasMap.has(alias)) {
        throw new Error(`Duplicate or colliding settings tab alias "${rawAlias}"`);
      }
      settingsAliasMap.set(alias, entry.resolved.id);
    }
  }

  const resolvedSettingsSections: readonly ResolvedSettingsSection[] = Object.freeze(
    allSettingsInternal.map((entry) => entry.resolved),
  );
  const panelSettingsSectionIds: readonly string[] = Object.freeze(
    allSettingsInternal
      .filter((entry) => entry.resolved.kind === 'section')
      .map((entry) => entry.resolved.id),
  );

  // 6. Site sections & sitePages (`mod.sitePages` + `frame.sitePages`).
  const siteSections: readonly SiteSection[] = Object.freeze([
    ...(frame?.siteSections ?? (frame !== undefined ? DEFAULT_SITE_SECTIONS : [])),
  ]);

  const moduleSitePages: ResolvedSitePage<DocType>[] = activeModules.flatMap((mod) =>
    (mod.sitePages ?? []).map((page): ResolvedSitePage<DocType> => {
      const description =
        page.description !== undefined ? resolveMessage(mod, page.description) : undefined;
      return Object.freeze({
        path: page.path,
        title: resolveMessage(mod, page.title),
        ...(description !== undefined ? { description } : {}),
        section: page.section,
        ...(page.document !== undefined ? { document: page.document as DocType } : {}),
        live: page.live,
        order: page.order,
      });
    }),
  );

  const extraSitePages: ResolvedSitePage<DocType>[] = [...(frame?.sitePages ?? [])].map((page) =>
    Object.freeze({
      path: page.path,
      title: page.title,
      ...(page.description !== undefined ? { description: page.description } : {}),
      section: page.section,
      ...(page.document !== undefined ? { document: page.document } : {}),
      live: page.live,
      order: page.order,
    }),
  );

  const allSitePages = [...extraSitePages, ...moduleSitePages].sort((a, b) => a.order - b.order);
  const seenSitePaths = new Set<string>();
  for (const page of allSitePages) {
    if (seenSitePaths.has(page.path)) {
      throw new Error(`Duplicate sitePage path "${page.path}"`);
    }
    seenSitePaths.add(page.path);
  }
  const resolvedSitePages: readonly ResolvedSitePage<DocType>[] = Object.freeze(allSitePages);

  // 7. Notification routes (`mod.notificationRoutes` + `mod.notificationRules`).
  const moduleNotificationResolvers = new Map<string, NotificationRouteResolver>();
  const moduleNotificationRules: ModuleNotificationRouteRule[] = [];
  for (const mod of activeModules) {
    if (mod.notificationRoutes !== undefined) {
      for (const [key, resolver] of Object.entries(mod.notificationRoutes)) {
        if (moduleNotificationResolvers.has(key)) {
          throw new Error(`Duplicate notificationRoute key "${key}"`);
        }
        moduleNotificationResolvers.set(key, resolver);
      }
    }
    if (mod.notificationRules !== undefined) {
      moduleNotificationRules.push(...mod.notificationRules);
    }
  }
  const allNotificationRules: readonly ModuleNotificationRouteRule[] = moduleNotificationRules;

  // 8. Default-deny query persistence allowlist (`endpoint.persist: true`).
  const manifests: readonly ModuleDefinition[] =
    options.installedManifests ?? activeModules.map((mod) => mod.module);
  const isPersistableModuleQuery = createPersistAllowlist(manifests);

  // 9. Dashboard quick actions & hub tiles (`slot: 'dashboard'` + `frame`).
  const moduleDashboardItems = activeModules.flatMap((mod) => {
    if (mod.nav === undefined) return [];
    return mod.nav
      .filter((item) => item.slot === 'dashboard')
      .map((item) => {
        const label = resolveMessage(mod, item.label);
        const description =
          item.description !== undefined ? resolveMessage(mod, item.description) : label;
        const actionLabel =
          item.actionLabel !== undefined ? resolveMessage(mod, item.actionLabel) : `Open ${label}`;
        return {
          action: Object.freeze({
            label,
            to: item.to,
            order: item.order,
          }),
          tile: Object.freeze({
            id: mod.module.id,
            label,
            value: 'Ready',
            description,
            href: item.to,
            actionLabel,
            order: item.order,
          }),
        };
      });
  });

  const dashboardQuickActions: readonly FrameDashboardActionContribution[] = Object.freeze(
    [
      ...moduleDashboardItems.map((item) => item.action),
      ...(frame?.dashboardQuickActions ?? []).map((action) => Object.freeze({ ...action })),
    ].sort((a, b) => a.order - b.order),
  );

  const dashboardTiles: readonly FrameDashboardTileContribution[] = Object.freeze(
    [
      ...moduleDashboardItems.map((item) => item.tile),
      ...(frame?.dashboardTiles ?? []).map((tile) => Object.freeze({ ...tile })),
    ].sort((a, b) => a.order - b.order),
  );

  // Helper to filter active frame + extra routes by slot for a given flag set.
  const activeExtraRoutes = (
    flags: Flags,
    frameRoutes?: readonly FrameRouteContribution<Flags>[],
    overrideRoutes?: readonly FrameRouteContribution<Flags>[],
  ): readonly FrameRouteContribution<Flags>[] =>
    [...(frameRoutes ?? frame?.routes ?? []), ...(overrideRoutes ?? [])].filter((route) =>
      route.when !== undefined ? route.when(flags) : true,
    );

  return {
    getRoutes(
      flags: Flags,
      routeConfig?: {
        readonly shells?: WebShellConfig;
        readonly frameRoutes?: readonly FrameRouteContribution<Flags>[];
        readonly routes?: readonly FrameRouteContribution<Flags>[];
        readonly capabilities?: CapabilityContext | undefined;
        readonly pending?: ElementType | undefined;
      },
    ): ComposedAppRoute[] {
      const shells = routeConfig?.shells ?? frame?.shells;
      if (shells === undefined) {
        throw new Error('createWebApp.getRoutes requires shells to be configured');
      }
      const capabilities = routeConfig?.capabilities;
      const pending = routeConfig?.pending;

      const isModuleRouteAllowed = (route: WebRoute): boolean => {
        if (pending !== undefined || capabilities === undefined || route.requires === undefined) {
          return true;
        }
        return route.requires.every((req) => evaluateRequirement(req, capabilities).ok);
      };
      const isModuleRoutePending = (route: WebRoute): boolean =>
        pending !== undefined && route.requires !== undefined && route.requires.length > 0;
      const isAdminConsolePath = (path: string): boolean =>
        path === '/admin' || path.startsWith('/admin/');
      const extraShellOf = (route: FrameRouteContribution<Flags>): ShellName =>
        route.shell ?? (route.slot === 'admin' ? 'console' : 'app');

      const active = activeExtraRoutes(flags, routeConfig?.frameRoutes, routeConfig?.routes);
      const rootRoutes = active
        .filter((route) => route.slot === 'root')
        .map((route) => toComposedChild(route));
      const standaloneModuleChildren: ComposedAppRoute[] = moduleStandaloneRoutes
        .filter((route) => isModuleRoutePending(route) || isModuleRouteAllowed(route))
        .map((route) => {
          const held = isModuleRoutePending(route);
          return {
            path: route.path,
            element:
              held && pending !== undefined ? pending : shells.lazyModuleRoutePage(route.page),
            ...(!held && route.auth !== 'public' ? { protected: true } : {}),
            ...(!held && route.publicOnly === true ? { publicOnly: true } : {}),
          };
        });

      const buildModuleShellChildren = (
        shellName: 'public' | 'auth' | 'app',
        shellRoutes: readonly WebRoute[],
      ): ComposedAppRoute[] =>
        shellRoutes.flatMap((route): ComposedAppRoute[] => {
          const relativePath = route.path.replace(/^\/+/u, '');
          if (isModuleRoutePending(route) && pending !== undefined) {
            return [{ path: relativePath, element: pending }];
          }
          if (isModuleRouteAllowed(route)) {
            const pageElement = shells.lazyModuleRoutePage(route.page);
            if (
              shellName === 'app' &&
              shells.settingsLayout !== undefined &&
              route.path.startsWith('/settings/')
            ) {
              return [
                {
                  path: relativePath,
                  element: shells.settingsLayout,
                  ...(route.auth !== 'public' ? { protected: true } : {}),
                  ...(route.publicOnly === true ? { publicOnly: true } : {}),
                  children: [{ index: true, element: pageElement }],
                },
              ];
            }
            return [
              {
                path: relativePath,
                element: pageElement,
                ...(route.auth !== 'public' ? { protected: true } : {}),
                ...(route.publicOnly === true ? { publicOnly: true } : {}),
              },
            ];
          }
          if (route.fallbackPage !== undefined) {
            return [
              {
                path: relativePath,
                element: shells.lazyModuleRoutePage(route.fallbackPage),
                ...(route.auth !== 'public' ? { protected: true } : {}),
                ...(route.publicOnly === true ? { publicOnly: true } : {}),
              },
            ];
          }
          return [];
        });

      const buildStandardShellRoutes = (
        shellName: 'public' | 'auth' | 'app',
        moduleRoutes: readonly WebRoute[],
      ): ComposedAppRoute[] => {
        const before = active
          .filter((route) => route.slot === 'before-modules' && extraShellOf(route) === shellName)
          .map((route) => toComposedChild(route));
        const afterNonWildcard = active
          .filter(
            (route) =>
              route.slot === 'after-modules' &&
              route.path !== '*' &&
              extraShellOf(route) === shellName,
          )
          .map((route) => toComposedChild(route));
        const afterWildcard = active
          .filter(
            (route) =>
              route.slot === 'after-modules' &&
              route.path === '*' &&
              extraShellOf(route) === shellName,
          )
          .map((route) => toComposedChild(route));
        return [
          ...before,
          ...buildModuleShellChildren(shellName, moduleRoutes),
          ...afterNonWildcard,
          ...afterWildcard,
        ];
      };

      const findAdminSurfaceId = (
        adminSurfaces: readonly ModuleAdminSurface[] | undefined,
        route: WebRoute,
        relativePath: string,
      ): string | undefined =>
        route.adminSurface ??
        adminSurfaces?.find(
          (s) =>
            s.href === route.path ||
            s.routePath === relativePath ||
            relativePath.startsWith(`${s.routePath}/`),
        )?.id;

      const activeConsoleRoutes = moduleConsoleRoutes.filter(
        ({ route }) => isModuleRoutePending(route) || isModuleRouteAllowed(route),
      );

      const consoleAdminChildren: ComposedAppRoute[] = activeConsoleRoutes
        .filter(({ route }) => isAdminConsolePath(route.path))
        .map(({ mod, route }) => {
          const held = isModuleRoutePending(route);
          if (route.path === '/admin') {
            const surfaceId = held ? undefined : (route.adminSurface ?? mod.admin?.[0]?.id);
            return {
              index: true,
              element:
                held && pending !== undefined ? pending : shells.lazyModuleRoutePage(route.page),
              ...(surfaceId !== undefined ? { adminSurface: surfaceId } : {}),
            };
          }
          const relativePath = route.path.replace(/^\/admin\/+/u, '').replace(/^\/+/u, '');
          const matchingSurfaceId = held
            ? undefined
            : findAdminSurfaceId(mod.admin, route, relativePath);
          return {
            path: relativePath,
            element:
              held && pending !== undefined ? pending : shells.lazyModuleRoutePage(route.page),
            ...(matchingSurfaceId !== undefined ? { adminSurface: matchingSurfaceId } : {}),
          };
        });

      const nonAdminConsoleRoutes: ComposedAppRoute[] = activeConsoleRoutes
        .filter(({ route }) => !isAdminConsolePath(route.path))
        .map(({ mod, route }) => {
          const relativePath = route.path.replace(/^\/+/u, '');
          const held = isModuleRoutePending(route);
          const matchingSurfaceId = held
            ? undefined
            : findAdminSurfaceId(mod.admin, route, relativePath);
          const pageElement =
            held && pending !== undefined ? pending : shells.lazyModuleRoutePage(route.page);
          if (!held && route.auth === 'admin' && shells.adminLayout !== undefined) {
            return {
              path: relativePath,
              element: shells.adminLayout,
              children: [
                {
                  index: true,
                  element: pageElement,
                  ...(matchingSurfaceId !== undefined ? { adminSurface: matchingSurfaceId } : {}),
                },
              ],
            };
          }
          return {
            path: relativePath,
            element: pageElement,
            ...(!held && route.auth !== 'public' ? { protected: true } : {}),
            ...(!held && route.publicOnly === true ? { publicOnly: true } : {}),
            ...(matchingSurfaceId !== undefined ? { adminSurface: matchingSurfaceId } : {}),
          };
        });

      const frameAdminChildren = active
        .filter((route) => route.slot === 'admin')
        .map((route) => toComposedChild(route));
      const adminChildren = [...frameAdminChildren, ...consoleAdminChildren];
      const beforeConsole = active
        .filter((route) => route.slot === 'before-modules' && extraShellOf(route) === 'console')
        .map((route) => toComposedChild(route));
      const afterConsoleNonWildcard = active
        .filter(
          (route) =>
            route.slot === 'after-modules' &&
            route.path !== '*' &&
            extraShellOf(route) === 'console',
        )
        .map((route) => toComposedChild(route));
      const afterConsoleWildcard = active
        .filter(
          (route) =>
            route.slot === 'after-modules' &&
            route.path === '*' &&
            extraShellOf(route) === 'console',
        )
        .map((route) => toComposedChild(route));

      const publicChildren = buildStandardShellRoutes('public', modulePublicShellRoutes);
      const authChildren = buildStandardShellRoutes('auth', moduleAuthShellRoutes);
      const consoleChildren: ComposedAppRoute[] = [
        ...beforeConsole,
        ...nonAdminConsoleRoutes,
        ...afterConsoleNonWildcard,
        ...(adminChildren.length > 0
          ? [
              {
                path: 'admin',
                element: shells.adminLayout ?? shells.consoleShell,
                children: adminChildren,
              },
            ]
          : []),
        ...afterConsoleWildcard,
      ];
      const appChildren = buildStandardShellRoutes('app', moduleAppShellRoutes);

      return [
        ...rootRoutes,
        ...standaloneModuleChildren,
        ...(publicChildren.length > 0
          ? [{ element: shells.publicShell, children: publicChildren }]
          : []),
        ...(authChildren.length > 0 ? [{ element: shells.authShell, children: authChildren }] : []),
        ...(consoleChildren.length > 0
          ? [{ element: shells.consoleShell, children: consoleChildren }]
          : []),
        ...(appChildren.length > 0 ? [{ element: shells.appShell, children: appChildren }] : []),
      ];
    },

    getDeclaredRoutes(
      flags: Flags,
      routeConfig?: {
        readonly frameRoutes?: readonly FrameRouteContribution<Flags>[];
        readonly routes?: readonly FrameRouteContribution<Flags>[];
        readonly capabilities?: CapabilityContext | undefined;
      },
    ): readonly ResolvedDeclaredRoute[] {
      const capabilities = routeConfig?.capabilities;
      const isModuleRouteAllowed = (route: WebRoute): boolean => {
        if (capabilities === undefined || route.requires === undefined) {
          return true;
        }
        return route.requires.every((req) => evaluateRequirement(req, capabilities).ok);
      };
      const isAdminConsolePath = (path: string): boolean =>
        path === '/admin' || path.startsWith('/admin/');
      const extraShellOf = (route: FrameRouteContribution<Flags>): ShellName =>
        route.shell ?? (route.slot === 'admin' ? 'console' : 'app');
      const active = activeExtraRoutes(flags, routeConfig?.frameRoutes, routeConfig?.routes);
      const toDeclaredNode = (child: FrameChildRoute): DeclaredNode => ({
        ...(child.path !== undefined ? { path: child.path } : {}),
        ...(child.unlisted === true ? { unlisted: true } : {}),
        ...(child.children !== undefined
          ? { children: child.children.map((nested) => toDeclaredNode(nested)) }
          : {}),
      });

      const rootNodes = active
        .filter((route) => route.slot === 'root')
        .map((route) => toDeclaredNode(route));
      const standaloneModNodes: DeclaredNode[] = moduleStandaloneRoutes
        .filter(isModuleRouteAllowed)
        .map((route) => ({
          path: route.path,
          ...(route.unlisted === true ? { unlisted: true } : {}),
        }));

      const buildDeclaredShellModNodes = (shellRoutes: readonly WebRoute[]): DeclaredNode[] =>
        shellRoutes.flatMap((route): DeclaredNode[] => {
          const relativePath = route.path.replace(/^\/+/u, '');
          if (isModuleRouteAllowed(route)) {
            return [
              {
                path: relativePath,
                ...(route.unlisted === true ? { unlisted: true } : {}),
              },
            ];
          }
          if (route.fallbackPage !== undefined) {
            return [{ path: relativePath, unlisted: true }];
          }
          return [];
        });

      const buildDeclaredStandardShell = (
        shellName: 'public' | 'auth' | 'app',
        shellRoutes: readonly WebRoute[],
      ): DeclaredNode[] => {
        const before = active
          .filter((route) => route.slot === 'before-modules' && extraShellOf(route) === shellName)
          .map((route) => toDeclaredNode(route));
        const afterNonWildcard = active
          .filter(
            (route) =>
              route.slot === 'after-modules' &&
              route.path !== '*' &&
              extraShellOf(route) === shellName,
          )
          .map((route) => toDeclaredNode(route));
        const afterWildcard = active
          .filter(
            (route) =>
              route.slot === 'after-modules' &&
              route.path === '*' &&
              extraShellOf(route) === shellName,
          )
          .map((route) => toDeclaredNode(route));
        return [
          ...before,
          ...buildDeclaredShellModNodes(shellRoutes),
          ...afterNonWildcard,
          ...afterWildcard,
        ];
      };

      const activeConsoleRoutes = moduleConsoleRoutes.filter(({ route }) =>
        isModuleRouteAllowed(route),
      );
      const nonAdminConsoleNodes: DeclaredNode[] = activeConsoleRoutes
        .filter(({ route }) => !isAdminConsolePath(route.path))
        .map(({ route }) => ({
          path: route.path.replace(/^\/+/u, ''),
          ...(route.unlisted === true ? { unlisted: true } : {}),
        }));
      const consoleAdminNodes: DeclaredNode[] = activeConsoleRoutes
        .filter(({ route }) => isAdminConsolePath(route.path))
        .map(({ route }) =>
          route.path === '/admin'
            ? { ...(route.unlisted === true ? { unlisted: true } : {}) }
            : {
                path: route.path.replace(/^\/admin\/+/u, '').replace(/^\/+/u, ''),
                ...(route.unlisted === true ? { unlisted: true } : {}),
              },
        );
      const adminFrameNodes = active
        .filter((route) => route.slot === 'admin')
        .map((route) => toDeclaredNode(route));
      const beforeConsole = active
        .filter((route) => route.slot === 'before-modules' && extraShellOf(route) === 'console')
        .map((route) => toDeclaredNode(route));
      const afterConsoleNonWildcard = active
        .filter(
          (route) =>
            route.slot === 'after-modules' &&
            route.path !== '*' &&
            extraShellOf(route) === 'console',
        )
        .map((route) => toDeclaredNode(route));
      const afterConsoleWildcard = active
        .filter(
          (route) =>
            route.slot === 'after-modules' &&
            route.path === '*' &&
            extraShellOf(route) === 'console',
        )
        .map((route) => toDeclaredNode(route));

      const publicNodes = buildDeclaredStandardShell('public', modulePublicShellRoutes);
      const authNodes = buildDeclaredStandardShell('auth', moduleAuthShellRoutes);
      const adminChildren = [...adminFrameNodes, ...consoleAdminNodes];
      const consoleNodes: DeclaredNode[] = [
        ...beforeConsole,
        ...nonAdminConsoleNodes,
        ...afterConsoleNonWildcard,
        ...(adminChildren.length > 0 ? [{ path: 'admin', children: adminChildren }] : []),
        ...afterConsoleWildcard,
      ];
      const appNodes = buildDeclaredStandardShell('app', moduleAppShellRoutes);

      const tree: DeclaredNode[] = [
        ...rootNodes,
        ...standaloneModNodes,
        ...(publicNodes.length > 0 ? [{ children: publicNodes }] : []),
        ...(authNodes.length > 0 ? [{ children: authNodes }] : []),
        ...(consoleNodes.length > 0 ? [{ children: consoleNodes }] : []),
        ...(appNodes.length > 0 ? [{ children: appNodes }] : []),
      ];

      return collectDeclaredRoutes(tree);
    },

    getPrimaryNavLinks({
      authenticated,
      admin,
      flags,
      capabilities,
    }): Array<{ label: string; to: string }> {
      return allPrimaryNav
        .filter((entry) => {
          if (entry.when !== undefined && !entry.when(flags)) return false;
          if (
            capabilities !== undefined &&
            entry.requires !== undefined &&
            !entry.requires.every((req) => evaluateRequirement(req, capabilities).ok)
          ) {
            return false;
          }
          if (!authenticated) return entry.audience === 'public';
          if (entry.audience === 'authenticated') return true;
          if (entry.audience === 'admin') return admin;
          return false;
        })
        .sort((a, b) => a.order - b.order)
        .map((entry) => ({ label: entry.label, to: entry.to }));
    },

    getPrimaryNavHints(): Readonly<Record<string, PrimaryNavHint>> {
      return primaryNavHints;
    },

    getPaletteEntries({ admin, flags, capabilities }): readonly ResolvedPaletteEntry[] {
      return allPaletteEntries
        .filter((entry) => {
          if (entry.adminOnly && !admin) return false;
          if (entry.when !== undefined && !entry.when(flags)) return false;
          if (
            capabilities !== undefined &&
            entry.requires !== undefined &&
            !entry.requires.every((req) => evaluateRequirement(req, capabilities).ok)
          ) {
            return false;
          }
          return true;
        })
        .map((entry) => entry.resolved);
    },

    adminSurfaces: resolvedAdminSurfaces,

    getAdminNavSurfaces(
      flags: Flags,
      capabilities?: CapabilityContext,
    ): readonly ResolvedAdminSurface[] {
      return allAdminInternal
        .filter((entry) => {
          if (entry.resolved.unlisted) return false;
          if (entry.when !== undefined && !entry.when(flags)) return false;
          if (
            capabilities !== undefined &&
            entry.requires !== undefined &&
            !entry.requires.every((req) => evaluateRequirement(req, capabilities).ok)
          ) {
            return false;
          }
          return true;
        })
        .map((entry) => entry.resolved);
    },

    settingsSections: resolvedSettingsSections,

    panelSettingsSectionIds,

    getSettingsNavItems(
      flags: Flags,
      capabilities?: CapabilityContext,
    ): readonly ResolvedSettingsSection[] {
      return allSettingsInternal
        .filter((entry) => {
          if (entry.when !== undefined && !entry.when(flags)) return false;
          if (
            capabilities !== undefined &&
            entry.requires !== undefined &&
            !entry.requires.every((req) => evaluateRequirement(req, capabilities).ok)
          ) {
            return false;
          }
          return true;
        })
        .map((entry) => entry.resolved);
    },

    normalizeSettingsTab(value: string | null): string | null {
      const normalized = value?.replace(/^#/u, '').trim().toLowerCase() ?? '';
      if (normalized === '') return null;
      const aliased = settingsAliasMap.get(normalized);
      if (aliased !== undefined) return aliased;
      if (!settingsIdsSet.has(normalized)) return null;
      const exact = allSettingsInternal.find(
        (entry) => entry.resolved.id.toLowerCase() === normalized,
      );
      return exact?.resolved.id ?? null;
    },

    siteSections,

    sitePages: resolvedSitePages,

    resolveNotificationRoute(
      data: Readonly<Record<string, unknown>> | null | undefined,
    ): string | null {
      if (data === null || data === undefined) return null;

      const explicitUrl = data['url'];
      if (
        typeof explicitUrl === 'string' &&
        explicitUrl.startsWith('/') &&
        !explicitUrl.startsWith('//')
      ) {
        return explicitUrl;
      }

      const action = data['action'];
      if (typeof action === 'string') {
        const moduleActionResolver = moduleNotificationResolvers.get(action);
        if (moduleActionResolver !== undefined) {
          return moduleActionResolver(data);
        }
        for (const rule of allNotificationRules) {
          if (rule.field === 'actionPrefix' && action.startsWith(rule.match)) {
            return rule.to;
          }
        }
      }

      const notificationType = data['notificationType'];
      if (typeof notificationType !== 'string') {
        return null;
      }

      const moduleTypeResolver = moduleNotificationResolvers.get(notificationType);
      if (moduleTypeResolver !== undefined) {
        return moduleTypeResolver(data);
      }

      for (const rule of allNotificationRules) {
        if (rule.field === 'notificationType' && notificationType === rule.match) {
          return rule.to;
        }
        if (rule.field === 'notificationTypePrefix' && notificationType.startsWith(rule.match)) {
          return rule.to;
        }
      }

      return null;
    },

    isPersistableQueryKey(queryKey: readonly unknown[]): boolean {
      const head = queryKey[0];
      if (typeof head !== 'string' || head.length === 0) {
        return false;
      }
      return isPersistableModuleQuery(queryKey) ?? false;
    },

    dashboardQuickActions,

    dashboardTiles,
  };
}
