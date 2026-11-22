// main/apps/web/src/app/siteMap.test.ts

import { DOCUMENT_TYPES, type DocumentType } from '@bslt/compliance/contract';
import { describe, expect, it } from 'vitest';

import { routeFlagsToCapabilities, type AppRouteFlags } from './routeFlags';
import { createAppRoutes, getDeclaredAppRoutes } from './routes';
import { SITE_MAP, SITE_SECTIONS, livePages, liveSiteSections, type SitePage } from './siteMap';
import { webApp } from './webApp';

import type { AppRoute } from './routes';
import type { ResolvedDeclaredRoute } from '@bslt/web-platform';

/**
 * Every absolute path the router serves, composed the way the router composes
 * them: a child path is relative to its parent unless it starts with `/`, and an
 * index route IS its parent's path.
 */
function routePaths(routes: readonly AppRoute[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const self = route.index === true ? parent : joinPath(parent, route.path ?? '');
    return [self, ...routePaths(route.children ?? [], self)];
  });
}

function joinPath(parent: string, path: string): string {
  if (path.startsWith('/')) return path;
  if (path === '') return parent === '' ? '/' : parent;
  return `${parent === '/' ? '' : parent}/${path}`;
}

/**
 * The default starter build: every optional capability off. A public page has to
 * be reachable in THIS configuration — a link that only resolves when billing or
 * developer tools happen to be enabled is a 404 for everyone else.
 */
const starterRoutePaths = new Set(
  routePaths(
    createAppRoutes({
      activityFeedEnabled: false,
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
      teamsEnabled: false,
    }),
  ),
);

const pageA: SitePage = { path: '/live', title: 'Live', section: 'product', live: true };
const pageB: SitePage = { path: '/dark', title: 'Dark', section: 'legal', live: false };

/**
 * The ownership split for legal prose. DB-owned documents are published from
 * the admin publisher and versioned — the ToS acceptance gate keys on those
 * versions. File-owned documents ship with the bundle from docs/legal/ and are
 * pinned to a canonical path HERE: renaming the path breaks published URLs and
 * must fail this suite, not slide through as a site-map edit.
 *
 * `Exclude` makes the split total: a sixth DOCUMENT_TYPES entry fails the
 * type-check on this record until it is classified as DB-owned or file-owned.
 */
const DB_OWNED_TYPES = ['terms_of_service', 'privacy_policy'] as const;
const FILE_OWNED_PAGE_PATHS: Readonly<
  Record<Exclude<DocumentType, (typeof DB_OWNED_TYPES)[number]>, `/${string}`>
> = {
  cookie_policy: '/cookies',
  acceptable_use: '/acceptable-use',
  disclaimer: '/disclaimer',
};

