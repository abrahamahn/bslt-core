// main/apps/web/src/app/admin/adminSurface.ts
import { routeFlagsToCapabilities } from '../routeFlags';
import { webApp } from '../webApp';

import type { ResolvedAdminSurface } from '@bslt/web-platform';

type AdminSurfaceDefinition = ResolvedAdminSurface;
export type AdminSurfaceId = string;

export const ADMIN_SURFACES: readonly AdminSurfaceDefinition[] = webApp.adminSurfaces;

export function getAdminNavSurfaces({
  advancedAdminEnabled = false,
}: {
  advancedAdminEnabled?: boolean;
} = {}): readonly AdminSurfaceDefinition[] {
  const flags = {
    advancedAdminEnabled,
    advancedAuthEnabled: false,
    billingEnabled: false,
    developerToolsEnabled: false,
    teamsEnabled: false,
  };
  return webApp.getAdminNavSurfaces(flags, routeFlagsToCapabilities(flags));
}

export const ADMIN_NAV_SURFACES: readonly AdminSurfaceDefinition[] = getAdminNavSurfaces();
