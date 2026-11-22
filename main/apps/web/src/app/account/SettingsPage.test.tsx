// main/apps/web/src/app/account/SettingsPage.test.tsx
import { serializeCapabilityContext } from '@bslt/contract';
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule } from '../../generated/modules';

import { SettingsLayout } from './SettingsLayout';
import { ProfilePage, SettingsPage } from './SettingsPage';

import type { ReactElement } from 'react';

const { mockNavigate, mockLocation, mockAuthState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/settings', search: '', hash: '' },
  mockAuthState: {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      username: 'user1',
      firstName: 'Test',
      lastName: 'User',
      role: 'user',
      updatedAt: '2026-01-01T00:00:00Z',
    } as Record<string, unknown> | null,
    reloadUser: vi.fn(),
  },
}));

vi.mock('@bslt/react/router', () => ({
  Outlet: (): ReactElement => <div data-testid="settings-route-outlet" />,
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock('#app/app/authToken', () => ({
  getAccessToken: vi.fn(() => 'token'),
}));

const stubSection = vi.hoisted(() => (name: string) => {
  function StubSection(): ReactElement {
    return <div data-testid={`section-${name}`} />;
  }
  return StubSection;
});

vi.mock('../../generated/modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/modules')>();
  return {
    ...actual,
    hasFilesModule: true,
    OptionalAvatarUpload: (): ReactElement => <div data-testid="section-avatar" />,
    OptionalNotificationPreferencesForm: stubSection('notifications'),
  };
});

vi.mock('@bslt/compliance/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/compliance/web')>();
  return {
    ...actual,
    DataControlsSection: stubSection('data-controls'),
    LegalDocumentsSection: stubSection('legal'),
  };
});

vi.mock('@bslt/identity/web', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/identity/web')>();
  return {
    ...actual,
    useAuth: () => mockAuthState,
    ApiKeysSection: stubSection('api-keys'),
    BackupCodesDisplay: stubSection('backup-codes'),
    DangerZone: stubSection('danger-zone'),
    DevicesList: stubSection('devices'),
    EmailChangeForm: stubSection('email-change'),
    ForgotPasswordShortcut: stubSection('forgot-password'),
    OAuthConnectionsList: stubSection('oauth'),
    PasskeyManagement: stubSection('passkeys'),
    PasswordChangeForm: stubSection('password-change'),
    PasswordSetupForm: stubSection('password-setup'),
    PhoneManagement: stubSection('phone'),
    ProfileCompleteness: stubSection('completeness'),
    ProfileForm: stubSection('profile-form'),
    SessionsList: stubSection('sessions'),
    TotpManagement: stubSection('totp'),
    UsernameForm: stubSection('username'),
  };
});

vi.mock('#app/app/ClientEnvironment', () => ({
  useClientEnvironment: () => ({
    auth: { fetchCurrentUser: vi.fn().mockResolvedValue(undefined) },
    config: { apiUrl: '' },
    queryCache: { invalidateQuery: vi.fn() },
  }),
}));

vi.mock('./PreferencesSection', () => ({
  PreferencesSection: stubSection('preferences'),
}));

beforeEach(() => {
  mockNavigate.mockClear();
  mockLocation.pathname = '/settings';
  mockLocation.search = '';
  mockLocation.hash = '';
  mockAuthState.user = {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user1',
    firstName: 'Test',
    lastName: 'User',
    role: 'user',
    updatedAt: '2026-01-01T00:00:00Z',
  };
});

