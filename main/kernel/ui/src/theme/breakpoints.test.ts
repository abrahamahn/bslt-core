// main/kernel/ui/src/theme/breakpoints.test.ts
import { describe, expect, it } from 'vitest';

import { breakpoints, contentMaxWidth, touchTargetSize } from './breakpoints';

describe('breakpoints', () => {
  it('exposes the canonical scale in ascending order', () => {
    expect(Object.keys(breakpoints)).toEqual(['sm', 'md', 'lg', 'xl', '2xl']);
    const values = Object.values(breakpoints).map((value) => Number.parseFloat(value));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('uses rem values only', () => {
    Object.values(breakpoints).forEach((value) => {
      expect(value).toMatch(/^[\d.]+rem$/);
    });
  });

  it('keeps md at 48rem, in sync with useIsMobile', () => {
    expect(breakpoints.md).toBe('48rem');
  });

  it('exposes rem layout constants', () => {
    expect(contentMaxWidth).toMatch(/^[\d.]+rem$/);
    expect(touchTargetSize).toBe('2.75rem');
  });
});
