// main/apps/web/src/features/auth/components/AuthModal.tsx

import { isAdvancedAuthEnabled } from '@app/capabilities';
import { useAuth } from '@auth/hooks';
import { useFormState, type AuthMode } from '@bslt/react/hooks';
import { Modal } from '@bslt/ui';
import { useEffect, useState } from 'react';

import { AuthForm, type AuthFormProps } from './AuthForms';

import type { ReactElement } from 'react';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: AuthMode;
  onSuccess?: () => void;
}

/** Modes that require the advanced-auth capability to be enabled. */
const ADVANCED_ONLY_MODES: readonly AuthMode[] = ['magic-link', 'email-otp'];

/**
 * Resolve the mode the modal opens in. When advanced auth is enabled the 6-digit
 * email code is the primary sign-in, so the generic "login" entry point lands on
 * email-otp (password is one click away). When it is disabled, advanced-only modes
 * fall back to password so the modal never opens on an unavailable method.
 */
function resolveInitialMode(requested: AuthMode, advancedEnabled: boolean): AuthMode {
  if (requested === 'login' && advancedEnabled) return 'email-otp';
  if (ADVANCED_ONLY_MODES.includes(requested) && !advancedEnabled) return 'login';
  return requested;
}

export const AuthModal = ({
  open,
  onOpenChange,
  initialMode = 'login',
  onSuccess,
}: AuthModalProps): ReactElement | null => {
  const {
    isAuthenticated,
    login,
    register,
    forgotPassword,
    resetPassword,
    resendVerification,
    requestMagicLink,
    requestEmailOtp,
    verifyEmailOtp,
    completeOnboarding,
    verifyTotpLogin,
    sendSmsCode,
    verifySmsLogin,
  } = useAuth();
  const { isLoading, error, setError, wrapHandler } = useFormState();
  const advancedAuthEnabled = isAdvancedAuthEnabled();
  const [mode, setMode] = useState<AuthMode>(() =>
    resolveInitialMode(initialMode, advancedAuthEnabled),
  );

  // Sync mode when the modal (re)opens with a different initialMode.
  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setMode(resolveInitialMode(initialMode, advancedAuthEnabled));
        setError(null);
      });
    }
  }, [open, initialMode, advancedAuthEnabled, setError]);

  // The modal exists to authenticate; once that has happened it has nothing left
  // to show. Registration is why this is needed: with auto-verify on, the server
  // returns `status: 'verified'` and RegisterForm signs the user in itself, so no
  // handler here ever resolves with "and now close". Closing from `register`'s
  // return instead would unmount RegisterForm mid-login, before it can sign in and
  // redirect. Reacting to the session means every path that authenticates —
  // register, magic link, email OTP — closes without bespoke wiring.
  //
  // Safe because the header only offers Login/Register while signed out, so an
  // authenticated user cannot have this open for any other purpose.
  useEffect(() => {
    if (open && isAuthenticated) onOpenChange(false);
  }, [open, isAuthenticated, onOpenChange]);

  const handleModeChange = (newMode: AuthMode): void => {
    if (ADVANCED_ONLY_MODES.includes(newMode) && !advancedAuthEnabled) return;
    setMode(newMode);
    setError(null);
  };

  const handleClose = (): void => {
    onOpenChange(false);
  };

  const closeModalOnSuccess = (): void => {
    onSuccess?.();
    onOpenChange(false);
  };

  const formProps: AuthFormProps = {
    mode,
    onLogin: wrapHandler(login, { onSuccess: closeModalOnSuccess }),
    // Registration deliberately does not close here: `pending_verification` needs
    // the check-your-email screen to stay visible. The auto-verified case closes
    // via the session effect above, once RegisterForm has signed the user in.
    onRegister: wrapHandler(register),
    onForgotPassword: wrapHandler(forgotPassword, { onSuccess: closeModalOnSuccess }),
    onResetPassword: wrapHandler(resetPassword, { onSuccess: closeModalOnSuccess }),
    onResendVerification: resendVerification,
    // Passwordless: a magic-link request only sends an email (the form shows its own
    // confirmation), but a verified email code logs the user in, so close on success.
    onRequestMagicLink: wrapHandler(async (data) => {
      await requestMagicLink(data);
    }),
    onRequestEmailOtp: wrapHandler(async (data: { email: string }) => {
      await requestEmailOtp(data);
    }),
    // A new user must finish onboarding inside the modal, so only close when an
    // existing user signs in; new users close via onCompleteOnboarding below.
    onVerifyEmailOtp: wrapHandler(async (data: { email: string; code: string }) => {
      const result = await verifyEmailOtp(data);
      if (!result.isNewUser) closeModalOnSuccess();
      return result;
    }),
    onCompleteOnboarding: wrapHandler(
      async (data: { firstName: string; lastName: string; username: string; password: string }) => {
        await completeOnboarding(data);
      },
      { onSuccess: closeModalOnSuccess },
    ),
    onTotpVerify: verifyTotpLogin,
    onSmsVerify: verifySmsLogin,
    onSmsSendCode: sendSmsCode,
    onModeChange: handleModeChange,
    isLoading,
    error,
  };

  return (
    <Modal.Root open={open} onClose={handleClose}>
      <AuthForm {...formProps} />
    </Modal.Root>
  );
};
