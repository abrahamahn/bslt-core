// main/apps/web/src/entry-public.tsx
/**
 * Lean public client entry (restructure plan §11.3).
 *
 * Hydrates server-rendered `PublicRoute` pages when `#__BSLT_STATE__` is present,
 * skipping the boot splash and omitting `AppShell`, `ConsoleShell`, and
 * `AuthService.initialize()`.
 */

import { startConsentSync } from '@bslt/compliance/web';
import { hydratePublic, SSR_STATE_ELEMENT_ID, type HydratePublicHandle } from '@bslt/web-platform';

import { PUBLIC_SSR_MODULES, publicRoutes } from './ssr/public-routes';
import { PublicDocumentShell } from './ssr/PublicDocumentShell';

import { clientConfig } from '#app/config';

import '@bslt/ui/styles/elements.css';

export function bootstrapPublicClient(explicitRoot?: Element | null): HydratePublicHandle | null {
  const root = explicitRoot ?? document.getElementById('root');
  if (root === null) return null;
  if (root.ownerDocument.getElementById(SSR_STATE_ELEMENT_ID) === null) {
    return null;
  }

  startConsentSync();

  return hydratePublic(root, publicRoutes, {
    modules: PUBLIC_SSR_MODULES,
    apiBaseUrl: clientConfig.apiUrl,
    Shell: PublicDocumentShell,
  });
}

if (import.meta.env.MODE !== 'test' && typeof document !== 'undefined') {
  bootstrapPublicClient();
}
