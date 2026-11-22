// main/kernel/ui/src/components/AsyncBoundary.test.tsx
/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AsyncBoundary } from './AsyncBoundary';

function ThrowingChild({ shouldThrow }: { readonly shouldThrow: boolean }): ReactElement {
  if (shouldThrow) {
    throw new Error('Boom inside section');
  }
  return <div>Recovered section</div>;
}

describe('AsyncBoundary', () => {
  it('renders children when neither loading nor errored', () => {
    render(
      <AsyncBoundary>
        <div>Loaded content</div>
      </AsyncBoundary>,
    );

    expect(screen.getByText('Loaded content')).toBeInTheDocument();
  });

  it('renders spinner and default loading text when isLoading is true', () => {
    render(<AsyncBoundary isLoading size="lg" className="custom-loader" />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveStyle({ '--ui-spinner-size': '2rem' });
    expect(document.querySelector('.loading-container')).toHaveClass('custom-loader');
  });

  it('omits loading text when loadingText is empty string', () => {
    render(<AsyncBoundary isLoading loadingText="" size="sm" />);

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveStyle({ '--ui-spinner-size': '1rem' });
  });

  it('renders card-wrapped custom loadingFallback and errorFallback when variant="card"', () => {
    const { rerender, container } = render(
      <AsyncBoundary variant="card" isLoading loadingFallback={<div>Skeleton placeholder</div>} />,
    );

    expect(container.querySelector('.card')).toBeInTheDocument();
    expect(screen.getByText('Skeleton placeholder')).toBeInTheDocument();

    rerender(
      <AsyncBoundary
        variant="card"
        errorMessage="Request timed out"
        errorFallback={<div>Custom error card</div>}
      />,
    );

    expect(container.querySelector('.card')).toBeInTheDocument();
    expect(screen.getByText('Custom error card')).toBeInTheDocument();
  });

  it('renders default danger Alert for errorMessage and invokes onRetry when provided', () => {
    const onRetry = vi.fn();
    render(
      <AsyncBoundary
        variant="card"
        errorMessage="Failed to load metrics"
        onRetry={onRetry}
        retryLabel="Reload"
      />,
    );

    expect(screen.getByText('Failed to load metrics')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('catches thrown render errors via ErrorBoundary and recovers on retry', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    function DynamicChild(): ReactElement {
      return <ThrowingChild shouldThrow={shouldThrow} />;
    }

    render(
      <AsyncBoundary errorTitle="Section crashed" retryLabel="Retry section">
        <DynamicChild />
      </AsyncBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Section crashed')).toBeInTheDocument();
    expect(screen.getByText('Boom inside section')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry section' }));
    expect(screen.getByText('Recovered section')).toBeInTheDocument();

    spy.mockRestore();
  });

  it('returns null when children are omitted and no loading or error state is active', () => {
    const { container } = render(
      <Suspense fallback={null}>
        <AsyncBoundary suspense />
      </Suspense>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
