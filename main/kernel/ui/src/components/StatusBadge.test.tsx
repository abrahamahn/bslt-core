// main/kernel/ui/src/components/StatusBadge.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders a tone-driven badge from label prop', () => {
    render(<StatusBadge tone="success" label="Operational" />);
    expect(screen.getByText('Operational')).toBeInTheDocument();
  });

  it('renders danger and warning tones cleanly', () => {
    const { rerender } = render(<StatusBadge tone="danger" label="Suspended" />);
    expect(screen.getByText('Suspended')).toBeInTheDocument();

    rerender(<StatusBadge tone="warning" label="Degraded" />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders empty content safely when neither label nor children is provided', () => {
    const { container } = render(<StatusBadge tone="info" />);
    expect(container.querySelector('.badge')).toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('prefers explicit label over children when both are passed', () => {
    render(
      <StatusBadge tone="info" label="Explicit">
        Fallback
      </StatusBadge>,
    );
    expect(screen.getByText('Explicit')).toBeInTheDocument();
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument();
  });
});
