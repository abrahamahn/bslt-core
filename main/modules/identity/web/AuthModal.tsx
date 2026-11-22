// main/modules/identity/web/AuthModal.tsx
import { useEffect, useState, type ReactElement } from 'react';

import { useFormState, type AuthMode } from '@bslt/react/hooks';
import { Dialog } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';

import { useAuth } from './authService';
import { LoginForm, RegisterForm } from './LoginRegisterForms';
import {
  EmailOtpForm,
  ForgotPasswordForm,
  MagicLinkForm,
  ResetPasswordForm,
} from './PasswordlessRecoveryForms';

import type {
  CompleteOnboardingRequest,
  EmailOtpRequest,
  EmailOtpVerifyRequest,
  ForgotPasswordRequest,
  LoginRequest,
  MagicLinkRequest,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResetPasswordRequest,
} from '../contract';

export interface AuthFormProps {
  mode: AuthMode;
  onLogin?: (data: LoginRequest) => Promise<void>;
  onRegister?: (data: RegisterRequest) => Promise<RegisterResponse>;
  onForgotPassword?: (data: ForgotPasswordRequest) => Promise<void>;
  onResetPassword?: (data: ResetPasswordRequest) => Promise<void>;
  onResendVerification?: (data: ResendVerificationRequest) => Promise<void>;
  onRequestMagicLink?: (data: MagicLinkRequest) => Promise<void>;
  onRequestEmailOtp?: (data: EmailOtpRequest) => Promise<void>;
  onVerifyEmailOtp?: (data: EmailOtpVerifyRequest) => Promise<{ isNewUser: boolean }>;
  onCompleteOnboarding?: (data: CompleteOnboardingRequest) => Promise<void>;
  onTotpVerify?: (challengeToken: string, code: string) => Promise<void>;
  onSmsVerify?: (challengeToken: string, code: string) => Promise<void>;
  onSmsSendCode?: (challengeToken: string) => Promise<void>;
  onSuccess?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  initialData?: Record<string, unknown>;
  isLoading?: boolean;
  error?: string | null;
}

export const AuthForm = (props: AuthFormProps): ReactElement => {
  const {
    mode,
    onLogin,
    onRegister,
    onForgotPassword,
    onResetPassword,
    onResendVerification,
    onRequestMagicLink,
    onRequestEmailOtp,
    onVerifyEmailOtp,
    onCompleteOnboarding,
    onTotpVerify,
    onSmsVerify,
    onSmsSendCode,
    onSuccess,
    onModeChange,
    initialData,
    isLoading,
    error,
  } = props;

  switch (mode) {
    case 'login':
      return (
        <LoginForm
          {...(onLogin !== undefined && { onLogin })}
          {...(onForgotPassword !== undefined && { onForgotPassword })}
          {...(onTotpVerify !== undefined && { onTotpVerify })}
          {...(onSmsVerify !== undefined && { onSmsVerify })}
          {...(onSmsSendCode !== undefined && { onSmsSendCode })}
          {...(onSuccess !== undefined && { onSuccess })}
          {...(onModeChange !== undefined && { onModeChange })}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
    case 'register':
      return (
        <RegisterForm
          {...(onRegister !== undefined && { onRegister })}
          {...(onResendVerification !== undefined && { onResendVerification })}
          {...(onSuccess !== undefined && { onSuccess })}
          {...(onModeChange !== undefined && { onModeChange })}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
    case 'forgot-password':
      return (
        <ForgotPasswordForm
          {...(onForgotPassword !== undefined && { onForgotPassword })}
          {...(onSuccess !== undefined && { onSuccess })}
          {...(onModeChange !== undefined && { onModeChange })}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
    case 'reset-password':
      return (
        <ResetPasswordForm
          {...(onResetPassword !== undefined && { onResetPassword })}
          {...(onSuccess !== undefined && { onSuccess })}
          {...(onModeChange !== undefined && { onModeChange })}
          initialData={initialData as { token?: string }}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
    case 'magic-link':
      return (
        <MagicLinkForm
          {...(onRequestMagicLink !== undefined && { onRequestMagicLink })}
          {...(onModeChange !== undefined && { onModeChange })}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
    case 'email-otp':
      return (
        <EmailOtpForm
          {...(onRequestEmailOtp !== undefined && { onRequestEmailOtp })}
          {...(onVerifyEmailOtp !== undefined && { onVerifyEmailOtp })}
          {...(onCompleteOnboarding !== undefined && { onCompleteOnboarding })}
          {...(onModeChange !== undefined && { onModeChange })}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
    default:
      return (
        <LoginForm
          {...(onLogin !== undefined && { onLogin })}
          {...(onForgotPassword !== undefined && { onForgotPassword })}
          {...(onTotpVerify !== undefined && { onTotpVerify })}
          {...(onSmsVerify !== undefined && { onSmsVerify })}
          {...(onSmsSendCode !== undefined && { onSmsSendCode })}
          {...(onSuccess !== undefined && { onSuccess })}
          {...(onModeChange !== undefined && { onModeChange })}
          {...(isLoading !== undefined && { isLoading })}
          {...(error !== undefined && { error })}
        />
      );
  }
};

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: AuthMode;
  onSuccess?: () => void;
}

const ADVANCED_ONLY_MODES: readonly AuthMode[] = ['magic-link', 'email-otp'];

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
  const { status: capabilitiesStatus, hasAuthStrategy } = useCapabilities();
  const capabilitiesLoading = capabilitiesStatus === 'loading';
  const advancedAuthEnabled = hasAuthStrategy('magic');
  const [mode, setMode] = useState<AuthMode>(() =>
    resolveInitialMode(initialMode, advancedAuthEnabled),
  );

  useEffect(() => {
    if (open && !capabilitiesLoading) {
      queueMicrotask(() => {
        setMode(resolveInitialMode(initialMode, advancedAuthEnabled));
        setError(null);
      });
    }
  }, [open, capabilitiesLoading, initialMode, advancedAuthEnabled, setError]);

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
    onRegister: wrapHandler(register),
    onForgotPassword: wrapHandler(forgotPassword),
    onResetPassword: wrapHandler(resetPassword, { onSuccess: closeModalOnSuccess }),
    onResendVerification: resendVerification,
    onRequestMagicLink: wrapHandler(async (data) => {
      await requestMagicLink(data);
    }),
    onRequestEmailOtp: wrapHandler(async (data: { email: string }) => {
      await requestEmailOtp(data);
    }),
    onVerifyEmailOtp: wrapHandler(async (data: EmailOtpVerifyRequest) => {
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
    <Dialog.Root open={open} onClose={handleClose}>
      {capabilitiesLoading ? <div className="auth-form" /> : <AuthForm {...formProps} />}
    </Dialog.Root>
  );
};
