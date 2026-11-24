// main/apps/web/src/app/shells/primaryNav.test.ts
import { describe, expect, it } from 'vitest';

import { hasFilesModule, installedModules, installedWebModules } from '../../generated/modules';

import {
  getPrimaryNavHints,
  getPrimaryNavLinks,
  type PrimaryNavLink,
  type PrimaryNavState,
} from './primaryNav';

const MODULE_NAV_ENTRIES: ReadonlyArray<{ readonly order: number; readonly link: PrimaryNavLink }> =
  installedWebModules
    .flatMap((mod) => {
      if (mod === null || mod.nav === undefined) return [];
      return mod.nav
        .filter(
          (item) =>
            item.slot === 'app.primary' &&
            (item.audience === undefined || item.audience === 'authenticated') &&
            item.requires === undefined,
        )
        .map((item) => ({
          order: item.order,
          link: { label: mod.messages[item.label] ?? item.label, to: item.to },
        }));
    })
    .sort((a, b) => a.order - b.order);

const PRE_FILES_MODULE_LINKS: readonly PrimaryNavLink[] = MODULE_NAV_ENTRIES.filter(
  (entry) => entry.order < 60,
).map((entry) => entry.link);

const POST_MEDIA_MODULE_LINKS: readonly PrimaryNavLink[] = MODULE_NAV_ENTRIES.filter(
  (entry) => entry.order > 70,
).map((entry) => entry.link);

const SIGNED_OUT: PrimaryNavState = {
  authenticated: false,
  admin: false,
  developerToolsEnabled: false,
};

const SIGNED_IN: PrimaryNavState = { ...SIGNED_OUT, authenticated: true };

describe('getPrimaryNavLinks', () => {
  it('gives a signed-out visitor public links only and omits authenticated/admin links', () => {
    expect(getPrimaryNavLinks(SIGNED_OUT)).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Changelog', to: '/changelog' },
    ]);
  });

  it('adds developer links for a signed-out visitor only when developer tools are enabled', () => {
    expect(getPrimaryNavLinks({ ...SIGNED_OUT, developerToolsEnabled: true })).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Changelog', to: '/changelog' },
      { label: 'Docs', to: '/clean?doc=readme' },
      { label: 'API Routes', to: '/developer/api-routes' },
      { label: 'Email Inbox', to: '/developer/emails' },
      { label: 'UI Library', to: '/ui-library' },
    ]);
  });

  it('gives a signed-in non-admin user product links without admin or public-only links', () => {
    if (installedModules.some((m) => m.id === 'tasks')) {
      expect(PRE_FILES_MODULE_LINKS).toContainEqual({ label: 'Tasks', to: '/tasks' });
    }
    expect(POST_MEDIA_MODULE_LINKS).toContainEqual({ label: 'Activities', to: '/activities' });
    expect(getPrimaryNavLinks({ ...SIGNED_IN, developerToolsEnabled: true })).toEqual([
      { label: 'Dashboard', to: '/dashboard' },
      ...PRE_FILES_MODULE_LINKS,
      ...(hasFilesModule ? [{ label: 'Files', to: '/files' }] : []),
      ...POST_MEDIA_MODULE_LINKS,
      { label: 'Settings', to: '/settings' },
    ]);
    if (installedModules.some((m) => m.id === 'orgs')) {
      expect(getPrimaryNavLinks({ ...SIGNED_IN, teamsEnabled: true })).toContainEqual({
        label: 'Workspace',
        to: '/organization',
      });
    }
  });

  it('adds Admin last for an authenticated admin and omits it when unauthenticated', () => {
    expect(getPrimaryNavLinks({ ...SIGNED_IN, admin: true }).at(-1)).toEqual({
      label: 'Admin',
      to: '/admin',
    });
    expect(getPrimaryNavLinks({ ...SIGNED_OUT, admin: true })).toEqual([
      { label: 'Home', to: '/' },
      { label: 'Changelog', to: '/changelog' },
    ]);
  });

  it('returns a fresh list on every call so caller mutations cannot leak', () => {
    const first = getPrimaryNavLinks(SIGNED_IN);
    first.push({ label: 'Mutated', to: '/mutated' });

    expect(getPrimaryNavLinks(SIGNED_IN).map((link) => link.label)).not.toContain('Mutated');
  });

  it('aggregates feature hints and omits hints for plain links', () => {
    const hints = getPrimaryNavHints();

    if (installedModules.some((m) => m.id === 'tasks')) {
      expect(hints['Tasks']?.featureKey).toBe('tasks');
    }
    expect(hints['Activities']?.featureKey).toBe('audit');
    if (hasFilesModule) {
      expect(hints['Files']?.featureKey).toBe('files');
    }
    expect(hints['Settings']?.featureKey).toBe('settings');
    expect(hints['Home']).toBeUndefined();
    expect(hints['Admin']).toBeUndefined();
  });
});
