// main/kernel/ui/src/elements/Toaster.test.tsx
/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from './Toaster';

describe('Toaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('positioning and live region', () => {
    it.each(['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const)(
      'renders with toaster class and data-position="%s"',
      (position) => {
        const { container } = render(
          <Toaster messages={[]} onDismiss={vi.fn()} position={position} />,
        );

        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper).toHaveClass('toaster');
        expect(wrapper).toHaveAttribute('data-position', position);
        const liveRegion = container.querySelector('.toast');
        expect(liveRegion).toHaveAttribute('aria-live', 'polite');
        expect(liveRegion).toHaveAttribute('aria-relevant', 'additions');
      },
    );

    it('defaults to top-right when position is omitted', () => {
      const { container } = render(<Toaster messages={[]} onDismiss={vi.fn()} />);
      expect(container.firstChild).toHaveAttribute('data-position', 'top-right');
    });
  });

  describe('messages, tones, actions, and dismissal', () => {
    it('renders title, description, tones, and SVG close icon on dismiss button', () => {
      const onDismiss = vi.fn();
      const { container } = render(
        <Toaster
          messages={[
            { id: '1', title: 'Saved', description: 'Changes stored', tone: 'success' },
            { id: '2', title: 'Error', tone: 'danger' },
            { id: '3', title: 'Default info' },
          ]}
          onDismiss={onDismiss}
        />,
      );

      expect(screen.getByText('Saved')).toBeInTheDocument();
      expect(screen.getByText('Changes stored')).toBeInTheDocument();
      const cards = container.querySelectorAll('.toast-card');
      expect(cards[0]).toHaveAttribute('data-tone', 'success');
      expect(cards[1]).toHaveAttribute('data-tone', 'danger');
      expect(cards[2]).toHaveAttribute('data-tone', 'info');

      const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss notification' });
      expect(dismissButtons[0]?.querySelector('svg.ui-icon')).not.toBeNull();
      fireEvent.click(dismissButtons[0]!);
      expect(onDismiss).toHaveBeenCalledWith('1');
    });

    it('auto-dismisses after default 3500ms duration and cleans up timer on unmount', () => {
      const onDismiss = vi.fn();
      const { unmount } = render(
        <Toaster messages={[{ id: 'toast-1', title: 'Auto' }]} onDismiss={onDismiss} />,
      );

      act(() => {
        vi.advanceTimersByTime(3499);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onDismiss).toHaveBeenCalledWith('toast-1');

      onDismiss.mockClear();
      unmount();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('invokes action callback when action button is clicked and omits action button when absent', () => {
      const onAction = vi.fn();
      render(
        <Toaster
          messages={[
            { id: '1', title: 'Archived', action: { label: 'Undo', onClick: onAction } },
            { id: '2', title: 'Plain toast' },
          ]}
          onDismiss={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });
});
