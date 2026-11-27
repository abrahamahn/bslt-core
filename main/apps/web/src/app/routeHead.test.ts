// main/apps/web/src/app/routeHead.test.ts
import { describe, expect, it } from 'vitest';

import { resolveRouteHead } from './routeHead';

import { DOCS_REFERENCE } from '#app/pages/docsReference.generated';

describe('resolveRouteHead', () => {
  it('resolves indexable SEO titles and descriptions for public routes, blog articles, and dynamic docs pages', () => {
    const home = resolveRouteHead('/', 'BSLT');
    expect(home.title).toBe('BSLT');
    expect(home.robots).toBeUndefined();
    expect(home.description).toBeTruthy();

    const status = resolveRouteHead('/status', 'BSLT');
    expect(status.title).toBe('System Status · BSLT');
    expect(status.robots).toBeUndefined();

    const blog = resolveRouteHead('/blog', 'BSLT');
    expect(blog.title).toBe('Engineering & Product Blog · BSLT');
    expect(blog.robots).toBeUndefined();

    const blogPost = resolveRouteHead('/blog/zero-dep-architecture', 'BSLT');
    expect(blogPost.title).toBe('Zero Dep Architecture — Blog · BSLT');
    expect(blogPost.ogType).toBe('article');
    expect(blogPost.robots).toBeUndefined();

    const waitlist = resolveRouteHead('/waitlist', 'BSLT');
    expect(waitlist.title).toBe('Request Early Access · BSLT');
    expect(waitlist.robots).toBeUndefined();

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

    const projects = resolveRouteHead('/projects', 'BSLT');
    expect(projects.title).toBe('Projects · BSLT');
    expect(projects.robots).toBe('noindex, nofollow');

    const projectBoard = resolveRouteHead('/projects/proj-123', 'BSLT');
    expect(projectBoard.title).toBe('Project Board · BSLT');
    expect(projectBoard.robots).toBe('noindex, nofollow');

    const ai = resolveRouteHead('/ai', 'BSLT');
    expect(ai.title).toBe('AI Assistant · BSLT');
    expect(ai.robots).toBe('noindex, nofollow');

    const referrals = resolveRouteHead('/referrals', 'BSLT');
    expect(referrals.title).toBe('Referrals · BSLT');
    expect(referrals.robots).toBe('noindex, nofollow');

    const sso = resolveRouteHead('/auth/sso/callback', 'BSLT');
    expect(sso.title).toBe('Enterprise SSO Sign-In · BSLT');
    expect(sso.robots).toBe('noindex, nofollow');

    const secSettings = resolveRouteHead('/settings/security', 'BSLT');
    expect(secSettings.title).toBe('Security & Sign-in · BSLT');
    expect(secSettings.robots).toBe('noindex, nofollow');

    const adminUsers = resolveRouteHead('/admin/users/usr-123', 'BSLT');
    expect(adminUsers.title).toBe('User Management — Admin · BSLT');
    expect(adminUsers.robots).toBe('noindex, nofollow');

    const adminGrowth = resolveRouteHead('/admin/growth', 'BSLT');
    expect(adminGrowth.title).toBe('Growth & Launch — Admin · BSLT');
    expect(adminGrowth.robots).toBe('noindex, nofollow');

    const unknownModule = resolveRouteHead('/docs/modules/nonexistent-mod', 'BSLT');
    expect(unknownModule.title).toContain('Vertical Modules');

    const missing = resolveRouteHead('/some-missing-route', 'BSLT');
    expect(missing.title).toBe('Page Not Found · BSLT');
    expect(missing.robots).toBe('noindex, nofollow');
  });

  it('never falls back to Page Not Found for any installed web route in DOCS_REFERENCE', () => {
    for (const route of DOCS_REFERENCE.webRoutes) {
      if (route.path === '*' || route.path.includes('*')) continue;
      const concrete = route.path.replace(/:([a-zA-Z0-9_]+)/gu, 'sample-$1');
      const resolved = resolveRouteHead(concrete, 'BSLT');
      expect(resolved.title, `missing routeHead entry for ${route.path} (${concrete})`).not.toBe(
        'Page Not Found · BSLT',
      );
    }
  });
});
