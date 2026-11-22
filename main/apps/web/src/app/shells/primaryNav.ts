// main/apps/web/src/app/shells/primaryNav.ts
/**
 * Primary navigation aggregated from installed `WebModule` `slot: 'app.primary'`
 * contributions and `appFrame.primaryNav` via `webApp`.
 */

import { routeFlagsToCapabilities } from '../routeFlags';
import { webApp } from '../webApp';

import type { PrimaryNavHint } from '@bslt/web-platform';

export interface PrimaryNavLink {
  label: string;
  to: string;
}

export interface PrimaryNavState {
  readonly authenticated: boolean;
  readonly admin: boolean;
  readonly developerToolsEnabled: boolean;
  readonly teamsEnabled?: boolean;
}

export function getPrimaryNavHints(): Readonly<Record<string, PrimaryNavHint>> {
  return webApp.getPrimaryNavHints();
}

export function getPrimaryNavLinks(state: PrimaryNavState): PrimaryNavLink[] {
  const flags = {
    advancedAdminEnabled: false,
    advancedAuthEnabled: false,
    billingEnabled: false,
    developerToolsEnabled: state.developerToolsEnabled,
    teamsEnabled: state.teamsEnabled ?? false,
  };
  return webApp.getPrimaryNavLinks({
    authenticated: state.authenticated,
    admin: state.admin,
    flags,
    capabilities: routeFlagsToCapabilities(flags),
  });
}
