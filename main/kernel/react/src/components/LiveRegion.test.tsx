// main/kernel/react/src/components/LiveRegion.test.tsx
import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveRegion, useAnnounce } from './LiveRegion';

import type { ReactElement } from 'react';

const OrphanCaller = (): ReactElement => {
  useAnnounce();
  return <div />;
};

const AnnounceHarness = (): ReactElement => {
  const { announce } = useAnnounce();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          announce('Saved');
        }}
      >
        Polite
      </button>
      <button
        type="button"
        onClick={() => {
          announce('Critical failure', 'assertive');
        }}
      >
        Assertive
      </button>
    </div>
  );
};

describe('LiveRegion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when useAnnounce is called outside a LiveRegion provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<OrphanCaller />)).toThrow(
      'useAnnounce must be used within a <LiveRegion> provider',
    );
    consoleSpy.mockRestore();
  });

  it('renders polite and assertive live regions with class visually-hidden and no inline style', () => {
    render(
      <LiveRegion>
        <span>Child</span>
      </LiveRegion>,
    );

    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    expect(status).toHaveClass('visually-hidden');
    expect(alert).toHaveClass('visually-hidden');
    expect(status).not.toHaveAttribute('style');
    expect(alert).not.toHaveAttribute('style');
  });

  it('announces polite and assertive messages after swap delay and clears after timeout', () => {
    render(
      <LiveRegion>
        <AnnounceHarness />
      </LiveRegion>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Assertive' }).click();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('');

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Critical failure');

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('');
  });
});
