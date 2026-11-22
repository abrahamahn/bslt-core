// main/kernel/ui/src/components/FeatureHint.test.tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { FeatureHint } from './FeatureHint';

const renderTwoHints = (): ReturnType<typeof render> =>
  render(
    <>
      <FeatureHint featureKey="alpha" title="Alpha hint" description="First feature">
        <span>Alpha anchor</span>
      </FeatureHint>
      <FeatureHint featureKey="beta" title="Beta hint" description="Second feature">
        <span>Beta anchor</span>
      </FeatureHint>
    </>,
  );

describe('FeatureHint', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the callout with title, description, and dismiss button', () => {
    render(
      <FeatureHint featureKey="alpha" title="Alpha hint" description="First feature">
        <span>Alpha anchor</span>
      </FeatureHint>,
    );

    expect(screen.getByText('Alpha hint')).toBeInTheDocument();
    expect(screen.getByText('First feature')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('shows only one callout at a time when multiple hints mount', () => {
    renderTwoHints();

    expect(screen.getByText('Alpha hint')).toBeInTheDocument();
    expect(screen.queryByText('Beta hint')).not.toBeInTheDocument();
  });

  it('reveals the next hint after the current one is dismissed', async () => {
    const user = userEvent.setup();
    renderTwoHints();

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByText('Alpha hint')).not.toBeInTheDocument();
    expect(screen.getByText('Beta hint')).toBeInTheDocument();
  });

  it('persists dismissal so a dismissed hint never re-renders', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTwoHints();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    // localStorage write is deferred to a microtask
    await Promise.resolve();
    unmount();
    renderTwoHints();

    expect(screen.queryByText('Alpha hint')).not.toBeInTheDocument();
    expect(screen.getByText('Beta hint')).toBeInTheDocument();
  });

  it('dismisses only the visible hint on Escape', async () => {
    const user = userEvent.setup();
    renderTwoHints();

    await user.keyboard('{Escape}');

    expect(screen.queryByText('Alpha hint')).not.toBeInTheDocument();
    expect(screen.getByText('Beta hint')).toBeInTheDocument();
  });

  it('always renders its children regardless of hint state', async () => {
    const user = userEvent.setup();
    renderTwoHints();

    expect(screen.getByText('Alpha anchor')).toBeInTheDocument();
    expect(screen.getByText('Beta anchor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.getByText('Alpha anchor')).toBeInTheDocument();
    expect(screen.getByText('Beta anchor')).toBeInTheDocument();
  });
});
