// main/modules/identity/web/IdentitySecuritySettings.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BackupCodesDisplay,
  EmailChangeForm,
  ForgotPasswordShortcut,
  OAuthConnectionsList,
  PasskeyManagement,
  PasswordChangeForm,
  PasswordSetupForm,
  PhoneManagement,
  TotpManagement,
  TotpQrCode,
} from './IdentitySecuritySettings';

import type { User } from '../contract';

const mockState = vi.hoisted(() => ({
  totpState: 'disabled' as 'loading' | 'disabled' | 'setup-in-progress' | 'enabled',
  totpError: null as string | null,
  totpLoading: false,
  totpSetupData: null as { secret: string; otpauthUrl: string; backupCodes: string[] } | null,
  beginSetup: vi.fn(),
  enableTotp: vi.fn(),
  disableTotp: vi.fn(),
  cancelSetup: vi.fn(),
  backupStatus: { total: 10, remaining: 0, used: 10 } as {
    total: number;
    remaining: number;
    used: number;
  } | null,
  backupLoading: false,
  backupRegenerating: false,
  backupNewCodes: null as string[] | null,
  backupError: null as string | null,
  regenerateBackup: vi.fn(),
  dismissBackup: vi.fn(),
  strategiesEnabled: [] as string[],
  strategiesLoading: false,
  strategiesError: null as Error | null,
  passkeys: [] as Array<{
    id: string;
    name: string;
    deviceType: string;
    backedUp: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }>,
  passkeysLoading: false,
  passkeysError: null as string | null,
  renamePasskey: vi.fn(),
  removePasskey: vi.fn(),
  registerPasskey: vi.fn(),
  registerPasskeyError: null as string | null,
  phoneLoading: false,
  phoneError: null as Error | null,
  setPhone: vi.fn(),
  verifyPhone: vi.fn(),
  removePhone: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  changePasswordError: null as Error | null,
  setPasswordHook: vi.fn(),
  forgotPassword: vi.fn(),
  oauthProviders: [] as Array<'google' | 'github' | 'apple'>,
  oauthProvidersError: null as Error | null,
  oauthConnections: [] as Array<{
    id: string;
    provider: 'google' | 'github' | 'apple';
    providerEmail: string;
    linkedAt: string;
  }>,
  oauthConnectionsError: null as Error | null,
  unlinkOAuth: vi.fn(),
  linkOAuth: vi.fn(),
}));

vi.mock('./hooks', () => ({
  useTotpManagement: () => ({
    state: mockState.totpState,
    error: mockState.totpError,
    isLoading: mockState.totpLoading,
    setupData: mockState.totpSetupData,
    beginSetup: mockState.beginSetup,
    enable: mockState.enableTotp,
    disable: mockState.disableTotp,
    cancelSetup: mockState.cancelSetup,
  }),
  useBackupCodes: () => ({
    status: mockState.backupStatus,
    isLoading: mockState.backupLoading,
    isRegenerating: mockState.backupRegenerating,
    newCodes: mockState.backupNewCodes,
    error: mockState.backupError,
    regenerate: mockState.regenerateBackup,
    dismissCodes: mockState.dismissBackup,
  }),
  useEnabledAuthStrategies: () => ({
    enabled: mockState.strategiesEnabled,
    isLoading: mockState.strategiesLoading,
    error: mockState.strategiesError,
  }),
  usePasskeys: () => ({
    passkeys: mockState.passkeys,
    isLoading: mockState.passkeysLoading,
    error: mockState.passkeysError,
    refetch: vi.fn(),
    rename: mockState.renamePasskey,
    remove: mockState.removePasskey,
  }),
  useRegisterPasskey: () => ({
    register: mockState.registerPasskey,
    isLoading: false,
    error: mockState.registerPasskeyError,
  }),
  usePhone: () => ({
    isLoading: mockState.phoneLoading,
    error: mockState.phoneError,
    setPhone: mockState.setPhone,
    verifyPhone: mockState.verifyPhone,
    removePhone: mockState.removePhone,
  }),
  useChangeEmail: () => mockState.changeEmail,
  usePasswordChange: () => ({
    changePassword: mockState.changePassword,
    isLoading: false,
    error: mockState.changePasswordError,
    reset: vi.fn(),
  }),
  useSetPassword: () => mockState.setPasswordHook,
  useForgotPassword: () => mockState.forgotPassword,
  useEnabledOAuthProviders: () => ({
    providers: mockState.oauthProviders,
    isLoading: false,
    error: mockState.oauthProvidersError,
  }),
  useOAuthConnections: () => ({
    connections: mockState.oauthConnections,
    isLoading: false,
    isActing: false,
    error: mockState.oauthConnectionsError,
    unlink: mockState.unlinkOAuth,
    link: mockState.linkOAuth,
  }),
}));

