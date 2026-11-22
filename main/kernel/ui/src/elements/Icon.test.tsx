// main/kernel/ui/src/elements/Icon.test.tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';
import { IconButton } from './IconButton';

describe('Icon', () => {
  it('renders decorative icon as aria-hidden="true" when no label is supplied', () => {
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('renders semantic icon with role="img" and aria-label when label is supplied', () => {
    render(<Icon name="lock" label="Access restricted" />);
    const img = screen.getByRole('img', { name: 'Access restricted' });
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  it('ignores whitespace-only labels and keeps decorative aria-hidden="true"', () => {
    const { container } = render(<Icon name="close" label="   " />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('applies sm/md/lg size classes and multi-color OAuth paths accurately', () => {
    const { container, rerender } = render(<Icon name="oauth-google" size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('ui-icon', 'icon-lg');
    expect(svg?.querySelectorAll('path').length).toBe(4);

    rerender(<Icon name="close" size="sm" />);
    expect(container.querySelector('svg')).toHaveClass('ui-icon', 'icon-sm');
  });

  it('integrates with IconButton icon slot when children are omitted', () => {
    render(<IconButton icon="close" aria-label="Dismiss panel" />);
    const button = screen.getByRole('button', { name: 'Dismiss panel' });
    expect(button.querySelector('svg')).toBeInTheDocument();
  });
});
