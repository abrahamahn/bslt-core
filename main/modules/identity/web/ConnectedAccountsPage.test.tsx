// main/modules/identity/web/ConnectedAccountsPage.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectedAccountsPage } from './ConnectedAccountsPage';

const hooks = vi.hoisted(() => ({
  useEnabledOAuthProviders: vi.fn(),
  useOAuthConnections: vi.fn(),
}));

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useEnabledOAuthProviders: hooks.useEnabledOAuthProviders,
    useOAuthConnections: hooks.useOAuthConnections,
  };
});

afterEach(() => {
  window.localStorage.removeItem('abe-timezone-preference');
  cleanup();
  vi.clearAllMocks();
});

describe('ConnectedAccountsPage', () => {
  beforeEach(() => {
    hooks.useEnabledOAuthProviders.mockReturnValue({
      providers: [],
      isLoading: false,
      error: null,
    });
    hooks.useOAuthConnections.mockReturnValue({
      connections: [],
      isLoading: false,
      isActing: false,
      link: vi.fn().mockResolvedValue('http://example.com/oauth/link'),
      unlink: vi.fn(),
      refresh: vi.fn(),
      error: null,
    });
  });

  it('shows empty state when no OAuth providers are enabled', () => {
    render(<ConnectedAccountsPage />);
    expect(screen.getByRole('heading', { name: /Connected Accounts/i })).toBeInTheDocument();
    expect(screen.getByText(/No OAuth providers are currently enabled/i)).toBeInTheDocument();
  });

  it('disables Disconnect when only 1 connection exists and surfaces link failure', async () => {
    window.localStorage.setItem('abe-timezone-preference', 'UTC');
    const linkMock = vi.fn().mockRejectedValueOnce(new Error('OAuth link failed'));
    hooks.useEnabledOAuthProviders.mockReturnValue({
      providers: ['google', 'github'],
      isLoading: false,
      error: null,
    });
    hooks.useOAuthConnections.mockReturnValue({
      connections: [
        {
          id: 'conn-1',
          provider: 'google',
          providerEmail: 'user@gmail.com',
          connectedAt: '2024-03-15T12:00:00.000Z',
        },
      ],
      isLoading: false,
      isActing: false,
      link: linkMock,
      unlink: vi.fn(),
      refresh: vi.fn(),
      error: null,
    });

    render(<ConnectedAccountsPage />);
    expect(screen.getByText(/Since Mar 15, 2024/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => {
      expect(screen.getByText('OAuth link failed')).toBeInTheDocument();
    });
  });
});
