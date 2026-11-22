// main/modules/identity/web/index.test.ts
import { describe, expect, it } from 'vitest';

import { identityModule } from '../module';

import { identityWeb } from './index';

describe('identityWeb', () => {
  it('registers the 12 auth/identity routes, all 5 identity settings modal sections, notification routes/rules, and en-US message catalog', () => {
    expect(identityWeb.module).toBe(identityModule);
    expect(identityWeb.routes.map((r) => r.path)).toEqual([
      '/login',
      '/register',
      '/auth',
      '/auth/login',
      '/auth/register',
      '/auth/reset-password',
      '/auth/confirm-email',
      '/auth/change-email/confirm',
      '/auth/change-email/revert',
      '/reactivate',
      '/auth/magic-link/verify',
      '/settings/accounts',
    ]);
    expect(identityWeb.settings).toEqual([
      {
        id: 'profile',
        label: 'identity.settings.profileLabel',
        kind: 'section',
        order: 10,
      },
      {
        id: 'security',
        label: 'identity.settings.securityLabel',
        kind: 'section',
        order: 20,
      },
      {
        id: 'sessions',
        label: 'identity.settings.sessionsLabel',
        kind: 'section',
        order: 30,
      },
      {
        id: 'account',
        label: 'identity.settings.accountLabel',
        kind: 'section',
        order: 60,
      },
      {
        id: 'api-keys',
        label: 'identity.apiKeys.navLabel',
        kind: 'section',
        order: 80,
      },
    ]);
    expect(identityWeb.notificationRoutes?.['identity.account_alert']?.({})).toBe(
      '/settings?tab=security',
    );
    expect(identityWeb.notificationRules).toEqual([
      { field: 'actionPrefix', match: 'security.', to: '/settings/security' },
      { field: 'actionPrefix', match: 'user.', to: '/settings' },
      { field: 'notificationType', match: 'security_alert', to: '/settings?tab=security' },
    ]);
    expect(identityWeb.messages['identity.settings.profileLabel']).toBe('Profile');
    expect(identityWeb.messages['identity.settings.securityLabel']).toBe('Security');
    expect(identityWeb.messages['identity.settings.sessionsLabel']).toBe('Sessions');
    expect(identityWeb.messages['identity.settings.accountLabel']).toBe('Account');
    expect(identityWeb.messages['identity.apiKeys.navLabel']).toBe('API Keys');
  });

  it('freezes identityWeb routes, settings, and notificationRules contributions against mutation', () => {
    expect(Object.isFrozen(identityWeb)).toBe(true);
    expect(() => {
      (identityWeb.routes as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (identityWeb.settings as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (identityWeb.notificationRules as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it('freezes identityWeb messages map against mutation', () => {
    expect(Object.isFrozen(identityWeb.messages)).toBe(true);
    expect(() => {
      (identityWeb.messages as Record<string, string>)['identity.apiKeys.navLabel'] = 'Tampered';
    }).toThrow(TypeError);
  });
});
