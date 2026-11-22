// main/apps/web/src/app/account/settingsTabs.test.ts
import { describe, expect, it } from 'vitest';

import { hasBillingModule, hasNotificationsModule } from '../../generated/modules';

import { getActiveSettingsTab, getSettingsNavItems, normalizeSettingsTab } from './settingsTabs';

describe('normalizeSettingsTab', () => {
  it('accepts every canonical id', () => {
    expect(normalizeSettingsTab('profile')).toBe('profile');
    expect(normalizeSettingsTab('data-controls')).toBe('data-controls');
    expect(normalizeSettingsTab('billing')).toBe(hasBillingModule ? 'billing' : null);
  });

  it('maps historical aliases', () => {
    expect(normalizeSettingsTab('data')).toBe('data-controls');
    expect(normalizeSettingsTab('privacy')).toBe('data-controls');
    expect(normalizeSettingsTab('notification')).toBe(
      hasNotificationsModule ? 'notifications' : null,
    );
  });

  it('strips a leading hash and normalizes case/whitespace', () => {
    expect(normalizeSettingsTab('#security')).toBe('security');
    expect(normalizeSettingsTab('  Profile ')).toBe('profile');
  });

  it('rejects unknown values', () => {
    expect(normalizeSettingsTab('nonsense')).toBeNull();
    expect(normalizeSettingsTab('')).toBeNull();
    expect(normalizeSettingsTab(null)).toBeNull();
  });
});

describe('getActiveSettingsTab', () => {
  it('prefers ?tab= over hash over path', () => {
    expect(
      getActiveSettingsTab({
        pathname: '/settings/legal',
        hash: '#account',
        search: '?tab=security',
      }),
    ).toBe('security');
    expect(
      getActiveSettingsTab({ pathname: '/settings/legal', hash: '#account', search: '' }),
    ).toBe('account');
    expect(getActiveSettingsTab({ pathname: '/settings/legal', hash: '', search: '' })).toBe(
      'legal',
    );
  });

  it('defaults to profile', () => {
    expect(getActiveSettingsTab({ pathname: '/settings', hash: '', search: '' })).toBe('profile');
    expect(
      getActiveSettingsTab({ pathname: '/settings', hash: '#bogus', search: '?tab=bogus' }),
    ).toBe('profile');
  });

  it('resolves the /settings/<segment> path form', () => {
    expect(getActiveSettingsTab({ pathname: '/settings/sessions', hash: '', search: '' })).toBe(
      'sessions',
    );
    expect(getActiveSettingsTab({ pathname: '/settings/privacy', hash: '', search: '' })).toBe(
      'data-controls',
    );
  });
});

describe('getSettingsNavItems', () => {
  it('omits billing when disabled', () => {
    expect(getSettingsNavItems({ billingEnabled: false }).map((i) => i.id)).not.toContain(
      'billing',
    );
  });

  it.runIf(hasBillingModule)(
    'inserts billing before legal when enabled with route metadata',
    () => {
      const items = getSettingsNavItems({ billingEnabled: true });
      const ids = items.map((i) => i.id);
      const billing = items.find((i) => i.id === 'billing');

      expect(ids.indexOf('billing')).toBe(ids.length - 2);
      expect(ids[ids.length - 1]).toBe('legal');
      expect(billing?.kind).toBe('route');
      expect(billing?.to).toBe('/settings/billing');
    },
  );
});
