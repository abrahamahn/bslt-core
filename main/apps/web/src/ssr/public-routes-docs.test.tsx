// main/apps/web/src/ssr/public-routes-docs.test.tsx
import { describe, expect, it } from 'vitest';

import { docsPublicRoutes } from './public-routes-docs';

describe('docsPublicRoutes', () => {
  it('registers branded article routes for /docs, /docs/api, and module reference pages', () => {
    const paths = new Set(docsPublicRoutes.map((route) => route.path));
    expect(paths.has('/docs')).toBe(true);
    expect(paths.has('/docs/api')).toBe(true);
    expect(paths.has('/docs/modules/identity')).toBe(true);
    expect(paths.has('/')).toBe(false);

    const apiRoute = docsPublicRoutes.find((route) => route.path === '/docs/api');
    const head = apiRoute?.head({});
    expect(head?.title).toContain('BSLT Docs');
    expect(head?.ogType).toBe('article');
  });
});
