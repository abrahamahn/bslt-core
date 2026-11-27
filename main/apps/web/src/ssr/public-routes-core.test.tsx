// main/apps/web/src/ssr/public-routes-core.test.tsx
import { describe, expect, it } from 'vitest';

import { corePublicRoutes, PUBLIC_SSR_MODULES } from './public-routes-core';

describe('corePublicRoutes', () => {
  it('registers branded landing and changelog routes without pulling /docs routes into the core bundle', () => {
    const paths = corePublicRoutes.map((route) => route.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/changelog');
    expect(paths.some((p) => p === '/docs' || p.startsWith('/docs/'))).toBe(false);
    expect(Array.isArray(PUBLIC_SSR_MODULES)).toBe(true);

    const landing = corePublicRoutes.find((route) => route.path === '/');
    const changelog = corePublicRoutes.find((route) => route.path === '/changelog');
    expect(landing?.head({}).title).toBe('BSLT');
    expect(changelog?.head({}).title).toBe('Changelog · BSLT');
  });
});
