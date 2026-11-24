// main/apps/web/src/app/dashboard/DashboardPage.test.tsx
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockEnvironment, mockUser, renderWithProviders } from '../../__tests__/utils';
import { hasFilesModule, installedModules } from '../../generated/modules';
import { I18nProvider } from '../../i18n';
import { TIMEZONE_STORAGE_KEY } from '../../i18n/format';

import { DashboardPage } from './DashboardPage';

import type { RenderWithProvidersResult } from '../../__tests__/utils';
import type { User } from '@bslt/identity/contract';

const mockNavigate = vi.fn();
const mockUseProfileCompleteness = vi.hoisted(() => vi.fn());
const mockUseSessions = vi.hoisted(() => vi.fn());

vi.mock('@bslt/react/router', async () => {
  const actual = await vi.importActual('@bslt/react/router');
  return {
    ...actual,
    useNavigate: (): typeof mockNavigate => mockNavigate,
  };
});

vi.mock('../../generated/modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/modules')>();
  return {
    ...actual,
    useOptionalMyAvatar: () => ({
      avatarUrl: null,
      fileId: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
    useOptionalActiveOrg: () => ({ activeOrgId: 'org-1', setActiveOrg: vi.fn() }),
    useOptionalOrganizations: (options?: { enabled?: boolean }) => ({
      organizations:
        options?.enabled === true
          ? [{ id: 'org-1', name: 'Acme Studio', slug: 'acme-studio', role: 'owner' }]
          : [],
      isLoading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    }),
    useOptionalSubscription: () => ({
      subscription: null,
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useProfileCompleteness: mockUseProfileCompleteness,
    useSessions: mockUseSessions,
  };
});

describe('DashboardPage', () => {
  const renderDashboardPage = (options?: {
    user?: User;
    isLoading?: boolean;
    isAuthenticated?: boolean;
  }): RenderWithProvidersResult => {
    const environment = createMockEnvironment({
      user: options?.user ?? mockUser,
      isLoading: options?.isLoading ?? false,
      isAuthenticated: options?.isAuthenticated ?? options?.user !== undefined,
    });

    return renderWithProviders(
      <I18nProvider initialLocale="en-US">
        <DashboardPage />
      </I18nProvider>,
      { environment },
    );
  };

  beforeEach((): void => {
    vi.clearAllMocks();
    mockUseProfileCompleteness.mockReturnValue({
      data: { percentage: 86, missingFields: ['avatar'] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseSessions.mockReturnValue({
      sessions: [
        {
          id: 'session-1',
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: '2026-06-01T00:00:00Z',
          lastUsedAt: '2026-05-20T00:00:00Z',
          device: 'Laptop',
          ipAddress: '127.0.0.1',
          userAgent: 'Test browser',
          isCurrent: true,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    window.localStorage.removeItem(TIMEZONE_STORAGE_KEY);
    window.localStorage.clear();
  });

  it('formats the current session date via the locale-aware formatter', () => {
    window.localStorage.setItem(TIMEZONE_STORAGE_KEY, 'UTC');
    renderDashboardPage();

    // lastUsedAt 2026-05-20T00:00:00Z rendered with the stored UTC preference.
    expect(screen.getByText(/Current session last used May 20\./)).toBeInTheDocument();
  });

  it('renders the starter dashboard shell', () => {
    renderDashboardPage();

    expect(screen.getByRole('heading', { name: /dashboard/i, level: 1 })).toBeInTheDocument();
    if (installedModules.some((m) => m.id === 'tasks')) {
      expect(screen.getAllByRole('link', { name: /tasks/i })[0]).toHaveAttribute('href', '/tasks');
    }
    if (hasFilesModule) {
      expect(screen.getAllByRole('link', { name: /files/i })[0]).toHaveAttribute('href', '/files');
    }
    expect(screen.getAllByRole('link', { name: /profile/i })[0]).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getAllByRole('link', { name: /settings/i })[0]).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('renders account, session, and installed module surfaces', () => {
    renderDashboardPage();

    expect(screen.getByRole('heading', { name: /account/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /security & shortcuts/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage sessions/i })).toHaveAttribute(
      'href',
      '/settings/sessions',
    );
    expect(screen.getByText(/test@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Test User/)).toBeInTheDocument();
    expect(screen.getByText(/@testuser/)).toBeInTheDocument();
    expect(screen.getByText(/user-123/i)).toBeInTheDocument();
    expect(screen.getByText(/1 session/i)).toBeInTheDocument();
    if (installedModules.some((m) => m.id === 'tasks')) {
      expect(screen.getByText(/personal task tracking/i)).toBeInTheDocument();
    }
    if (hasFilesModule) {
      expect(screen.getByText(/signed downloads/i)).toBeInTheDocument();
    }
  });

  it('does not render billing or activity feed surfaces by default', () => {
    renderDashboardPage();

    expect(screen.queryByRole('heading', { name: /billing surface/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /recent activity/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /billing/i })).toBeNull();
  });

  it('falls back to Not provided when user names are missing', () => {
    renderDashboardPage({
      user: {
        ...mockUser,
        firstName: undefined as unknown as string,
        lastName: undefined as unknown as string,
      },
    });

    expect(screen.getByText(/Not provided/)).toBeInTheDocument();
  });

  it('does not render a logout quick action (logout lives in the header)', () => {
    renderDashboardPage();

    expect(screen.queryByRole('button', { name: /logout/i })).toBeNull();
  });

  it('handles missing user state without crashing', () => {
    expect(() =>
      renderDashboardPage({
        isAuthenticated: false,
      }),
    ).not.toThrow();
  });

  it('escapes special characters in profile names', () => {
    renderDashboardPage({
      user: {
        ...mockUser,
        firstName: '<script>alert("xss")</script>',
      },
    });

    expect(screen.getByText(/<script>alert\("xss"\)<\/script> User/)).toBeInTheDocument();
  });

  it('handles unicode profile names', () => {
    renderDashboardPage({
      user: {
        ...mockUser,
        firstName: '用户名',
        lastName: '🎉',
      },
    });

    expect(screen.getByText(/用户名 🎉/)).toBeInTheDocument();
  });

  it('handles an empty user id', () => {
    expect(() =>
      renderDashboardPage({
        user: {
          ...mockUser,
          id: '' as unknown as User['id'],
        },
      }),
    ).not.toThrow();
  });

  it('handles rapid re-renders', () => {
    const { rerender } = renderDashboardPage();

    for (let i = 0; i < 100; i++) {
      rerender(
        <I18nProvider initialLocale="en-US">
          <DashboardPage />
        </I18nProvider>,
      );
    }

    expect(screen.getByRole('heading', { name: /dashboard/i, level: 1 })).toBeInTheDocument();
  });

  it('shows active workspace badge, Free plan badge, Upgrade CTA, and dismissible setup checklist when flags are enabled', () => {
    const environment = createMockEnvironment({ user: mockUser, isAuthenticated: true });
    renderWithProviders(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'orgs.teams': true, 'flags.billing': true },
        }}
      >
        <I18nProvider initialLocale="en-US">
          <DashboardPage />
        </I18nProvider>
      </CapabilityProvider>,
      { environment },
    );

    if (installedModules.some((m) => m.id === 'orgs')) {
      expect(screen.getAllByText('Acme Studio').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('link', { name: 'Manage workspace' })).toHaveAttribute(
        'href',
        '/workspace',
      );
    }
    if (installedModules.some((m) => m.id === 'billing')) {
      expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('link', { name: 'Upgrade plan' })).toHaveAttribute(
        'href',
        '/pricing',
      );
      expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
        'href',
        '/pricing',
      );
    }
    expect(screen.getByRole('heading', { name: 'Workspace Setup Checklist' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('heading', { name: 'Workspace Setup Checklist' })).toBeNull();
  });
});
