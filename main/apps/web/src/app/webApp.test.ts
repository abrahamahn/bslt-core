// main/apps/web/src/app/webApp.test.ts
import { describe, expect, it } from 'vitest';

import { installedModules } from '../generated/modules';

import { resolveAppRouteFlags } from './routeFlags';
import { webApp } from './webApp';

const HAS_TASKS = installedModules.some((m) => m.id === 'tasks');

describe('webApp', () => {
  it('denies persistence for undeclared, sensitive, and malformed query keys by default', () => {
    expect(webApp.isPersistableQueryKey([])).toBe(false);
    expect(webApp.isPersistableQueryKey([null])).toBe(false);
    expect(webApp.isPersistableQueryKey(['billing', 'invoices'])).toBe(false);
    expect(webApp.isPersistableQueryKey(['sessions'])).toBe(false);
  });

  it('rejects unsafe external or protocol-relative notification URLs', () => {
    expect(webApp.resolveNotificationRoute({ url: 'https://attacker.example/pwn' })).toBeNull();
    expect(webApp.resolveNotificationRoute({ url: '//attacker.example/pwn' })).toBeNull();
    expect(webApp.resolveNotificationRoute(undefined)).toBeNull();
  });

  it('aggregates installed module contributions (tasks, audit) into primary navigation and persistence', () => {
    const flags = resolveAppRouteFlags({
      advancedAdminEnabled: false,
      advancedAuthEnabled: false,
      billingEnabled: false,
      developerToolsEnabled: false,
      teamsEnabled: false,
    });

    const authLinks = webApp.getPrimaryNavLinks({ authenticated: true, admin: false, flags });
    expect(authLinks).toContainEqual({ label: 'Activities', to: '/activities' });
    expect(webApp.getPrimaryNavHints()['Activities']).toBeDefined();
    if (HAS_TASKS) {
      expect(authLinks).toContainEqual({ label: 'Tasks', to: '/tasks' });
      expect(webApp.getPrimaryNavHints()['Tasks']).toBeDefined();
      expect(webApp.isPersistableQueryKey(['tasks', 'list'])).toBe(true);
    }
  });
});
