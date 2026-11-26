// main/modules/identity/web/LoginRegisterForms.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react';
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';

import { SmsChallengeError, TotpChallengeError } from './authService';
import { LoginForm, RegisterForm } from './LoginRegisterForms';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useEnabledOAuthProviders: vi.fn(),
  useEnabledAuthStrategies: vi.fn(),
  useLoginWithPasskey: vi.fn(),
  useOptionalAuthService: vi.fn(),
}));

vi.mock('./authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authService')>();
  return {
    ...actual,
    useAuth: mocks.useAuth,
    useLoginWithPasskey: mocks.useLoginWithPasskey,
    useOptionalAuthService: mocks.useOptionalAuthService,
  };
});

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useEnabledOAuthProviders: mocks.useEnabledOAuthProviders,
    useEnabledAuthStrategies: mocks.useEnabledAuthStrategies,
  };
});

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    user: null,
    login: vi.fn().mockResolvedValue(undefined),
  });
  mocks.useOptionalAuthService.mockReturnValue(undefined);
  mocks.useEnabledOAuthProviders.mockReturnValue({
    providers: [],
    isLoading: false,
    error: null,
  });
  mocks.useEnabledAuthStrategies.mockReturnValue({
    enabled: ['local'],
    disabled: [],
    isLoading: false,
    error: null,
  });
  mocks.useLoginWithPasskey.mockReturnValue({
    login: vi.fn(),
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginForm', () => {
  it('switches to TOTP challenge on TotpChallengeError and surfaces invalid TOTP error', async () => {
    const onLogin = vi.fn().mockRejectedValueOnce(new TotpChallengeError('chal-totp'));
    const onTotpVerify = vi.fn().mockRejectedValueOnce(new Error('Invalid TOTP code'));

    render(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <LoginForm onLogin={onLogin} onTotpVerify={onTotpVerify} />
        </CapabilityProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Email or Username/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Authentication Code/i), {
      target: { value: '000000' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Invalid TOTP code')).toBeInTheDocument();
    });
  });

  it('renders AccountLockedMessage when login fails with lockReason and switches to SMS on SmsChallengeError', async () => {
    const lockedError = Object.assign(new Error('Account locked'), {
      lockReason: 'Policy violation',
      lockedUntil: '2099-01-01T00:00:00.000Z',
    });
    const onLogin = vi
      .fn()
      .mockRejectedValueOnce(lockedError)
      .mockRejectedValueOnce(new SmsChallengeError('chal-sms'));
    const onSmsSendCode = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <LoginForm onLogin={onLogin} onSmsSendCode={onSmsSendCode} error="Account locked" />
        </CapabilityProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Email or Username/i), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'Password123!' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Account Suspended')).toBeInTheDocument();
      expect(screen.getByText(/Policy violation/)).toBeInTheDocument();
    });

    rerender(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <LoginForm onLogin={onLogin} onSmsSendCode={onSmsSendCode} error={null} />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('SMS Verification')).toBeInTheDocument();
    });
  });

  it('hides DemoQuickLogin by default and enables 1-click sign-in when runtime identity.demo_mode flag is active', async () => {
    const onLogin = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Invalid credentials'));
    const onSuccess = vi.fn();

    const { unmount } = render(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <LoginForm onLogin={onLogin} onSuccess={onSuccess} />
        </CapabilityProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('demo-quick-login')).toBeNull();
    unmount();

    render(
      <MemoryRouter>
        <CapabilityProvider
          initialContext={{
            ...EMPTY_CAPABILITY_CONTEXT,
            flags: { 'identity.demo_mode': true },
          }}
        >
          <LoginForm onLogin={onLogin} onSuccess={onSuccess} />
        </CapabilityProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('demo-quick-login')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Demo Member' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({
        identifier: 'demo@example.com',
        password: 'password123',
        rememberMe: false,
      });
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Workspace Admin' }));
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({
        identifier: 'user@example.com',
        password: 'password123',
        rememberMe: false,
      });
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RegisterForm', () => {
  it('keeps Create account disabled until both ToS and eligibility checkboxes are ticked, and handles resend failure', async () => {
    const onRegister = vi.fn().mockResolvedValueOnce({
      status: 'pending_verification',
      message: 'Verify your inbox',
      email: 'new@example.com',
    });
    const onResendVerification = vi.fn().mockRejectedValueOnce(new Error('Rate limited'));

    render(
      <MemoryRouter>
        <RegisterForm onRegister={onRegister} onResendVerification={onResendVerification} />
      </MemoryRouter>,
    );

    const submitBtn = screen.getByRole('button', { name: 'Create account' });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Username/i), { target: { value: 'newuser' } });
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'Password123!' } });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    expect(submitBtn).toBeDisabled();

    fireEvent.click(checkboxes[1]!);
    expect(submitBtn).not.toBeDisabled();

    fireEvent.submit(submitBtn.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
      expect(screen.getByText('Verify your inbox')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Resend email/i }));
    await waitFor(() => {
      expect(screen.getByText('Failed to resend. Please try again later.')).toBeInTheDocument();
    });
  });
});
