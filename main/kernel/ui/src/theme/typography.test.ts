// main/kernel/ui/src/theme/typography.test.ts
import { describe, expect, it } from 'vitest';

import { typography } from './typography';

const sizePattern = /^[\d.]+rem$/;

describe('typography', () => {
  it('includes a system font fallback', () => {
    expect(typography.fontFamily).toContain('system-ui');
  });

  it('uses static rem for body sizes', () => {
    (['2xs', 'xs', 'sm', 'md'] as const).forEach((key) => {
      expect(typography.sizes[key]).toMatch(sizePattern);
      expect(Number.parseFloat(typography.sizes[key])).toBeGreaterThan(0);
    });
  });

  it('uses fluid clamp() heading sizes whose midpoint hits the legacy value at 80rem', () => {
    const legacy = { lg: 1.25, xl: 1.5 } as const;
    (['lg', 'xl'] as const).forEach((key) => {
      const value = typography.sizes[key];
      expect(value).toMatch(/^clamp\([\d.]+rem, [\d.]+rem \+ [\d.]+vw, [\d.]+rem\)$/);
      const [min = 0, base = 0, slope = 0, max = 0] = (value.match(/[\d.]+/g) ?? []).map(Number);
      expect(base + slope * 0.8).toBeCloseTo(legacy[key], 5);
      expect(min).toBeLessThan(legacy[key]);
      expect(max).toBeGreaterThan(legacy[key]);
    });
  });

  it('exposes numeric font weights', () => {
    Object.values(typography.weights).forEach((value) => {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    });
  });

  it('exposes numeric line heights', () => {
    Object.values(typography.lineHeights).forEach((value) => {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    });
  });
});