describe('siteMap', () => {
  it('serves every live page from the default starter router', () => {
    for (const page of livePages()) {
      expect(starterRoutePaths.has(page.path), `no route serves ${page.path}`).toBe(true);
    }
  });

  it('declares each path once', () => {
    const paths = SITE_MAP.map((page) => page.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every page a section the footer renders', () => {
    const sectionIds = new Set(SITE_SECTIONS.map((section) => section.id));

    for (const page of SITE_MAP) {
      expect(sectionIds.has(page.section)).toBe(true);
    }
  });

  it('gives every DB-published legal document exactly one live page', () => {
    // A DB-owned type with no page is a legal document the app publishes and
    // then cannot show — the ToS gate would link into a 404.
    for (const documentType of DB_OWNED_TYPES) {
      const pages = livePages().filter((page) => page.document === documentType);

      expect(pages, `no live page renders ${documentType}`).toHaveLength(1);
    }
  });

  it('serves every file-owned legal document at its pinned canonical path', () => {
    for (const [documentType, path] of Object.entries(FILE_OWNED_PAGE_PATHS)) {
      const page = livePages().find((candidate) => candidate.path === path);

      expect(page, `no live page at ${path} for ${documentType}`).toBeDefined();
      expect(page?.section).toBe('legal');
      // A `document` on a file-owned page would claim a DB version fills a
      // page whose prose actually ships with the bundle.
      expect(page?.document).toBeUndefined();
    }
  });

  it('classifies every publishable document type as DB-owned or file-owned, once', () => {
    const classified = [...DB_OWNED_TYPES, ...Object.keys(FILE_OWNED_PAGE_PATHS)];

    expect([...classified].sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it('only attaches a DB document to a legal page that is Terms or Privacy', () => {
    for (const page of SITE_MAP) {
      if (page.document === undefined) continue;
      expect(page.section).toBe('legal');
      expect(DB_OWNED_TYPES).toContain(page.document);
    }
  });

  describe('livePages', () => {
    it('keeps live pages and drops dark ones', () => {
      expect(livePages([pageA, pageB])).toEqual([pageA]);
    });

    it('returns nothing when no page is live', () => {
      expect(livePages([pageB])).toEqual([]);
    });
  });

  describe('liveSiteSections', () => {
    it('drops a section whose pages are all dark', () => {
      const sections = liveSiteSections([pageA, pageB]);

      expect(sections.map(({ section }) => section.id)).toEqual(['product']);
      expect(sections[0]?.pages).toEqual([pageA]);
    });

    it('returns no section at all when nothing is live', () => {
      expect(liveSiteSections([pageB])).toEqual([]);
    });

    it('orders sections as declared, not as the pages happen to be listed', () => {
      const support: SitePage = { path: '/help', title: 'Help', section: 'support', live: true };
      const legal: SitePage = { path: '/tos', title: 'Terms', section: 'legal', live: true };

      expect(liveSiteSections([support, legal, pageA]).map(({ section }) => section.id)).toEqual([
        'product',
        'legal',
        'support',
      ]);
    });

    it('groups the real site map without losing a live page', () => {
      const grouped = liveSiteSections().flatMap(({ pages }) => pages);

      expect(grouped).toHaveLength(livePages().length);
    });
  });

  describe('route reachability across nav slots', () => {
    function stripQueryAndHash(target: string): string {
      return target.split(/[?#]/u)[0] ?? target;
    }

    function reachableNavPaths(flags: AppRouteFlags): ReadonlySet<string> {
      const paths = new Set<string>();
      for (const page of livePages()) {
        paths.add(page.path);
      }
      for (const state of [
        { authenticated: false, admin: false, flags },
        { authenticated: true, admin: false, flags },
        { authenticated: true, admin: true, flags },
      ]) {
        for (const link of webApp.getPrimaryNavLinks(state)) {
          paths.add(stripQueryAndHash(link.to));
        }
      }
      for (const entry of webApp.getPaletteEntries({ admin: true, flags })) {
        if (entry.to !== undefined) {
          paths.add(stripQueryAndHash(entry.to));
        }
      }
      for (const item of webApp.getSettingsNavItems(flags)) {
        if (item.to !== undefined) {
          paths.add(stripQueryAndHash(item.to));
        }
      }
      for (const surface of webApp.getAdminNavSurfaces(flags, routeFlagsToCapabilities(flags))) {
        paths.add(stripQueryAndHash(surface.href));
      }
      for (const action of webApp.dashboardQuickActions) {
        paths.add(stripQueryAndHash(action.to));
      }
      for (const tile of webApp.dashboardTiles) {
        paths.add(stripQueryAndHash(tile.href));
      }
      return paths;
    }

    function findUnreachableListedRoutes(
      declared: readonly ResolvedDeclaredRoute[],
      reachable: ReadonlySet<string>,
    ): string[] {
      return declared
        .filter((route) => !route.unlisted && !reachable.has(route.path))
        .map((route) => route.path);
    }

    const STARTER_OFF: AppRouteFlags = {
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
      teamsEnabled: false,
    };

    const EVERYTHING_ON: AppRouteFlags = {
      advancedAdminEnabled: true,
      advancedAuthEnabled: true,
      billingEnabled: true,
      developerToolsEnabled: true,
      teamsEnabled: true,
    };

    it('ensures every declared route is reachable from a nav surface or marked unlisted across flag configurations', () => {
      for (const flags of [
        STARTER_OFF,
        { ...STARTER_OFF, developerToolsEnabled: true },
        EVERYTHING_ON,
        { ...EVERYTHING_ON, developerToolsEnabled: false },
      ]) {
        const declared = getDeclaredAppRoutes(flags);
        const reachable = reachableNavPaths(flags);

        expect(findUnreachableListedRoutes(declared, reachable)).toEqual([]);
      }
    });

    it('flags any non-unlisted route that no navigation surface links to', () => {
      const reachable = reachableNavPaths(STARTER_OFF);
      const synthetic: readonly ResolvedDeclaredRoute[] = [
        ...getDeclaredAppRoutes(STARTER_OFF),
        { path: '/orphan-unlinked-page', unlisted: false },
        { path: '/deep-link/:id', unlisted: true },
      ];

      expect(findUnreachableListedRoutes(synthetic, reachable)).toEqual(['/orphan-unlinked-page']);
      expect(
        findUnreachableListedRoutes([{ path: '/deep-link/:id', unlisted: false }], reachable),
      ).toEqual(['/deep-link/:id']);
    });

    it('freezes SITE_SECTIONS and SITE_MAP against runtime mutation', () => {
      expect(Object.isFrozen(SITE_SECTIONS)).toBe(true);
      expect(Object.isFrozen(SITE_MAP)).toBe(true);
    });
  });
});
