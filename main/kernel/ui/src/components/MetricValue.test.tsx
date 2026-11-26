// main/kernel/ui/src/components/MetricValue.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetricValue } from './MetricValue';

describe('MetricValue', () => {
  it('renders loading state, raw values, and locale-formatted numeric values', () => {
    const { rerender, container } = render(
      <MetricValue label="Active Users" value={1250} isLoading />,
    );
    expect(screen.queryByText('Active Users')).toBeNull();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(2);

    rerender(<MetricValue label="Active Users" value={1250} formatNumber />);
    expect(screen.getByText('Active Users')).toBeInTheDocument();
    expect(screen.getByText((1250).toLocaleString())).toBeInTheDocument();

    rerender(<MetricValue label="Status" value="Healthy" />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });
});
