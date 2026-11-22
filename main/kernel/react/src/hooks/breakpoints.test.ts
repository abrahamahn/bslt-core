// main/kernel/react/src/hooks/breakpoints.test.ts
import { describe, expect, it } from 'vitest';

import { BREAKPOINT_ORDER, MOBILE_BREAKPOINT, breakpointDown, breakpointUp } from './breakpoints';

describe('breakpoints scale and media queries', () => {
  it('exposes the canonical scale in ascending order with md=48rem as the mobile boundary', () => {
    expect(BREAKPOINT_ORDER).toEqual(['sm', 'md', 'lg', 'xl', '2xl']);
    expect(MOBILE_BREAKPOINT).toBe('md');
    expect(breakpointUp('md')).toBe('(min-width: 48rem)');
    expect(breakpointDown('md')).toBe('(max-width: 48rem)');
    expect(breakpointUp('2xl')).toBe('(min-width: 96rem)');
  });
});
