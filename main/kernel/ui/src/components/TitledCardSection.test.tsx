// main/kernel/ui/src/components/TitledCardSection.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TitledCardSection } from './TitledCardSection';

describe('TitledCardSection', () => {
  it('renders the configured heading level, title, and body content inside a card', () => {
    render(
      <TitledCardSection title="Workspace Billing" headingAs="h2" headingSize="lg">
        <p>Current plan: Pro</p>
      </TitledCardSection>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Workspace Billing' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Current plan: Pro')).toBeInTheDocument();
  });
});
