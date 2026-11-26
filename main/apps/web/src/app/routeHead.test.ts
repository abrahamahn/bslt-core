// main/apps/web/src/app/routeHead.test.ts
import { describe, expect, it } from 'vitest';

import { resolveRouteHead } from './routeHead';

describe('resolveRouteHead', () => {
  it('resolves indexable SEO titles and descriptions for public routes and dynamic docs pages', () => {
    const home = resolveRouteHead('/', 'BSLT');
    expect(home.title).toBe('BSLT');
    expect(home.robots).toBeUndefined();
    expect(home.description).toBeTruthy();

    const status = resolveRouteHead('/status', 'BSLT');
    expect(status.title).toBe('System Status · BSLT');
    expect(status.robots).toBeUndefined();

    const apiDocs = resolveRouteHead('/docs/api', 'BSLT');
    expect(apiDocs.title).toContain('HTTP API Reference');
    expect(apiDocs.ogType).toBe('article');

    const identityMod = resolveRouteHead('/docs/modules/identity', 'BSLT');
    expect(identityMod.title).toBe('@bslt/identity Module Reference · BSLT Docs');
    expect(identityMod.robots).toBeUndefined();
  });

  it('marks authenticated, settings, workspace, admin, and unknown routes as noindex', () => {
    const login = resolveRouteHead('/login', 'BSLT');
    expect(login.title).toBe('Sign In · BSLT');
    expect(login.robots).toBe('noindex, nofollow');

    const secSettings = resolveRouteHead('/settings/security', 'BSLT');
    expect(secSettings.title).toBe('Security & Sign-in · BSLT');
    expect(secSettings.robots).toBe('noindex, nofollow');

    const adminUsers = resolveRouteHead('/admin/users/usr-123', 'BSLT');
    expect(adminUsers.title).toBe('User Management — Admin · BSLT');
    expect(adminUsers.robots).toBe('noindex, nofollow');

    const unknownModule = resolveRouteHead('/docs/modules/nonexistent-mod', 'BSLT');
    expect(unknownModule.title).toContain('Vertical Modules');

    const missing = resolveRouteHead('/some-missing-route', 'BSLT');
    expect(missing.title).toBe('Page Not Found · BSLT');
    expect(missing.robots).toBe('noindex, nofollow');
  });
});
