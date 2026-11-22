// main/kernel/ui/src/theme/spacing.test.ts
import { describe, expect, it } from 'vitest';

import { spacing } from './spacing';

const staticPattern = /^[\d.]+rem$/;
const fluidPattern = /^clamp\([\d.]+rem, [\d.]+rem \+ [\d.]+vw, [\d.]+rem\)$/;

describe('spacing', () => {
  it('exposes the expected spacing keys', () => {
    expect(Object.keys(spacing)).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);
  });

  it('keeps fine gaps static rem values', () => {
    (['xs', 'sm', 'md', 'lg', 'xl'] as const).forEach((key) => {
      expect(spacing[key]).toMatch(staticPattern);
      expect(Number.parseFloat(spacing[key])).toBeGreaterThan(0);
    });
  });

  it('uses fluid clamp() for page-level gaps whose midpoint hits the legacy value at 80rem', () => {
    const legacy = { ['2xl']: 2, ['3xl']: 3 } as const;
    (['2xl', '3xl'] as const).forEach((key) => {
      const value = spacing[key];
      expect(value).toMatch(fluidPattern);
      const [min = 0, base = 0, slope = 0, max = 0] = (value.match(/[\d.]+/g) ?? []).map(Number);
      expect(base + slope * 0.8).toBeCloseTo(legacy[key], 5);
      expect(min).toBeLessThan(legacy[key]);
      expect(max).toBeGreaterThan(legacy[key]);
    });
  });
});
