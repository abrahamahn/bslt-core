// main/apps/web/src/ssr/public-routes.test.tsx
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hydratePublic, renderPublic } from '@bslt/web-platform';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PUBLIC_SSR_MODULES, publicRoutes } from './public-routes';
import { PublicDocumentShell } from './PublicDocumentShell';

import { SITE_MAP, livePages } from '#app/app/siteMap';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');

describe('app publicRoutes', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('covers every live page in SITE_MAP so footer and SSR routes never drift', () => {
    const publicPaths = new Set(publicRoutes.map((route) => route.path));
    for (const page of livePages(SITE_MAP)) {
      expect(publicPaths.has(page.path), `missing PublicRoute for ${page.path}`).toBe(true);
    }
  });

  it('never server-renders logged-in or console routes', async () => {
    for (const privatePath of [
      '/dashboard',
      '/tasks',
      '/settings',
      '/profile',
      '/admin/dashboard',
      '/admin/users',
      '/login',
      '/register',
    ]) {
      const rendered = await renderPublic(
        new URL(`https://app.bslt.dev${privatePath}`),
        publicRoutes,
        {
          apiInternalUrl: 'http://api.internal:8080',
          siteUrl: 'https://app.bslt.dev',
          modules: PUBLIC_SSR_MODULES,
          Shell: PublicDocumentShell,
          template: TEMPLATE,
        },
      );
      expect(rendered, `unexpected SSR output for ${privatePath}`).toBeNull();
    }
  });

  it('renders LandingPage inside PublicDocumentShell and hydrates with zero remount', async () => {
    const rendered = await renderPublic(new URL('https://app.bslt.dev/'), publicRoutes, {
      apiInternalUrl: 'http://api.internal:8080',
      siteUrl: 'https://app.bslt.dev',
      modules: PUBLIC_SSR_MODULES,
      Shell: PublicDocumentShell,
      template: TEMPLATE,
    });

    expect(rendered).not.toBeNull();
    expect(rendered?.html).toContain('Clone-and-own SaaS starter');
    expect(rendered?.html).toContain('<link rel="canonical" href="https://app.bslt.dev/">');

    const parsed = new DOMParser().parseFromString(rendered?.html ?? '', 'text/html');
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    window.history.replaceState({}, '', '/');

    const rootEl = document.getElementById('root');
    if (rootEl === null) throw new Error('missing #root');
    const serverHeading = rootEl.querySelector('#landing-title');
    expect(serverHeading).not.toBeNull();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let handle: ReturnType<typeof hydratePublic> | undefined;
    await act(async () => {
      handle = hydratePublic(rootEl, publicRoutes, {
        modules: PUBLIC_SSR_MODULES,
        Shell: PublicDocumentShell,
      });
      await Promise.resolve();
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(rootEl.querySelector('#landing-title')).toBe(serverHeading);

    act(() => {
      handle?.unmount();
    });
  });
});
