// main/apps/web/src/ssr/SsrContext.tsx
/**
 * SSR Data Context
 *
 * What the build-time prerenderer knows about the page it is rendering — its
 * path and its title, from the site map. It is populated once per page, in
 * `render()`, and read by any component that wants to render differently when it
 * is being prerendered rather than run in a browser.
 *
 * There is no payload on the client: prerendered markup is dropped and the app
 * mounts fresh (see src/bootstrap/client.tsx), so `useSsrData()` returns null in
 * the browser — and in tests — and every consumer must handle that.
 *
 * Usage
 * -----
 * Prerenderer (entry-server.tsx):
 *   render(url, { url, title: 'Terms of Service' })
 *
 * Page component:
 *   const ssrData = useSsrData();   // null in the browser
 */

import { createContext, useContext } from 'react';

import type { ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

/** Base shape for all SSR data payloads. */
export interface SsrData {
  /** The request URL that was rendered. */
  url: string;
  /** Page <title> for the ssr-head injection. */
  title?: string;
  /** Page meta description for the ssr-head injection. */
  description?: string;
  /**
   * Absolute URL for `<link rel="canonical">`, `og:url` and JSON-LD.
   * Absent when SITE_URL is unset — the tags are then omitted rather than
   * emitted with a path, because a relative canonical is worse than none: it
   * tells a crawler the page's identity without saying on which origin.
   */
  canonicalUrl?: string;
  [key: string]: unknown;
}

// ============================================================================
// Context
// ============================================================================

const SsrContext = createContext<SsrData | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function SsrDataProvider({
  value,
  children,
}: {
  value: SsrData | null;
  children: ReactNode;
}) {
  return <SsrContext.Provider value={value}>{children}</SsrContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Read server-fetched data in a component.
 *
 * Returns the data injected by the SSR server, or null when rendering
 * outside an SSR context (e.g. SPA routes or unit tests).
 *
 * @example
 * const data = useSsrData() as PublicPageData | null;
 * const title = data?.title ?? 'Untitled';
 */
export function useSsrData(): SsrData | null {
  return useContext(SsrContext);
}
