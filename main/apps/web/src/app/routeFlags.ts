// main/apps/web/src/app/routeFlags.ts
/**
 * App-level route & frame capability flags derived from `CapabilityContext`.
 */

import { EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';

import type { CapabilityContext } from '@bslt/contract';

export interface AppRouteFlags {
  readonly advancedAdminEnabled: boolean;
  readonly advancedAuthEnabled: boolean;
  readonly billingEnabled: boolean;
  readonly developerToolsEnabled: boolean;
  readonly teamsEnabled: boolean;
}

export function deriveAppRouteFlags(
  ctx: CapabilityContext,
  options?: { readonly isDev?: boolean },
): AppRouteFlags {
  return {
    advancedAdminEnabled: ctx.flags['flags.advanced_admin'] === true,
    advancedAuthEnabled: ctx.authStrategies.includes('magic'),
    billingEnabled: ctx.flags['flags.billing'] === true,
    developerToolsEnabled: (options?.isDev ?? false) || ctx.flags['flags.dev_tools'] === true,
    teamsEnabled: ctx.flags['orgs.teams'] === true,
  };
}

export function resolveAppRouteFlags(
  overrides: Partial<AppRouteFlags> = {},
  ctx: CapabilityContext = EMPTY_CAPABILITY_CONTEXT,
): AppRouteFlags {
  const base = deriveAppRouteFlags(ctx, { isDev: import.meta.env.DEV });
  return {
    advancedAdminEnabled: overrides.advancedAdminEnabled ?? base.advancedAdminEnabled,
    advancedAuthEnabled: overrides.advancedAuthEnabled ?? base.advancedAuthEnabled,
    billingEnabled: overrides.billingEnabled ?? base.billingEnabled,
    developerToolsEnabled: overrides.developerToolsEnabled ?? base.developerToolsEnabled,
    teamsEnabled: overrides.teamsEnabled ?? base.teamsEnabled,
  };
}

export function routeFlagsToCapabilities(flags: AppRouteFlags): CapabilityContext {
  return {
    modules: new Set(['orgs', 'billing']),
    flags: {
      'flags.advanced_admin': flags.advancedAdminEnabled,
      'flags.billing': flags.billingEnabled,
      'flags.dev_tools': flags.developerToolsEnabled,
      'orgs.teams': flags.teamsEnabled,
    },
    entitlements: new Set(),
    eligibility: {
      tosAccepted: true,
      emailVerified: true,
      ageVerifiedFor: null,
      jurisdiction: null,
    },
    viewer: null,
    actingAs: { kind: 'user' },
    maxAudience: 100,
    authStrategies: flags.advancedAuthEnabled ? ['password', 'magic'] : ['password'],
  };
}
