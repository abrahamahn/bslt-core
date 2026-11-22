// main/modules/identity/web/PasswordlessRecoveryForms.test.tsx
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryRouter } from '@bslt/react';

import { SIGNUP_ATTESTATION_STATEMENT } from '../contract';

import { ELIGIBILITY_ATTESTATION_REQUIRED } from './authService';
import {
  EmailOtpForm,
  ForgotPasswordForm,
  MagicLinkForm,
  ResetPasswordForm,
} from './PasswordlessRecoveryForms';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ForgotPasswordForm & ResetPasswordForm & MagicLinkForm', () => {
  it('renders enumeration-safe confirmation on ForgotPasswordForm and error when request fails', async () => {
    const onForgotPassword = vi
      .fn()
      .mockRejectedValueOnce(new Error('Rate limit'))
      .mockResolvedValueOnce(undefined);

    const { rerender } = render(
      <MemoryRouter>
        <ForgotPasswordForm onForgotPassword={onForgotPassword} error="Too many requests" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Too many requests')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'a@b.com' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send reset link' }).closest('form')!);
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ForgotPasswordForm onForgotPassword={onForgotPassword} error={null} />
      </MemoryRouter>,
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Send reset link' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });
  });

  it('rejects missing token in ResetPasswordForm and submits valid token', async () => {
    const onResetPassword = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <MemoryRouter>
        <ResetPasswordForm initialData={{ token: '' }} onResetPassword={onResetPassword} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Invalid reset link')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ResetPasswordForm initialData={{ token: 'valid-tok' }} onResetPassword={onResetPassword} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/New password/i), {
      target: { value: 'NewPass123!' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Update password' }).closest('form')!);
    await waitFor(() => {
      expect(onResetPassword).toHaveBeenCalledWith({
        token: 'valid-tok',
        password: 'NewPass123!',
      });
    });
  });

  it('surfaces MagicLinkForm error and shows check-email state on success', async () => {
    const onRequestMagicLink = vi
      .fn()
      .mockRejectedValueOnce(new Error('Blocked'))
      .mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter>
        <MagicLinkForm onRequestMagicLink={onRequestMagicLink} error="Blocked" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'magic@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send login link' }).closest('form')!);
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole('button', { name: 'Send login link' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });
  });
});

describe('EmailOtpForm', () => {
  it('handles attestation-required refusal on new user OTP and transitions to onboarding', async () => {
    const onRequestEmailOtp = vi.fn().mockResolvedValue(undefined);
    const onVerifyEmailOtp = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Attestation needed'), {
          code: ELIGIBILITY_ATTESTATION_REQUIRED,
        }),
      )
      .mockResolvedValueOnce({ isNewUser: true });
    const onCompleteOnboarding = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <EmailOtpForm
          onRequestEmailOtp={onRequestEmailOtp}
          onVerifyEmailOtp={onVerifyEmailOtp}
          onCompleteOnboarding={onCompleteOnboarding}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'otp@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Send code' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByLabelText(/Security code/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Security code/i), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify and sign in' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(SIGNUP_ATTESTATION_STATEMENT)).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: 'Create account' });
    expect(createBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(createBtn).not.toBeDisabled();
    fireEvent.submit(createBtn.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Complete your profile')).toBeInTheDocument();
    });
    expect(onVerifyEmailOtp).toHaveBeenLastCalledWith({
      email: 'otp@example.com',
      code: '123456',
      eligibilityAttested: true,
      tosAccepted: true,
    });
  });
});
