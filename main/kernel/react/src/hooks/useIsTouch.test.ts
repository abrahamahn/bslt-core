// main/kernel/react/src/hooks/useIsTouch.test.ts
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import react from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsTouch } from './useIsTouch';

function installMatchMedia(matches: boolean): ReturnType<typeof vi.fn> {
  const matchMedia = vi.fn(
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList,
  );
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return matchMedia;
}

const TouchHarness = (): react.ReactElement => {
  const isTouch = useIsTouch();
  return react.createElement('span', { 'data-testid': 'is-touch' }, String(isTouch));
};

const originalMatchMedia = window.matchMedia;

describe('useIsTouch', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('queries the coarse pointer media feature', () => {
    const matchMedia = installMatchMedia(false);
    render(react.createElement(TouchHarness));
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
    expect(screen.getByTestId('is-touch')).toHaveTextContent('false');
  });

  it('returns true on coarse-pointer devices', () => {
    installMatchMedia(true);
    render(react.createElement(TouchHarness));
    expect(screen.getByTestId('is-touch')).toHaveTextContent('true');
  });
});