describe('SettingsPage and ProfilePage', () => {
  it('renders a full page inside SettingsLayout without any modal dialog chrome', () => {
    render(<SettingsPage />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('data-active-tab')).toBe('profile');
    expect(screen.getByTestId('section-profile-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('renders a loading skeleton when user is null instead of crashing', () => {
    mockAuthState.user = null;
    render(<SettingsPage />);

    expect(screen.getByLabelText('Loading settings')).toBeInTheDocument();
    expect(screen.queryByTestId('section-profile-form')).toBeNull();
  });

  it('resolves ?tab=, path segments, and aliases to the matching section', () => {
    mockLocation.search = '?tab=security';
    const first = render(<SettingsPage />);
    expect(screen.getByRole('tabpanel').getAttribute('data-active-tab')).toBe('security');
    expect(screen.getByTestId('section-password-change')).toBeInTheDocument();
    expect(screen.queryByTestId('section-passkeys')).toBeNull();
    first.unmount();

    mockLocation.search = '';
    mockLocation.pathname = '/settings/privacy';
    render(<SettingsPage />);
    expect(screen.getByRole('tabpanel').getAttribute('data-active-tab')).toBe('data-controls');
    expect(screen.getByTestId('section-data-controls')).toBeInTheDocument();
  });

  it('navigates to canonical /settings/:section URLs when switching sections', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    expect(mockNavigate).toHaveBeenCalledWith('/settings/sessions');
  });

  it('does not navigate away when Escape is pressed on a settings page', () => {
    render(<SettingsPage />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('section-profile-form')).toBeInTheDocument();
  });

  it('omits the billing nav item when billing is disabled', () => {
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
  });

  it.runIf(hasBillingModule)(
    'shows billing when enabled and navigates to /settings/billing when clicked',
    () => {
      render(
        <CapabilityProvider
          initialContext={{
            ...EMPTY_CAPABILITY_CONTEXT,
            flags: { 'flags.billing': true },
          }}
        >
          <SettingsPage />
        </CapabilityProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
      expect(mockNavigate).toHaveBeenCalledWith('/settings/billing');
    },
  );

  it.runIf(hasBillingModule)('redirects tab=billing to /settings/billing when enabled', () => {
    mockLocation.search = '?tab=billing';
    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'flags.billing': true },
        }}
      >
        <SettingsPage />
      </CapabilityProvider>,
    );
    expect(mockNavigate).toHaveBeenCalledWith('/settings/billing', { replace: true });
    expect(screen.queryByTestId('section-profile-form')).toBeNull();
  });

  it.runIf(hasBillingModule)(
    'redirects tab=billing back to /settings when billing is disabled',
    () => {
      mockLocation.search = '?tab=billing';
      render(<SettingsPage />);
      expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
    },
  );

  it.runIf(hasBillingModule)(
    "holds tab=billing without redirecting while the viewer's context is loading",
    async () => {
      mockLocation.search = '?tab=billing';
      let answer!: (value: unknown) => void;
      const request = vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      render(
        <CapabilityProvider transport={{ request }} viewerKey={null}>
          <SettingsPage />
        </CapabilityProvider>,
      );

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Loading settings')).toBeInTheDocument();

      await act(async () => {
        answer(
          serializeCapabilityContext({
            ...EMPTY_CAPABILITY_CONTEXT,
            flags: { 'flags.billing': true },
          }),
        );
      });
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/settings/billing', { replace: true });
    },
  );

  it.runIf(hasBillingModule)(
    'falls back to /settings for tab=billing once a failed capability request settles',
    async () => {
      mockLocation.search = '?tab=billing';
      const request = vi.fn(() => Promise.reject(new Error('Context unavailable')));
      render(
        <CapabilityProvider transport={{ request }} viewerKey={null}>
          <SettingsPage />
        </CapabilityProvider>,
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
      });
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    },
  );

  it('renders ProfilePage directly as a full page on /profile without redirecting or modal chrome', () => {
    mockLocation.pathname = '/profile';
    render(<ProfilePage />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tabpanel').getAttribute('data-active-tab')).toBe('profile');
    expect(screen.getByTestId('section-profile-form')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders Outlet inside SettingsLayout for nested module settings routes like /settings/billing', () => {
    mockLocation.pathname = '/settings/billing';
    render(
      <CapabilityProvider
        initialContext={{
          ...EMPTY_CAPABILITY_CONTEXT,
          flags: { 'flags.billing': true },
        }}
      >
        <SettingsLayout />
      </CapabilityProvider>,
    );

    expect(screen.getByTestId('settings-route-outlet')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    if (hasBillingModule) {
      expect(screen.getByRole('button', { name: 'Billing' }).getAttribute('aria-current')).toBe(
        'page',
      );
    }
  });
});
