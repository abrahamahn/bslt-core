// main/apps/web/src/pages/LandingPage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LandingPage } from './LandingPage';

import type { ReactElement, ReactNode } from 'react';

const authState = vi.hoisted(() => ({ isAuthenticated: false }));

vi.mock('@bslt/react/router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }): ReactElement => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useAuth: () => authState,
  };
});

describe('LandingPage', () => {
  it('shows guest calls-to-action when signed out', () => {
    authState.isAuthenticated = false;
    render(<LandingPage />);

    const getStarted = screen.getByRole('link', { name: 'Get started' });
    expect(getStarted).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('points authenticated visitors at the dashboard and hides Sign in', () => {
    authState.isAuthenticated = true;
    render(<LandingPage />);

    expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('renders the capability cards', () => {
    authState.isAuthenticated = false;
    render(<LandingPage />);

    expect(
      screen.getByRole('heading', { name: 'Accounts, passkeys & OIDC SSO' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Multi-tenant workspaces & boards' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zero-dep AI SSE streaming' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Billing, seats & entitlements' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Blog, waitlist, referrals & OpenAPI' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Owned stack & live bilingual UI' }),
    ).toBeInTheDocument();
  });
});
