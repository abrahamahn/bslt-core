// main/kernel/ui/src/components/LabeledValueRow.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LabeledValueRow } from './LabeledValueRow';

describe('LabeledValueRow', () => {
  it('renders loading skeletons, dash fallbacks for missing values, and formatted values', () => {
    const { rerender, container } = render(
      <LabeledValueRow label="Email" value="ada@acme.dev" isLoading />,
    );
    expect(screen.queryByText('Email')).toBeNull();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(2);

    rerender(<LabeledValueRow label="Phone" value={null} />);
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();

    rerender(<LabeledValueRow label="Seats" value={12} valueSize="md" />);
    expect(screen.getByText('12')).toBeInTheDocument();

    rerender(
      <LabeledValueRow
        label="Badge"
        value={<span data-testid="custom-node">Active</span>}
        preserveValueElement={false}
      />,
    );
    expect(screen.getByTestId('custom-node')).toHaveTextContent('Active');
  });
});
