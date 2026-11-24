// main/apps/web/src/app/productMeta.ts
/**
 * Product-level copy shared across the landing page, SPA footer, and lean
 * public SSR shell without pulling the 17-module `webApp` composition root.
 */
import { BRAND } from '#app/generated/brand';

export const PRODUCT_TAGLINE = BRAND.tagline;
