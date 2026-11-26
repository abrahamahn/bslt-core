// main/apps/web/src/pages/LandingPage.tsx
/**
 * Authenticated-aware Landing Page wrapper
 *
 * Delegates rendering to `LandingPageContent` (which stays free of `@bslt/identity/web`
 * so the lean public SSR entry never pulls auth/WebAuthn code into the initial bundle).
 */

import { useAuth } from '@bslt/identity/web';

import { LandingPageContent } from './PublicLandingPage';

import type { ReactElement } from 'react';

export const LandingPage = (): ReactElement => {
  const { isAuthenticated } = useAuth();
  return <LandingPageContent isAuthenticated={isAuthenticated} />;
};