const sampleUser: User = {
  id: '11111111-1111-4111-8111-111111111111' as User['id'],
  email: 'alice@example.com',
  username: 'alice',
  firstName: 'Alice',
  lastName: 'Smith',
  role: 'user',
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  dateOfBirth: null,
  gender: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('IdentitySecuritySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.totpState = 'disabled';
    mockState.totpError = null;
    mockState.totpSetupData = null;
    mockState.backupStatus = { total: 10, remaining: 0, used: 10 };
    mockState.backupError = null;
    mockState.backupNewCodes = null;
    mockState.strategiesEnabled = [];
    mockState.strategiesError = null;
    mockState.passkeys = [];
    mockState.passkeysError = null;
    mockState.phoneError = null;
    mockState.changePasswordError = null;
    mockState.oauthProviders = [];
    mockState.oauthProvidersError = null;
    mockState.oauthConnections = [];
    mockState.oauthConnectionsError = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('PasswordChangeForm and PasswordSetupForm REJECT mismatched, weak, or unchanged passwords', async () => {
    render(
      <div>
        <PasswordChangeForm />
        <PasswordSetupForm />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/Current Password/), {
      target: { value: 'StrongPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/^New Password/), {
      target: { value: 'StrongPass123!' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm New Password/), {
      target: { value: 'StrongPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('New password must be different from current password')).not.toBeNull();
    expect(mockState.changePassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set Password' }));
    await waitFor(() => {
      expect(mockState.setPasswordHook).not.toHaveBeenCalled();
    });
  });

  it('EmailChangeForm and ForgotPasswordShortcut SURFACE rejected API mutations', async () => {
    mockState.changeEmail.mockRejectedValueOnce(new Error('Invalid current password'));
    mockState.forgotPassword.mockRejectedValueOnce(new Error('Rate limit exceeded'));

    render(
      <div>
        <EmailChangeForm />
        <ForgotPasswordShortcut email="alice@example.com" />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/New Email Address/), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Current Password/), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change Email' }));
    await waitFor(() => {
      expect(screen.getByText('Invalid current password')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Email' }));
    await waitFor(() => {
      expect(screen.getByText('Rate limit exceeded')).not.toBeNull();
    });
  });

  it('PasskeyManagement, TotpQrCode, TotpManagement, BackupCodesDisplay, PhoneManagement, and OAuthConnectionsList HANDLE unsupported/disabled/error states', async () => {
    mockState.totpError = 'Invalid TOTP verification code';
    mockState.backupError = 'Backup regeneration failed';
    mockState.oauthProvidersError = new Error('OAuth config unavailable');
    mockState.setPhone.mockRejectedValueOnce(new Error('SMS delivery failed'));

    render(
      <div>
        <TotpQrCode url="otpauth://totp/BSLT:alice?secret=JBSWY3DPEHPK3PXP" />
        <TotpManagement />
        <BackupCodesDisplay />
        <PasskeyManagement />
        <PhoneManagement user={sampleUser} />
        <OAuthConnectionsList />
      </div>,
    );

    expect(screen.getByText('Invalid TOTP verification code')).not.toBeNull();
    expect(screen.getByText('Backup regeneration failed')).not.toBeNull();
    expect(screen.getByText(/All codes have been used/)).not.toBeNull();
    expect(screen.getByText(/Failed to load OAuth connections/)).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText('+1 (555) 123-4567'), {
      target: { value: '+15551234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByText('SMS delivery failed')).not.toBeNull();
    });
  });

  it('renders enabled TOTP, OAuth provider list, and verified PhoneManagement cleanly', () => {
    mockState.totpState = 'enabled';
    mockState.oauthProviders = ['google'];
    render(
      <div>
        <TotpManagement />
        <PhoneManagement user={{ ...sampleUser, phone: '+15551239876', phoneVerified: true }} />
        <OAuthConnectionsList />
      </div>,
    );

    expect(screen.getByText('Two-factor authentication is enabled')).not.toBeNull();
    expect(screen.getByText('***9876')).not.toBeNull();
    expect(screen.getByText('Google')).not.toBeNull();
  });
});
