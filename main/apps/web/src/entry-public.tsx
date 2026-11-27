// main/apps/web/src/entry-public.tsx
/**
 * Lean public client entry (restructure plan §11.3).
 *
 * Hydrates server-rendered `PublicRoute` pages when `#__BSLT_STATE__` is present,
 * skipping the boot splash and omitting `AppShell`, `ConsoleShell`, and
 * `AuthService.initialize()`. Dynamically code-splits `/docs/*` routes so landing,
 * blog, waitlist, status, and legal pages stay well under Lighthouse JS budgets.
 */

import { startConsentSync } from '@bslt/compliance/web';
import { hydratePublic, SSR_STATE_ELEMENT_ID, type HydratePublicHandle } from '@bslt/web-platform';

import { corePublicRoutes, PUBLIC_SSR_MODULES } from './ssr/public-routes-core';
import { PublicDocumentShell } from './ssr/PublicDocumentShell';

import { clientConfig } from '#app/config';
import { applyBrandTheme } from '#app/generated/brand';

import '@bslt/ui/styles/elements.css';

function readDehydratedPathname(doc: Document): string {
  const fallback = typeof window !== 'undefined' ? window.location.pathname : '/';
  const stateEl = doc.getElementById(SSR_STATE_ELEMENT_ID);
  const raw = stateEl?.textContent.trim() ?? '';
  if (raw === '') {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const pathname = (parsed as Record<string, unknown>)['urlPathname'];
      if (typeof pathname === 'string' && pathname.startsWith('/')) {
        return pathname;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function isDocsPathname(pathname: string): boolean {
  return pathname === '/docs' || pathname.startsWith('/docs/');
}

export function bootstrapPublicClient(explicitRoot?: Element | null): HydratePublicHandle | null {
  const root = explicitRoot ?? document.getElementById('root');
  if (root === null) return null;
  if (root.ownerDocument.getElementById(SSR_STATE_ELEMENT_ID) === null) {
    return null;
  }

  applyBrandTheme(root.ownerDocument);
  startConsentSync();

  const hydrationOptions = {
    modules: PUBLIC_SSR_MODULES,
    apiBaseUrl: clientConfig.apiUrl,
    appName: clientConfig.appName,
    Shell: PublicDocumentShell,
  };

  const pathname = readDehydratedPathname(root.ownerDocument);
  if (isDocsPathname(pathname)) {
    let activeHandle: HydratePublicHandle | null = null;
    let cancelled = false;
    void import('./ssr/public-routes-docs').then(({ docsPublicRoutes }) => {
      if (cancelled) return;
      activeHandle = hydratePublic(
        root,
        [...corePublicRoutes, ...docsPublicRoutes],
        hydrationOptions,
      );
    });
    return {
      unmount(): void {
        cancelled = true;
        activeHandle?.unmount();
      },
    };
  }

  return hydratePublic(root, corePublicRoutes, hydrationOptions);
}

if (import.meta.env.MODE !== 'test' && typeof document !== 'undefined') {
  bootstrapPublicClient();
}
