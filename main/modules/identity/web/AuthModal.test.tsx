// main/modules/identity/web/AuthModal.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react';
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';

import { AuthForm, AuthModal } from './AuthModal';

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
  mocks.useAuth.mockReturnValue({
    isAuthenticated: false,
    user: null,
    login: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
    register: vi.fn(),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn(),
    resendVerification: vi.fn(),
    requestMagicLink: vi.fn(),
    requestEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeOnboarding: vi.fn(),
    verifyTotpLogin: vi.fn(),
    sendSmsCode: vi.fn(),
    verifySmsLogin: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthForm & AuthModal', () => {
  it('falls back from magic-link to login when magic strategy is disabled', () => {
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <AuthModal open onOpenChange={onOpenChange} initialMode="magic-link" />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('opens in email-otp mode when magic strategy is enabled and login fails without closing modal', async () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <CapabilityProvider
          initialContext={{
            ...EMPTY_CAPABILITY_CONTEXT,
            authStrategies: ['password', 'magic'],
          }}
        >
          <AuthModal open onOpenChange={onOpenChange} initialMode="login" />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Sign in with email')).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <AuthModal open onOpenChange={onOpenChange} initialMode="login" />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/Email or Username/i), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('renders AuthForm across modes cleanly', () => {
    render(
      <MemoryRouter>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <AuthForm mode="forgot-password" />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Reset password')).toBeInTheDocument();
  });

  it('waits for CapabilityProvider loading before mounting initial form mode', () => {
    const pendingTransport = {
      request: () => new Promise<never>(() => undefined),
    };
    render(
      <MemoryRouter>
        <CapabilityProvider transport={pendingTransport}>
          <AuthModal open onOpenChange={vi.fn()} initialMode="magic-link" />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Welcome back')).toBeNull();
  });
});
