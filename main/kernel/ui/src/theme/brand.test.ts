// main/kernel/ui/src/theme/brand.test.ts
import { describe, expect, it } from 'vitest';

import { buildBrandScale } from './brand';

describe('buildBrandScale', () => {
  it('derives an 11-step 50-950 hex scale and accessible on-brand ink from oklch() and #rrggbb', () => {
    const scale = buildBrandScale('oklch(0.62 0.19 264)');
    for (const step of [
      '50',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
      '950',
    ] as const) {
      expect(scale.scale[step]).toMatch(/^#[0-9a-f]{6}$/u);
    }
    expect(scale.lightBrand).toMatch(/^#[0-9a-f]{6}$/u);
    expect(scale.darkBrand).toMatch(/^#[0-9a-f]{6}$/u);
    expect(scale.lightOnBrand).toMatch(/^#[0-9a-f]{6}$/u);
    expect(scale.darkOnBrand).toMatch(/^#[0-9a-f]{6}$/u);

    const hexScale = buildBrandScale('#4f46e5');
    expect(hexScale.scale['500']).toMatch(/^#[0-9a-f]{6}$/u);
  });

  it('rejects empty, unsupported, or out-of-range brand accent values', () => {
    expect(() => buildBrandScale('')).toThrow(/empty/iu);
    expect(() => buildBrandScale('rgb(10, 20, 30)')).toThrow(/unsupported brand accent/iu);
    expect(() => buildBrandScale('oklch(1.5 0.2 264)')).toThrow(/lightness/iu);
    expect(() => buildBrandScale('oklch(0.5 0.9 264)')).toThrow(/chroma/iu);
  });
});
