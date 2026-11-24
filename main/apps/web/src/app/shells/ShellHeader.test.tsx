// main/apps/web/src/app/shells/ShellHeader.test.tsx
import { openAuthModal } from '@bslt/identity/web';
import { toastStore } from '@bslt/react';
import { useLocation } from '@bslt/react/router';
import { EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createMockEnvironment,
  mockAdminUser,
  mockUser,
  renderWithProviders,
} from '../../__tests__/utils';
import { hasSearchModule } from '../../generated/modules';

import { ShellHeader } from './ShellHeader';

import type { ReactElement } from 'react';

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    openAuthModal: vi.fn(),
  };
});

describe('ShellHeader', () => {
  it('renders skeletons while auth is loading and omits Login/Register and Account menu', () => {
    const environment = createMockEnvironment({ isAuthenticated: false, isLoading: true });
    renderWithProviders(<ShellHeader variant="app" />, { environment });

    expect(screen.getByTestId('app-top-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^login$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^register$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
  });

  it('renders Login and Register actions when signed out and opens AuthModal in each mode', () => {
    const environment = createMockEnvironment({ isAuthenticated: false, isLoading: false });
    renderWithProviders(<ShellHeader variant="public" />, { environment });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^login$/i }));
    expect(openAuthModal).toHaveBeenCalledWith('login');

    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));
    expect(openAuthModal).toHaveBeenCalledWith('register');
  });

  it('exposes workspace search when installed, exposes the command palette button, and never renders a duplicate h1', () => {
    const memberEnv = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    const first = renderWithProviders(<ShellHeader variant="app" />, { environment: memberEnv });
    if (hasSearchModule) {
      expect(screen.getByRole('search', { name: 'Site search' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('search')).toBeNull();
    }
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('button', { name: /jump to/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    first.unmount();

    const adminEnv = createMockEnvironment({
      user: mockAdminUser,
      isAuthenticated: true,
      capabilities: EMPTY_CAPABILITY_CONTEXT,
    });
    renderWithProviders(<ShellHeader variant="console" />, {
      environment: adminEnv,
      route: '/admin',
    });
    if (hasSearchModule) {
      const searchForm = screen.getByRole('search', { name: 'Site search' });
      fireEvent.submit(searchForm);
      expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
    }
  });

  it('navigates directly to /profile and /settings/security from the account menu without modals', () => {
    const LocationEcho = (): ReactElement => {
      const { pathname } = useLocation();
      return <output data-testid="current-path">{pathname}</output>;
    };
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    renderWithProviders(
      <>
        <ShellHeader variant="app" />
        <LocationEcho />
      </>,
      { environment, route: '/dashboard' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByText('Profile'));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/profile');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/settings/security');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('surfaces a failure toast when logout rejects', async () => {
    const showSpy = vi.spyOn(toastStore.getState(), 'show');
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    vi.spyOn(environment.auth, 'logout').mockRejectedValueOnce(new Error('Network down'));

    renderWithProviders(<ShellHeader variant="app" />, { environment });

    const accountMenuTrigger = screen.getByRole('button', { name: 'Account menu' });
    expect(accountMenuTrigger.textContent).toBe('');
    expect(accountMenuTrigger.querySelector('[data-initials]')).not.toBeNull();

    fireEvent.click(accountMenuTrigger);
    fireEvent.click(screen.getByText('Log out'));

    await waitFor(() => {
      expect(showSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Logout failed',
          description: 'Network down',
        }),
      );
    });
    showSpy.mockRestore();
  });
});
