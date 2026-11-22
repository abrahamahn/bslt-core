// main/kernel/ui/src/components/DelayedFallback.test.tsx
/**
 * Tests for DelayedFallback component.
 *
 * Tests delayed rendering of loading states to prevent flashes.
 */

import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DelayedFallback } from './DelayedFallback';

import type { ReactElement } from 'react';

function advanceDelay(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('DelayedFallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('delay behavior', () => {
    it('should not render immediately', () => {
      render(<DelayedFallback />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('should render after default delay', () => {
      render(<DelayedFallback />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      advanceDelay(149);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      advanceDelay(1);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should render after custom delay', () => {
      render(<DelayedFallback delay={50} />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      advanceDelay(49);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      advanceDelay(1);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should not render if delay is very long', () => {
      const { unmount } = render(<DelayedFallback delay={10000} />);

      advanceDelay(100);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      unmount();
    });
  });

  describe('default fallback', () => {
    it('should render AsyncBoundary spinner by default', () => {
      render(<DelayedFallback delay={10} />);

      advanceDelay(10);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should render with custom text', () => {
      render(<DelayedFallback delay={10} text="Loading data..." />);

      advanceDelay(10);
      expect(screen.getByText('Loading data...')).toBeInTheDocument();
    });

    it('should render with custom size', () => {
      render(<DelayedFallback delay={10} size="lg" />);

      advanceDelay(10);
      const spinner = screen.getByRole('status');
      expect(spinner).toHaveClass('spinner');
      expect(spinner).toHaveStyle({ '--ui-spinner-size': '2rem' });
    });

    it('should render with small size', () => {
      render(<DelayedFallback delay={10} size="sm" />);

      advanceDelay(10);
      const spinner = screen.getByRole('status');
      expect(spinner).toHaveClass('spinner');
      expect(spinner).toHaveStyle({ '--ui-spinner-size': '1rem' });
    });
  });

  describe('custom fallback', () => {
    it('should render custom children instead of default', () => {
      render(
        <DelayedFallback delay={10}>
          <div>Custom loading...</div>
        </DelayedFallback>,
      );

      advanceDelay(10);
      expect(screen.getByText('Custom loading...')).toBeInTheDocument();
    });

    it('should render complex custom content', () => {
      render(
        <DelayedFallback delay={10}>
          <div>
            <h2>Loading</h2>
            <p>Please wait...</p>
          </div>
        </DelayedFallback>,
      );

      advanceDelay(10);
      expect(screen.getByText('Loading')).toBeInTheDocument();
      expect(screen.getByText('Please wait...')).toBeInTheDocument();
    });

    it('should render custom skeleton', () => {
      render(
        <DelayedFallback delay={10}>
          <div className="skeleton-box" data-testid="skeleton" />
        </DelayedFallback>,
      );

      advanceDelay(10);
      expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle delay of 0', () => {
      render(<DelayedFallback delay={0} />);

      advanceDelay(0);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should handle empty string text', () => {
      render(<DelayedFallback delay={10} text="" />);

      advanceDelay(10);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should not crash with null children', () => {
      render(<DelayedFallback delay={10}>{null}</DelayedFallback>);

      // Should render default fallback
      advanceDelay(10);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should not crash with undefined children', () => {
      render(<DelayedFallback delay={10}>{undefined}</DelayedFallback>);

      // Should render default fallback
      advanceDelay(10);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('cleanup', () => {
    it('should cleanup timer on unmount before delay', () => {
      const { unmount } = render(<DelayedFallback delay={1000} />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      unmount();

      advanceDelay(1000);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('should cleanup timer on unmount after delay', () => {
      const { unmount } = render(<DelayedFallback delay={10} />);

      advanceDelay(10);
      expect(screen.getByRole('status')).toBeInTheDocument();

      unmount();

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('Suspense integration', () => {
    it('should work as Suspense fallback', () => {
      const LazyComponent = (): ReactElement => <div>Loaded!</div>;

      render(
        <Suspense fallback={<DelayedFallback delay={10} />}>
          <LazyComponent />
        </Suspense>,
      );

      // Component loads immediately in test, so we should see it
      expect(screen.getByText('Loaded!')).toBeInTheDocument();
    });
  });
});
