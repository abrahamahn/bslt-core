// main/apps/web/src/pages/PublicLandingPage.test.tsx
import { MemoryRouter } from '@bslt/react/router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LandingPageContent, PublicLandingPage } from './PublicLandingPage';

describe('PublicLandingPage', () => {
  it('renders unauthenticated registration and sign-in calls to action without auth context', () => {
    render(
      <MemoryRouter>
        <PublicLandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Open dashboard' })).not.toBeInTheDocument();
  });

  it('switches the primary CTA to dashboard and omits sign-in when authenticated', () => {
    render(
      <MemoryRouter>
        <LandingPageContent isAuthenticated={true} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
