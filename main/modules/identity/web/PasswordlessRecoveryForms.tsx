// main/modules/identity/web/PasswordlessRecoveryForms.tsx
import {
  useCallback,
  useState,
  type ChangeEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react';

import { Link } from '@bslt/react/router';
import { Alert, AuthFormLayout, Button, Checkbox, Input, PasswordInput, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import { SIGNUP_ATTESTATION_STATEMENT } from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { TurnstileWidget } from './AuthPrimitives';
import { isEligibilityAttestationRequired } from './authService';

import type {
  CompleteOnboardingRequest,
  EmailOtpRequest,
  EmailOtpVerifyRequest,
  ForgotPasswordRequest,
  MagicLinkRequest,
  ResetPasswordRequest,
} from '../contract';
import type { AuthMode } from '@bslt/react/hooks';

// ============================================================================
// 1. ForgotPasswordForm
// ============================================================================

interface ForgotPasswordFormProps {
  onForgotPassword?: (data: ForgotPasswordRequest) => Promise<void>;
  onSuccess?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

export const ForgotPasswordForm = ({
  onForgotPassword,
  onModeChange,
  isLoading,
  error,
  onSuccess,
}: ForgotPasswordFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onForgotPassword === undefined) return;
    setLocalError(null);

    try {
      await onForgotPassword({
        email,
        ...(captchaToken !== undefined ? { captchaToken } : {}),
      });
      setSentTo(email);
      onSuccess?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const displayError = error !== undefined ? error : localError;

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>{t('identity.forgot.title')}</AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{t('identity.forgot.subtitle')}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        {sentTo !== null ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title={t('identity.forgot.checkEmailTitle')}>
              {t('identity.forgot.sentPrefix')}
              <strong>{sentTo}</strong>
              {t('identity.forgot.sentSuffix')}
            </Alert>
            <Text size="sm" tone="muted" className="text-center">
              {t('identity.forgot.spamHint')}
            </Text>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setSentTo(null);
              }}
            >
              {t('identity.forgot.differentEmail')}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label={t('identity.forgot.emailLabel')}
              id="forgot-password-email"
              name="email"
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEmail(e.target.value);
              }}
              required
              disabled={isLoading}
              autoComplete="email"
            />

            {displayError !== null && displayError.length > 0 && (
              <AuthFormLayout.Error>{displayError}</AuthFormLayout.Error>
            )}

            <TurnstileWidget onToken={handleCaptchaToken} />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading === true ? t('identity.forgot.sending') : t('identity.forgot.submit')}
            </Button>
          </form>
        )}

        <AuthFormLayout.Footer>
          {t('identity.forgot.rememberPrefix')}
          {onModeChange !== undefined ? (
            <Button
              variant="text"
              onClick={() => {
                onModeChange('login');
              }}
              size="inline"
            >
              {t('identity.forgot.signInLink')}
            </Button>
          ) : (
            <Link to="/auth?mode=login">{t('identity.forgot.signInLink')}</Link>
          )}
        </AuthFormLayout.Footer>
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};

// ============================================================================
// 2. ResetPasswordForm
// ============================================================================

interface ResetPasswordFormProps {
  onResetPassword?: (data: ResetPasswordRequest) => Promise<void>;
  onSuccess?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  initialData?: { token?: string };
  isLoading?: boolean;
  error?: string | null;
}

