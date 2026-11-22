// main/kernel/react/src/hooks/useIsMobile.test.ts
/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import react from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from './useIsMobile';

type MatchMediaListener = () => void;
function createMatchMedia(initialMatches: boolean): {
  matchMedia: ReturnType<typeof vi.fn>;
  setMatches: (next: boolean) => void;
  fireChange: () => void;
  removeEventListener: ReturnType<typeof vi.fn>;
} {
  let matches = initialMatches;
  let listener: MatchMediaListener | null = null;
  const removeEventListener = vi.fn(() => {
    listener = null;
  });
  const mql = {
    get matches() {
      return matches;
    },
    media: '',
    onchange: null,
    addEventListener: (_event: string, cb: MatchMediaListener): void => {
      listener = cb;
    },
    removeEventListener,
    dispatchEvent: () => true,
    addListener: () => {},
    removeListener: () => {},
  } as unknown as MediaQueryList;
  return {
    matchMedia: vi.fn(() => mql),
    setMatches: (next: boolean): void => {
      matches = next;
    },
    fireChange: (): void => {
      listener?.();
    },
    removeEventListener,
  };
}

const IsMobileHarness = (): react.ReactElement => {
  const isMobile = useIsMobile();
  return react.createElement('span', { 'data-testid': 'is-mobile' }, String(isMobile));
};

const originalMatchMedia = window.matchMedia;

describe('useIsMobile', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("queries the design system's 48rem mobile breakpoint", () => {
    const media = createMatchMedia(false);
    window.matchMedia = media.matchMedia as unknown as typeof window.matchMedia;
    render(react.createElement(IsMobileHarness));
    expect(media.matchMedia).toHaveBeenCalledWith('(max-width: 48rem)');
  });

  it('returns false on desktop viewports and true after crossing the breakpoint', () => {
    const media = createMatchMedia(false);
    window.matchMedia = media.matchMedia as unknown as typeof window.matchMedia;
    render(react.createElement(IsMobileHarness));
    expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
    media.setMatches(true);
    act(() => {
      media.fireChange();
    });
    expect(screen.getByTestId('is-mobile')).toHaveTextContent('true');
  });

  it('cleans up the media query listener on unmount', () => {
    const media = createMatchMedia(true);
    window.matchMedia = media.matchMedia as unknown as typeof window.matchMedia;
    const { unmount } = render(react.createElement(IsMobileHarness));
    expect(screen.getByTestId('is-mobile')).toHaveTextContent('true');
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
