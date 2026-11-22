// main/apps/web/src/app/routeFlags.test.ts
import { EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { describe, expect, it } from 'vitest';

import { hasAdminModule, hasBillingModule, hasFilesModule } from '../generated/modules';

import {
  deriveAppRouteFlags,
  resolveAppRouteFlags,
  routeFlagsToCapabilities,
  type AppRouteFlags,
} from './routeFlags';
import { appFrameRoutes, appFrameShells } from './routes';
import { webApp } from './webApp';

const ALL_OFF: AppRouteFlags = {
  advancedAdminEnabled: false,
  advancedAuthEnabled: false,
  billingEnabled: false,
  developerToolsEnabled: false,
  teamsEnabled: false,
};

describe('routeFlags', () => {
  it('derives all-false route flags from EMPTY_CAPABILITY_CONTEXT outside dev mode', () => {
    expect(deriveAppRouteFlags(EMPTY_CAPABILITY_CONTEXT, { isDev: false })).toEqual(ALL_OFF);
  });

  it('excludes magic authStrategy and disables flags when routeFlagsToCapabilities receives ALL_OFF', () => {
    const caps = routeFlagsToCapabilities(ALL_OFF);
    expect(caps.authStrategies).toEqual(['password']);
    expect(caps.authStrategies).not.toContain('magic');
    expect(caps.flags['flags.advanced_admin']).toBe(false);
    expect(caps.flags['flags.billing']).toBe(false);
    expect(caps.flags['flags.dev_tools']).toBe(false);
    expect(caps.flags['orgs.teams']).toBe(false);
  });

  it('throws when getRoutes is invoked without shells configured on frame or routeConfig', () => {
    const flags = resolveAppRouteFlags(ALL_OFF);
    expect(() => webApp.getRoutes(flags)).toThrow(/shells/i);
  });

  it('excludes developer-tool, billing, teams, and advanced-admin routes when starter flags are false', () => {
    const flags = resolveAppRouteFlags(ALL_OFF);
    const declaredPaths = new Set(
      webApp
        .getDeclaredRoutes(flags, {
          frameRoutes: appFrameRoutes,
          capabilities: routeFlagsToCapabilities(flags),
        })
        .map((r) => r.path),
    );

    expect(declaredPaths.has('/side-peek-ui-library')).toBe(false);
    expect(declaredPaths.has('/clean')).toBe(false);
    expect(declaredPaths.has('/ui-library')).toBe(false);
    expect(declaredPaths.has('/developer/api-routes')).toBe(false);
    expect(declaredPaths.has('/settings/billing')).toBe(false);
    expect(declaredPaths.has('/billing/success')).toBe(false);
    expect(declaredPaths.has('/billing/cancel')).toBe(false);
    expect(declaredPaths.has('/organization')).toBe(false);
    expect(declaredPaths.has('/invitations/:id/accept')).toBe(false);
    expect(declaredPaths.has('/auth/magic-link/verify')).toBe(false);
    expect(declaredPaths.has('/settings/accounts')).toBe(false);
    expect(declaredPaths.has('/admin/dashboard')).toBe(!hasAdminModule);
    expect(declaredPaths.has('/files')).toBe(hasFilesModule);
    expect(declaredPaths.has('/activities')).toBe(true);
  });

  it.runIf(hasBillingModule)(
    'marks stale-bookmark /pricing fallback as unlisted when billing is disabled, and listed when billing is enabled',
    () => {
      const starterFlags = resolveAppRouteFlags(ALL_OFF);
      const starterDeclared = webApp.getDeclaredRoutes(starterFlags, {
        frameRoutes: appFrameRoutes,
        capabilities: routeFlagsToCapabilities(starterFlags),
      });
      const billingFlags = resolveAppRouteFlags({
        ...ALL_OFF,
        billingEnabled: true,
      });
      const billingDeclared = webApp.getDeclaredRoutes(billingFlags, {
        frameRoutes: appFrameRoutes,
        capabilities: routeFlagsToCapabilities(billingFlags),
      });

      expect(starterDeclared.find((r) => r.path === '/pricing')?.unlisted).toBe(true);
      expect(billingDeclared.find((r) => r.path === '/pricing')?.unlisted).toBe(false);
    },
  );

  it('maps runtime flags and magic authStrategy onto AppRouteFlags and orders settings subroutes before settings/:tab', () => {
    const derived = deriveAppRouteFlags(
      {
        ...EMPTY_CAPABILITY_CONTEXT,
        modules: new Set(['billing', 'audit']),
        flags: {
          'flags.advanced_admin': true,
          'flags.billing': true,
          'orgs.teams': true,
        },
        authStrategies: ['password', 'magic'],
      },
      { isDev: false },
    );

    expect(derived).toEqual({
      advancedAdminEnabled: true,
      advancedAuthEnabled: true,
      billingEnabled: true,
      developerToolsEnabled: false,
      teamsEnabled: true,
    });

    const allOn = resolveAppRouteFlags({
      advancedAdminEnabled: true,
      advancedAuthEnabled: true,
      billingEnabled: true,
      developerToolsEnabled: true,
      teamsEnabled: true,
    });
    const routes = webApp.getRoutes(allOn, {
      shells: appFrameShells,
      frameRoutes: appFrameRoutes,
      capabilities: routeFlagsToCapabilities(allOn),
    });
    const rootChildren = routes.find((r) => r.element === appFrameShells.appShell)?.children ?? [];
    const accountsIdx = rootChildren.findIndex((r) => r.path === 'settings/accounts');
    const tabIdx = rootChildren.findIndex((r) => r.path === 'settings/:tab');

    expect(accountsIdx).toBeGreaterThan(-1);
    expect(accountsIdx).toBeLessThan(tabIdx);
    if (hasBillingModule) {
      const billingIdx = rootChildren.findIndex((r) => r.path === 'settings/billing');
      expect(billingIdx).toBeGreaterThan(-1);
      expect(billingIdx).toBeLessThan(tabIdx);
    }
    expect(rootChildren.at(-1)?.path).toBe('*');
  });
});
