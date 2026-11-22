// main/apps/web/src/app/siteMap.ts
/**
 * The public surface: every page a signed-out visitor — or a crawler — can land on.
 *
 * Declared once, because three things have to agree and they are built in
 * different files: the router (routes.tsx), the footer (shells/SiteFooter.tsx),
 * and the build-time prerenderer. When they drift, the footer advertises a 404
 * and the prerenderer ships HTML for a path nobody serves.
 *
 * `live` is the gate, and it is enforced by the type system rather than by
 * discipline: the footer only accepts a `LiveSitePage`, and the only way to get
 * one is `livePages()`. A page declared here before its route exists is
 * therefore invisible everywhere until someone flips the flag — it cannot be
 * linked by mistake. `siteMap.test.ts` closes the loop from the other side: a
 * `live` page whose path the router does not serve fails the build.
 *
 * Adding a public page is ONE entry here, not an edit in three files that drift.
 *
 * Authenticated pages (dashboard, settings, and `/pricing`, which is auth-gated
 * in this starter) are deliberately absent: they are not public, they cannot be
 * prerendered without a user, and a footer link to one bounces a signed-out
 * visitor into a login wall. A fork that makes pricing public adds it here.
 */

import { webApp } from './webApp';

import type { DocumentType } from '@bslt/compliance/contract';
import type { SiteSection, SiteSectionId } from '@bslt/web-platform';

export type { SiteSection, SiteSectionId };

export const SITE_SECTIONS: readonly SiteSection[] = webApp.siteSections;

export interface SitePage {
  /**
   * The canonical path, and the path the prerenderer renders. Aliases the router
   * also serves (`/terms-of-service` → Terms) are not pages: they exist to keep
   * old links alive, and indexing both would split the page's ranking in two.
   */
  readonly path: `/${string}`;
  /** The page's title — the prerendered `<title>`, and the footer's link text. */
  readonly title: string;
  /**
   * One sentence for `<meta name="description">` and `og:description`.
   *
   * Optional, and omitted rather than invented: a crawler shows a snippet from
   * the page when there is no description, which beats a generic one repeated
   * across every page.
   */
  readonly description?: string;
  readonly section: SiteSectionId;
  /**
   * The DB-published legal document that fills the page. Only Terms and
   * Privacy carry one — the ToS acceptance gate keys on their version numbers.
   * The other legal pages are file-owned (`@bslt/compliance` seeds, rendered by
   * `@bslt/compliance/web`) and have no document.
   */
  readonly document?: DocumentType;
  /** True once the router serves `path`. False = declared, not built: nothing links it. */
  readonly live: boolean;
}

/** A page whose route exists today. The only kind the footer and the prerenderer accept. */
type LiveSitePage = SitePage & { readonly live: true };

export const SITE_MAP: readonly SitePage[] = webApp.sitePages;

/**
 * The pages that actually exist. Every consumer that renders or crawls a link
 * goes through here — the filter lives in one place so it cannot be forgotten in
 * another. The prerenderer gets exactly what it needs: `path` and `title`.
 */
export function livePages(
  pages: readonly SitePage[] = SITE_MAP,
): readonly (SitePage & { readonly live: true })[] {
  return pages.filter((page): page is LiveSitePage => page.live);
}

/**
 * The footer's data: sections in declared order, each carrying its live pages.
 * A section whose pages are all dark is dropped entirely — an empty column with
 * a heading reads as breakage, not as "coming soon".
 */
export function liveSiteSections(pages: readonly SitePage[] = SITE_MAP): readonly {
  readonly section: SiteSection;
  readonly pages: readonly (SitePage & { readonly live: true })[];
}[] {
  const live = livePages(pages);
  return SITE_SECTIONS.flatMap((section) => {
    const sectionPages = live.filter((page) => page.section === section.id);
    return sectionPages.length === 0 ? [] : [{ section, pages: sectionPages }];
  });
}

/**
 * The one-liner that names the product. Kept here because it has to be the same
 * sentence on the landing page and in the footer — two surfaces saying two
 * different things about what this is, is how a product ends up with no story.
 */
export { PRODUCT_TAGLINE } from './productMeta';
