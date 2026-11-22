// main/apps/web/src/app/frame.test.ts
import { describe, expect, it } from 'vitest';

import { hasAdminModule } from '../generated/modules';

import { appFrame } from './frame';

import type { AppRouteFlags } from './routeFlags';

const ALL_OFF: AppRouteFlags = {
  advancedAdminEnabled: false,
  advancedAuthEnabled: false,
  billingEnabled: false,
  developerToolsEnabled: false,
  teamsEnabled: false,
};

const ALL_ON: AppRouteFlags = {
  advancedAdminEnabled: true,
  advancedAuthEnabled: true,
  billingEnabled: true,
  developerToolsEnabled: true,
  teamsEnabled: true,
};

describe('appFrame', () => {
  it('freezes the root appFrame configuration against mutation', () => {
    expect(Object.isFrozen(appFrame)).toBe(true);
    expect(() => {
      (appFrame as Record<string, unknown>)['tampered'] = [];
    }).toThrow(TypeError);
  });

  it('excludes domain module nav, palette, and settings items from appFrame', () => {
    const navPaths = (appFrame.primaryNav ?? []).map((entry) => entry.to);
    expect(navPaths).toEqual(
      hasAdminModule
        ? ['/', '/dashboard', '/profile', '/settings']
        : ['/', '/dashboard', '/profile', '/settings', '/admin'],
    );
    expect(navPaths).not.toContain('/clean?doc=readme');

    const paletteIds = (appFrame.palette ?? []).map((entry) => entry.id);
    expect(paletteIds).toEqual(
      hasAdminModule
        ? ['nav-dashboard', 'nav-settings', 'action-change-theme']
        : ['nav-dashboard', 'nav-settings', 'nav-admin', 'action-change-theme'],
    );
    expect(paletteIds).not.toContain('nav-billing');

    const settingsIds = (appFrame.settingsSections ?? []).map((section) => section.id);
    expect(settingsIds).toEqual(['preferences']);
  });

  it('gates the composite admin dashboard surface on advancedAdminEnabled when @bslt/admin is installed', () => {
    const dashboardSurface = appFrame.adminSurfaces?.find((s) => s.id === 'dashboard');
    expect(dashboardSurface).toBeDefined();
    if (hasAdminModule) {
      expect(dashboardSurface?.when?.(ALL_OFF)).toBe(false);
      expect(dashboardSurface?.when?.(ALL_ON)).toBe(true);
    } else {
      expect(dashboardSurface?.when).toBeUndefined();
    }
  });

  it('declares only internal absolute paths across sitePages and dashboardQuickActions', () => {
    for (const page of appFrame.sitePages ?? []) {
      expect(page.path.startsWith('/')).toBe(true);
      expect(page.path.startsWith('//')).toBe(false);
    }
    for (const action of appFrame.dashboardQuickActions ?? []) {
      expect(action.to.startsWith('/')).toBe(true);
      expect(action.to.startsWith('//')).toBe(false);
    }
  });
});