export const ResetPasswordForm = ({
  onResetPassword,
  onModeChange,
  isLoading,
  error,
  onSuccess,
  initialData,
}: ResetPasswordFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const token = initialData?.token ?? '';

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onResetPassword === undefined || token.length === 0) return;
    setLocalError(null);

    try {
      await onResetPassword({ token, password });
      onSuccess?.();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const displayError = error !== undefined ? error : localError;

  if (token.length === 0) {
    return (
      <AuthFormLayout>
        <AuthFormLayout.Content className="text-center">
          <AuthFormLayout.Title className="text-danger">
            {t('identity.reset.invalidTitle')}
          </AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{t('identity.reset.invalidSubtitle')}</AuthFormLayout.Subtitle>
          {onModeChange !== undefined ? (
            <Button
              variant="secondary"
              onClick={() => {
                onModeChange('forgot-password');
              }}
            >
              {t('identity.reset.requestNew')}
            </Button>
          ) : (
            <Link to="/auth?mode=forgot-password">
              <Button variant="secondary">{t('identity.reset.requestNew')}</Button>
            </Link>
          )}
        </AuthFormLayout.Content>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>{t('identity.reset.title')}</AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{t('identity.reset.subtitle')}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="auth-form-fields"
        >
          <PasswordInput
            label={t('identity.reset.passwordLabel')}
            id="reset-password"
            name="new-password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPassword(e.target.value);
            }}
            required
            disabled={isLoading}
            autoComplete="new-password"
          />

          {displayError !== null && displayError.length > 0 && (
            <AuthFormLayout.Error>{displayError}</AuthFormLayout.Error>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading === true ? t('identity.reset.updating') : t('identity.reset.submit')}
          </Button>
        </form>

        <AuthFormLayout.Footer>
          {onModeChange !== undefined ? (
            <Button
              variant="text"
              onClick={() => {
                onModeChange('login');
              }}
              size="inline"
            >
              {t('identity.reset.backToSignIn')}
            </Button>
          ) : (
            <Link to="/auth?mode=login">{t('identity.reset.backToSignIn')}</Link>
          )}
        </AuthFormLayout.Footer>
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};

// ============================================================================
// 3. MagicLinkForm
// ============================================================================

interface MagicLinkFormProps {
  onRequestMagicLink?: (data: MagicLinkRequest) => Promise<void>;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

export const MagicLinkForm = ({
  onRequestMagicLink,
  onModeChange,
  isLoading,
  error,
}: MagicLinkFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onRequestMagicLink === undefined) return;
    setLocalError(null);

    try {
      await onRequestMagicLink({ email });
      setSent(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const displayError = error !== undefined ? error : localError;

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>{t('identity.magicLink.title')}</AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{t('identity.magicLink.subtitle')}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        {sent ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title={t('identity.magicLink.checkEmailTitle')}>
              {t('identity.magicLink.sentPrefix')}
              <strong>{email}</strong>
              {t('identity.magicLink.sentSuffix')}
            </Alert>
            <Text size="sm" tone="muted" className="text-center">
              {t('identity.magicLink.spamHint')}
            </Text>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setSent(false);
              }}
            >
              {t('identity.magicLink.tryAgain')}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label={t('identity.magicLink.emailLabel')}
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEmail(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder={t('identity.magicLink.emailPlaceholder')}
            />

            {displayError !== null && displayError.length > 0 && (
              <AuthFormLayout.Error>{displayError}</AuthFormLayout.Error>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading === true
                ? t('identity.magicLink.sending')
                : t('identity.magicLink.submit')}
            </Button>
          </form>
        )}

        <AuthFormLayout.Footer>
          {t('identity.magicLink.preferPasswordPrefix')}
          {onModeChange !== undefined ? (
            <Button
              variant="text"
              onClick={() => {
                onModeChange('login');
              }}
              size="inline"
            >
              {t('identity.magicLink.signInLink')}
            </Button>
          ) : (
            <Link to="/auth?mode=login">{t('identity.magicLink.signInLink')}</Link>
          )}
        </AuthFormLayout.Footer>
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};

// ============================================================================
// 4. EmailOtpForm
// ============================================================================

interface EmailOtpFormProps {
  onRequestEmailOtp?: (data: EmailOtpRequest) => Promise<void>;
  onVerifyEmailOtp?: (data: EmailOtpVerifyRequest) => Promise<{ isNewUser: boolean }>;
  onCompleteOnboarding?: (data: CompleteOnboardingRequest) => Promise<void>;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

type OtpStep = 'email' | 'code' | 'onboarding';

export const EmailOtpForm = ({
  onRequestEmailOtp,
  onVerifyEmailOtp,
  onCompleteOnboarding,
  onModeChange,
  isLoading,
  error,
}: EmailOtpFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [step, setStep] = useState<OtpStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [attestationRequired, setAttestationRequired] = useState(false);
  const [eligibilityAttested, setEligibilityAttested] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleRequest = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onRequestEmailOtp === undefined) return;
    setLocalError(null);
    try {
      await onRequestEmailOtp({ email });
      setStep('code');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const handleVerify = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onVerifyEmailOtp === undefined) return;
    setLocalError(null);
    try {
      const { isNewUser } = await onVerifyEmailOtp({
        email,
        code,
        ...(eligibilityAttested ? { eligibilityAttested: true, tosAccepted: true } : {}),
      });
      if (isNewUser) setStep('onboarding');
    } catch (err) {
      if (isEligibilityAttestationRequired(err)) {
        setAttestationRequired(true);
        return;
      }
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const handleCompleteOnboarding = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onCompleteOnboarding === undefined) return;
    setLocalError(null);
    try {
      await onCompleteOnboarding({ firstName, lastName, username, password });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const resend = async (): Promise<void> => {
    if (onRequestEmailOtp === undefined) return;
    setCode('');
    setLocalError(null);
    try {
      await onRequestEmailOtp({ email });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const displayError = error !== undefined ? error : localError;
  const errorBlock =
    displayError !== null && displayError.length > 0 ? (
      <AuthFormLayout.Error>{displayError}</AuthFormLayout.Error>
    ) : null;

  const subtitle =
    step === 'email'
      ? t('identity.otp.emailSubtitle')
      : step === 'code'
        ? t('identity.otp.codeSubtitle')
        : t('identity.otp.onboardingSubtitle');

  const onboardingComplete =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    username.trim().length >= 2 &&
    password.length > 0;

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>
            {step === 'onboarding'
              ? t('identity.otp.onboardingTitle')
              : t('identity.otp.signInTitle')}
          </AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{subtitle}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        {step === 'email' && (
          <form
            onSubmit={(e) => {
              void handleRequest(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label={t('identity.otp.emailLabel')}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEmail(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder={t('identity.otp.emailPlaceholder')}
            />

            {errorBlock}

            <Button type="submit" className="w-full mt-2" disabled={isLoading}>
              {isLoading === true ? t('identity.otp.sending') : t('identity.otp.sendCode')}
            </Button>
          </form>
        )}

        {step === 'code' && (
          <form
            onSubmit={(e) => {
              void handleVerify(e);
            }}
            className="auth-form-fields"
          >
            <Alert tone="success" title={t('identity.otp.checkEmailTitle')}>
              {t('identity.otp.sentPrefix')}
              <strong>{email}</strong>
              {t('identity.otp.sentSuffix')}
            </Alert>

            <Input.Field
              label={t('identity.otp.codeLabel')}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setCode(e.target.value.replace(/\D/g, ''));
              }}
              required
              disabled={isLoading}
              placeholder={t('identity.otp.codePlaceholder')}
            />

            {attestationRequired && (
              <div className="auth-form-consent">
                <Checkbox
                  id="otp-eligibility"
                  checked={eligibilityAttested}
                  onChange={setEligibilityAttested}
                  required
                  disabled={isLoading}
                  aria-label={SIGNUP_ATTESTATION_STATEMENT}
                  aria-describedby="otp-eligibility-description"
                />
                <p id="otp-eligibility-description" className="auth-form-consent__copy">
                  {SIGNUP_ATTESTATION_STATEMENT}
                </p>
              </div>
            )}

            {errorBlock}

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={
                isLoading || code.length !== 6 || (attestationRequired && !eligibilityAttested)
              }
            >
              {isLoading === true
                ? t('identity.otp.verifying')
                : attestationRequired
                  ? t('identity.otp.createAccount')
                  : t('identity.otp.verifyAndSignIn')}
            </Button>

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="text"
                size="inline"
                disabled={isLoading}
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setAttestationRequired(false);
                  setEligibilityAttested(false);
                }}
              >
                {t('identity.otp.differentEmail')}
              </Button>
              <Button
                variant="text"
                size="inline"
                disabled={isLoading}
                onClick={() => {
                  void resend();
                }}
              >
                {t('identity.otp.resendCode')}
              </Button>
            </div>

            <Text size="sm" tone="muted" className="text-center">
              {t('identity.otp.spamHint')}
            </Text>
          </form>
        )}

        {step === 'onboarding' && (
          <form
            onSubmit={(e) => {
              void handleCompleteOnboarding(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label={t('identity.otp.firstNameLabel')}
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setFirstName(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder={t('identity.otp.firstNamePlaceholder')}
            />

            <Input.Field
              label={t('identity.otp.lastNameLabel')}
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setLastName(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder={t('identity.otp.lastNamePlaceholder')}
            />

            <Input.Field
              label={t('identity.otp.usernameLabel')}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setUsername(e.target.value);
              }}
              required
              minLength={2}
              disabled={isLoading}
              placeholder={t('identity.otp.usernamePlaceholder')}
            />

            <Input.Field
              label={t('identity.otp.passwordLabel')}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPassword(e.target.value);
              }}
              required
              disabled={isLoading}
              placeholder={t('identity.otp.passwordPlaceholder')}
              description={t('identity.otp.passwordDescription')}
            />

            {errorBlock}

            <Button
              type="submit"
              className="w-full mt-2"
              disabled={isLoading || !onboardingComplete}
            >
              {isLoading === true
                ? t('identity.otp.creatingAccount')
                : t('identity.otp.createAccount')}
            </Button>
          </form>
        )}

        {step !== 'onboarding' && (
          <AuthFormLayout.Footer>
            {t('identity.otp.preferPasswordPrefix')}
            {onModeChange !== undefined ? (
              <Button
                variant="text"
                size="inline"
                onClick={() => {
                  onModeChange('login');
                }}
              >
                {t('identity.otp.signInLink')}
              </Button>
            ) : (
              <Link to="/auth?mode=login">{t('identity.otp.signInLink')}</Link>
            )}
          </AuthFormLayout.Footer>
        )}
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};
