// main/apps/web/src/app/admin/adminSurface.test.ts
import { describe, expect, it } from 'vitest';

import {
  hasAdminModule,
  hasBillingModule,
  hasNotificationsModule,
  installedModules,
} from '../../generated/modules';

import { ADMIN_SURFACES, getAdminNavSurfaces } from './adminSurface';

const INSTALLED_IDS: ReadonlySet<string> = new Set(installedModules.map((m) => m.id));
const hasMod = (id: string): boolean => INSTALLED_IDS.has(id);

const navIds = (advancedAdminEnabled: boolean): ReadonlySet<string> =>
  new Set(getAdminNavSurfaces({ advancedAdminEnabled }).map((surface) => surface.id));

describe('getAdminNavSurfaces', () => {
  it('exposes starter and installed-module surfaces when advanced admin is disabled', () => {
    const ids = navIds(false);

    expect(ids.has('security')).toBe(true);
    expect(ids.has('audit')).toBe(true);
    expect(ids.has('legal')).toBe(true);
    expect(ids.has('health')).toBe(hasAdminModule);
    expect(ids.has('users')).toBe(hasAdminModule);
    expect(ids.has('support')).toBe(hasMod('support'));
    expect(ids.has('feature-flags')).toBe(hasMod('flags'));
    expect(ids.has('notifications')).toBe(hasNotificationsModule);
    // Flag-gated admin surfaces stay hidden without advanced admin.
    expect(ids.has('billing')).toBe(false);
  });

  it('surfaces flag-gated admin surfaces once advanced admin is enabled', () => {
    const ids = navIds(true);

    expect(ids.has('dashboard')).toBe(true);
    expect(ids.has('feature-flags')).toBe(hasMod('flags'));
    expect(ids.has('notifications')).toBe(hasNotificationsModule);
    expect(ids.has('billing')).toBe(hasBillingModule);
  });

  it('never links the unlisted route manifest from navigation', () => {
    // Regression guard: the API route manifest is `unlisted: true` — it must
    // stay URL-routable but never appear as a sidebar entry, even with advanced
    // admin on.
    const routeManifest = ADMIN_SURFACES.find((surface) => surface.id === 'route-manifest');

    expect(routeManifest?.unlisted).toBe(true);
    expect('tier' in (routeManifest ?? {})).toBe(false);
    expect('starter' in (routeManifest ?? {})).toBe(false);
    expect(navIds(false).has('route-manifest')).toBe(false);
    expect(navIds(true).has('route-manifest')).toBe(false);
  });

  it('excludes every unlisted surface from navigation regardless of advanced admin', () => {
    const unlistedIds = ADMIN_SURFACES.filter((surface) => surface.unlisted).map(
      (surface) => surface.id,
    );

    expect(unlistedIds.length).toBeGreaterThan(0);
    for (const id of unlistedIds) {
      expect(navIds(false).has(id)).toBe(false);
      expect(navIds(true).has(id)).toBe(false);
    }
  });

  it('freezes ADMIN_SURFACES against runtime mutation', () => {
    expect(Object.isFrozen(ADMIN_SURFACES)).toBe(true);
    expect(() => {
      (ADMIN_SURFACES as unknown as Record<number, unknown>)[0] = null;
    }).toThrow(TypeError);
  });
});
