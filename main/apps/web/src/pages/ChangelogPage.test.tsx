// main/apps/web/src/pages/ChangelogPage.test.tsx
import { MemoryRouter } from '@bslt/react/router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChangelogPage } from './ChangelogPage';

describe('ChangelogPage', () => {
  it('renders starter-owned release history with brand heading and action links', () => {
    render(
      <MemoryRouter>
        <ChangelogPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /BSLT Changelog/i })).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Unified SaaS Starter Platform')).toBeInTheDocument();
    expect(screen.getByText('foundation-v1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'System status' })).toHaveAttribute('href', '/status');
  });
});
