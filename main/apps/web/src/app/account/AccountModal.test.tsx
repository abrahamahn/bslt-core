// main/apps/web/src/app/account/AccountModal.test.tsx
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';
import { fireEvent, render, screen } from '@testing-library/react';
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasBillingModule } from '../../generated/modules';

import { AccountModal } from './AccountModal';
import { closeAccountModal, openAccountModal, setAccountModalSection } from './accountModalStore';

const { mockNavigate, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLocation: { pathname: '/dashboard', search: '', hash: '' },
}));

vi.mock('@bslt/react/router', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

vi.mock('#app/app/authToken', () => ({
  getAccessToken: vi.fn(() => 'token'),
}));

const mockUser = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'user1',
  firstName: 'Test',
  lastName: 'User',
  role: 'user',
  updatedAt: '2026-01-01T00:00:00Z',
};

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
    useAuth: () => ({ user: mockUser, reloadUser: vi.fn() }),
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
  mockLocation.pathname = '/dashboard';
});

afterEach(() => {
  act(() => {
    closeAccountModal();
    setAccountModalSection('profile');
  });
});

describe('AccountModal', () => {
  it('renders nothing while closed', () => {
    render(<AccountModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens at the requested section with the sidebar nav and e2e panel contract', () => {
    render(<AccountModal />);
    act(() => {
      openAccountModal('profile');
    });

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('data-active-tab')).toBe('profile');
    expect(screen.getByTestId('section-profile-form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('switches sections from the sidebar without navigating (off the settings surface)', () => {
    render(<AccountModal />);
    act(() => {
      openAccountModal('profile');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    expect(screen.getByRole('tabpanel').getAttribute('data-active-tab')).toBe('sessions');
    expect(screen.getByTestId('section-sessions')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the URL truthful when switching sections on the settings surface', () => {
    mockLocation.pathname = '/settings';
    render(<AccountModal />);
    act(() => {
      openAccountModal('profile');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Security' }));

    expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=security', { replace: true });
  });

  it.runIf(hasBillingModule)(
    'hides billing when disabled and navigates to the billing page when enabled',
    () => {
      render(
        <CapabilityProvider
          initialContext={{
            ...EMPTY_CAPABILITY_CONTEXT,
            flags: { 'flags.billing': true },
          }}
        >
          <AccountModal />
        </CapabilityProvider>,
      );
      act(() => {
        openAccountModal('profile');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Billing' }));

      expect(mockNavigate).toHaveBeenCalledWith('/settings/billing');
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('omits the billing nav item when billing is disabled', () => {
    render(<AccountModal />);
    act(() => {
      openAccountModal('profile');
    });
    expect(screen.queryByRole('button', { name: 'Billing' })).toBeNull();
  });

  it('returns to the dashboard when closed while on a settings URL', () => {
    mockLocation.pathname = '/settings';
    render(<AccountModal />);
    act(() => {
      openAccountModal('profile');
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('stays on the current page when closed elsewhere', () => {
    render(<AccountModal />);
    act(() => {
      openAccountModal('profile');
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('gates advanced-auth security sections', () => {
    render(<AccountModal />);
    act(() => {
      openAccountModal('security');
    });
    expect(screen.queryByTestId('section-passkeys')).toBeNull();
    expect(screen.getByTestId('section-password-change')).toBeInTheDocument();
  });
});
