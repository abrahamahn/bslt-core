// main/apps/web/src/app/productMeta.test.ts
import { describe, expect, it } from 'vitest';

import { PRODUCT_TAGLINE } from './productMeta';
import { PRODUCT_TAGLINE as SITE_MAP_TAGLINE } from './siteMap';

describe('productMeta', () => {
  it('shares the single non-empty product tagline across landing and siteMap', () => {
    expect(PRODUCT_TAGLINE.trim().length).toBeGreaterThan(0);
    expect(PRODUCT_TAGLINE).toBe(SITE_MAP_TAGLINE);
  });
});
