// main/kernel/react/src/hooks/useBreakpoint.test.ts
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import react from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBreakpoint, useBreakpointDown, useBreakpointUp } from './useBreakpoint';

/**
 * matchMedia stub that resolves `(min-width: Xrem)` / `(max-width: Xrem)`
 * queries against a simulated viewport width in rem.
 */
function installMatchMedia(viewportRem: number): ReturnType<typeof vi.fn> {
  const matchMedia = vi.fn((query: string) => {
    const min = /\(min-width:\s*([\d.]+)rem\)/.exec(query)?.[1];
    const max = /\(max-width:\s*([\d.]+)rem\)/.exec(query)?.[1];
    let matches = false;
    if (min !== undefined) matches = viewportRem >= Number.parseFloat(min);
    if (max !== undefined) matches = viewportRem <= Number.parseFloat(max);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      addListener: () => {},
      removeListener: () => {},
    } as unknown as MediaQueryList;
  });
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return matchMedia;
}

const BreakpointHarness = (): react.ReactElement => {
  const bp = useBreakpoint();
  return react.createElement('span', { 'data-testid': 'bp' }, bp);
};

const UpDownHarness = (): react.ReactElement => {
  const up = useBreakpointUp('lg');
  const down = useBreakpointDown('md');
  return react.createElement('span', { 'data-testid': 'updown' }, `${String(up)}/${String(down)}`);
};

const originalMatchMedia = window.matchMedia;

describe('useBreakpoint', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns xs below the smallest token', () => {
    installMatchMedia(20);
    render(react.createElement(BreakpointHarness));
    expect(screen.getByTestId('bp')).toHaveTextContent('xs');
  });

  it('returns the largest matching token (mobile-first buckets)', () => {
    installMatchMedia(48);
    render(react.createElement(BreakpointHarness));
    expect(screen.getByTestId('bp')).toHaveTextContent('md');
  });

  it('returns 2xl on ultrawide viewports', () => {
    installMatchMedia(120);
    render(react.createElement(BreakpointHarness));
    expect(screen.getByTestId('bp')).toHaveTextContent('2xl');
  });

  it('queries the canonical rem scale', () => {
    const matchMedia = installMatchMedia(64);
    render(react.createElement(BreakpointHarness));
    const queries = matchMedia.mock.calls.map((call) => call[0] as string);
    expect(queries).toEqual(
      expect.arrayContaining([
        '(min-width: 30rem)',
        '(min-width: 48rem)',
        '(min-width: 64rem)',
        '(min-width: 80rem)',
        '(min-width: 96rem)',
      ]),
    );
  });
});

describe('useBreakpointUp / useBreakpointDown', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('reports min-width and max-width matches for named tokens', () => {
    installMatchMedia(48);
    render(react.createElement(UpDownHarness));
    // 48rem viewport: not >= lg (64rem), but <= md (48rem, inclusive)
    expect(screen.getByTestId('updown')).toHaveTextContent('false/true');
  });
});
