// main/apps/web/src/app/shells/PrimaryNavMenu.test.tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  createMockEnvironment,
  mockAdminUser,
  mockUser,
  renderWithProviders,
} from '../../__tests__/utils';

import { MobilePrimaryBar, PrimaryNavMenu } from './PrimaryNavMenu';

describe('PrimaryNavMenu & MobilePrimaryBar', () => {
  it('renders loading skeleton while auth is resolving and omits premature nav links', () => {
    const environment = createMockEnvironment({ isAuthenticated: false, isLoading: true });
    renderWithProviders(<PrimaryNavMenu />, { environment });

    expect(screen.getByLabelText('Loading navigation')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders signed-in product links without Admin for non-admin users and marks active route', () => {
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    renderWithProviders(<PrimaryNavMenu />, { environment, route: '/activities' });

    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(nav.getByRole('link', { name: 'Activities' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(nav.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(nav.queryByRole('link', { name: 'Home' })).toBeNull();
  });

  it('marks Settings active when visiting /profile so sidebar stays deduplicated', () => {
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    renderWithProviders(<PrimaryNavMenu />, { environment, route: '/profile' });

    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(nav.queryByRole('link', { name: 'Profile' })).toBeNull();
  });

  it('renders MobilePrimaryBar from app.primary links and includes Admin for admin users', () => {
    const environment = createMockEnvironment({ user: mockAdminUser, isAuthenticated: true });
    renderWithProviders(<MobilePrimaryBar />, { environment, route: '/dashboard' });

    const mobileNav = within(screen.getByRole('navigation', { name: 'Mobile primary' }));
    expect(mobileNav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(mobileNav.queryByRole('link', { name: 'Home' })).toBeNull();
  });
});
