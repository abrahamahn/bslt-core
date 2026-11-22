// main/modules/identity/web/AuthPages.test.tsx
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react';
import { CapabilityProvider, EMPTY_CAPABILITY_CONTEXT } from '@bslt/web-platform';

import { SIGNUP_ATTESTATION_STATEMENT, type User } from '../contract';

import {
  AuthQueryModalRoute,
  ConfirmEmailChangePage,
  ConfirmEmailPage,
  LoginModalRoute,
  MagicLinkVerifyPage,
  ReactivatePromptPage,
  RegisterModalRoute,
  ResetPasswordPage,
  RevertEmailChangePage,
} from './AuthPages';
import { closeAuthModal, ELIGIBILITY_ATTESTATION_REQUIRED, getAuthModalState } from './authService';

import type { UserId } from '@bslt/schema';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useVerifyEmail: vi.fn(),
  useOptionalAuthService: vi.fn(),
  useConfirmEmailChange: vi.fn(),
  useRevertEmailChange: vi.fn(),
  useReactivateAccount: vi.fn(),
}));

vi.mock('./authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./authService')>();
  return {
    ...actual,
    useAuth: mocks.useAuth,
    useVerifyEmail: mocks.useVerifyEmail,
    useOptionalAuthService: mocks.useOptionalAuthService,
  };
});

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useConfirmEmailChange: mocks.useConfirmEmailChange,
    useRevertEmailChange: mocks.useRevertEmailChange,
    useReactivateAccount: mocks.useReactivateAccount,
  };
});

const BASE_USER: User = {
  id: '11111111-1111-4111-8111-111111111111' as UserId,
  email: 'alice@example.com',
  username: 'alice',
  firstName: 'Alice',
  lastName: 'Lovelace',
  role: 'user',
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  dateOfBirth: null,
  gender: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  mocks.useAuth.mockReturnValue({
    user: null,
    isAuthenticated: false,
    resetPassword: vi.fn().mockResolvedValue(undefined),
    reloadUser: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  });
  mocks.useVerifyEmail.mockReturnValue({
    mutate: vi.fn().mockResolvedValue({ verified: true }),
    isLoading: false,
    error: null,
    reset: vi.fn(),
  });
  mocks.useConfirmEmailChange.mockReturnValue(vi.fn());
  mocks.useRevertEmailChange.mockReturnValue(vi.fn());
  mocks.useReactivateAccount.mockReturnValue({
    reactivate: vi.fn(),
    isLoading: false,
    error: null,
    reset: vi.fn(),
  });
});

afterEach(() => {
  act(() => {
    closeAuthModal();
  });
  cleanup();
  vi.clearAllMocks();
});

describe('AuthPages', () => {
  it('opens LoginModalRoute, RegisterModalRoute, and AuthQueryModalRoute cleanly', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/login']}>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <LoginModalRoute />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(getAuthModalState()).toEqual({ open: true, mode: 'login' });
    unmount();

    const { unmount: unmountReg } = render(
      <MemoryRouter initialEntries={['/register']}>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <RegisterModalRoute />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(getAuthModalState()).toEqual({ open: true, mode: 'register' });
    unmountReg();

    render(
      <MemoryRouter initialEntries={['/auth?mode=magic-link']}>
        <CapabilityProvider initialContext={EMPTY_CAPABILITY_CONTEXT}>
          <AuthQueryModalRoute />
        </CapabilityProvider>
      </MemoryRouter>,
    );
    expect(getAuthModalState()).toEqual({ open: true, mode: 'login' });
  });

  it('shows missing-token errors across ConfirmEmailPage, ConfirmEmailChangePage, RevertEmailChangePage, and ResetPasswordPage', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/confirm-email']}>
        <ConfirmEmailPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Invalid verification link')).toBeInTheDocument();
    });
    cleanup();

    render(
      <MemoryRouter initialEntries={['/auth/change-email/confirm']}>
        <ConfirmEmailChangePage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(
        screen.getByText('Invalid email change link. No token was provided.'),
      ).toBeInTheDocument();
    });
    cleanup();

    render(
      <MemoryRouter initialEntries={['/auth/change-email/revert']}>
        <RevertEmailChangePage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(
        screen.getByText('Invalid email reversion link. No token was provided.'),
      ).toBeInTheDocument();
    });
    cleanup();

    render(
      <MemoryRouter initialEntries={['/auth/reset-password']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Invalid reset link')).toBeInTheDocument();
  });

  it('handles MagicLinkVerifyPage missing token and attestation refusal retry', async () => {
    const verifyMagicLink = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('confirm eligibility'), {
          code: ELIGIBILITY_ATTESTATION_REQUIRED,
        }),
      )
      .mockResolvedValueOnce(undefined);
    mocks.useOptionalAuthService.mockReturnValue({
      verifyMagicLink,
      getState: () => ({ user: BASE_USER }),
    });

    render(
      <MemoryRouter initialEntries={['/auth/magic-link/verify']}>
        <MagicLinkVerifyPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Invalid or missing magic link token')).toBeInTheDocument();
    expect(verifyMagicLink).not.toHaveBeenCalled();
    cleanup();

    render(
      <MemoryRouter initialEntries={['/auth/magic-link/verify?token=tok-ml']}>
        <MagicLinkVerifyPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(SIGNUP_ATTESTATION_STATEMENT)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(screen.getByText('Signed in!')).toBeInTheDocument();
    });
    expect(verifyMagicLink).toHaveBeenLastCalledWith({
      token: 'tok-ml',
      eligibilityAttested: true,
      tosAccepted: true,
    });
  });

  it('renders ReactivatePromptPage for deactivated user and surfaces reactivation error', () => {
    mocks.useAuth.mockReturnValue({
      user: { ...BASE_USER, deactivatedAt: '2026-01-02T00:00:00.000Z' },
      isAuthenticated: true,
      reloadUser: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    });
    mocks.useReactivateAccount.mockReturnValue({
      reactivate: vi.fn(),
      isLoading: false,
      error: new Error('Cannot reactivate right now'),
      reset: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/reactivate']}>
        <ReactivatePromptPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Your account is inactive')).toBeInTheDocument();
    expect(screen.getByText('Cannot reactivate right now')).toBeInTheDocument();
  });
});
