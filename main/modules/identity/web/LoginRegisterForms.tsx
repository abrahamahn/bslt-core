// main/modules/identity/web/LoginRegisterForms.tsx
import {
  useCallback,
  useState,
  type ChangeEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react';

import { useResendCooldown, type AuthMode } from '@bslt/react/hooks';
import { Link, useNavigate } from '@bslt/react/router';
import {
  Alert,
  AuthFormLayout,
  Button,
  Checkbox,
  Icon,
  Input,
  PasswordInput,
  Spinner,
  Text,
} from '@bslt/ui';
import { useCapabilities, useModuleMessages } from '@bslt/web-platform';

import { SIGNUP_ATTESTATION_STATEMENT } from '../contract';
import enUsMessages from '../i18n/en-US.json';

import {
  AccountLockedMessage,
  OAuthButtons,
  PasskeyLoginButton,
  SmsChallenge,
  TurnstileWidget,
} from './AuthPrimitives';
import {
  getPostLoginRedirect,
  SmsChallengeError,
  TotpChallengeError,
  useAuth,
} from './authService';
import { DemoQuickLogin, isDemoModeEnabled } from './DemoQuickLogin';

import type {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
} from '../contract';

// ============================================================================
// 1. LoginForm
// ============================================================================

const blurActiveElement = (): void => {
  if (typeof document === 'undefined') return;
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }
};

function getFormStringValue(formData: FormData, name: string, fallback: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : fallback;
}

interface LoginFormProps {
  onLogin?: (data: LoginRequest) => Promise<void>;
  onForgotPassword?: (data: ForgotPasswordRequest) => Promise<void>;
  onTotpVerify?: (challengeToken: string, code: string) => Promise<void>;
  onSmsVerify?: (challengeToken: string, code: string) => Promise<void>;
  onSmsSendCode?: (challengeToken: string) => Promise<void>;
  onSuccess?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

export const LoginForm = ({
  onLogin,
  onForgotPassword,
  onTotpVerify,
  onSmsVerify,
  onSmsSendCode,
  onModeChange,
  isLoading,
  error,
  onSuccess,
}: LoginFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState<string | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);
  const [smsChallenge, setSmsChallenge] = useState<string | null>(null);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [ssoPromptUrl, setSsoPromptUrl] = useState<string | null>(null);
  const [ssoMode, setSsoMode] = useState(false);
  const [ssoEmail, setSsoEmail] = useState('');
  const [ssoChecking, setSsoChecking] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const { hasAuthStrategy, isFlagEnabled } = useCapabilities();
  const advancedAuthEnabled = hasAuthStrategy('magic');
  const demoModeEnabled = isFlagEnabled('identity.demo_mode') || isDemoModeEnabled();
  const enterpriseSsoEnabled = isFlagEnabled('orgs.teams');

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const submitCredentials = async (
    submittedIdentifier: string,
    submittedPassword: string,
  ): Promise<void> => {
    if (onLogin === undefined) return;

    setIdentifier(submittedIdentifier);
    setPassword(submittedPassword);
    blurActiveElement();

    setLockReason(null);
    setLockedUntil(null);
    setSsoPromptUrl(null);

    try {
      await onLogin({
        identifier: submittedIdentifier,
        password: submittedPassword,
        ...(captchaToken !== undefined ? { captchaToken } : {}),
        rememberMe,
      });
      onSuccess?.();
    } catch (err) {
      if (err instanceof TotpChallengeError) {
        setTotpChallenge(err.challengeToken);
        setTotpError(null);
        return;
      }
      if (err instanceof SmsChallengeError) {
        setSmsChallenge(err.challengeToken);
        return;
      }
      if (err !== null && typeof err === 'object') {
        const errObj = err as {
          lockReason?: string;
          lockedUntil?: string;
          code?: string;
          details?: { initiateUrl?: string };
        };
        if (typeof errObj.lockReason === 'string') {
          setLockReason(errObj.lockReason);
        }
        if (typeof errObj.lockedUntil === 'string') {
          setLockedUntil(errObj.lockedUntil);
        }
        if (
          typeof errObj.details?.initiateUrl === 'string' &&
          errObj.details.initiateUrl.startsWith('/api/auth/sso/')
        ) {
          setSsoPromptUrl(errObj.details.initiateUrl);
        }
      }
    }
  };

  const handleEnterpriseSsoSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmedEmail = ssoEmail.trim();
    if (!trimmedEmail.includes('@')) return;
    setSsoChecking(true);
    setSsoError(null);
    try {
      const response = await fetch('/api/auth/sso/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      if (!response.ok) {
        setSsoError(t('identity.login.ssoFailed'));
        return;
      }
      const data = (await response.json()) as {
        readonly ssoAvailable?: boolean;
        readonly initiateUrl?: string;
      };
      if (data.ssoAvailable === true && typeof data.initiateUrl === 'string') {
        const target = `${data.initiateUrl}?loginHint=${encodeURIComponent(trimmedEmail)}`;
        window.location.assign(target);
        return;
      }
      setSsoError(t('identity.login.ssoNotFound'));
    } catch {
      setSsoError(t('identity.login.ssoFailed'));
    } finally {
      setSsoChecking(false);
    }
  };

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onLogin === undefined) return;

    const formData = new FormData(e.currentTarget);
    const submittedIdentifier = getFormStringValue(formData, 'username', identifier);
    const submittedPassword = getFormStringValue(formData, 'password', password);
    await submitCredentials(submittedIdentifier, submittedPassword);
  };

  const handleTotpSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (totpChallenge === null || onTotpVerify === undefined) return;

    setTotpLoading(true);
    setTotpError(null);

    try {
      await onTotpVerify(totpChallenge, totpCode);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('identity.login.totpInvalidFallback');
      setTotpError(message);
    } finally {
      setTotpLoading(false);
    }
  };

  const handleBackToLogin = (): void => {
    setTotpChallenge(null);
    setTotpCode('');
    setTotpError(null);
    setSmsChallenge(null);
  };

  const handleSmsVerify = useCallback(
    async (challengeToken: string, code: string): Promise<void> => {
      if (onSmsVerify === undefined) return;
      await onSmsVerify(challengeToken, code);
      onSuccess?.();
    },
    [onSmsVerify, onSuccess],
  );

  const handleSmsSendCode = useCallback(
    async (challengeToken: string): Promise<void> => {
      if (onSmsSendCode === undefined) return;
      await onSmsSendCode(challengeToken);
    },
    [onSmsSendCode],
  );

  const handleForgotPassword = (): void => {
    const emailValue = identifier.includes('@') ? identifier : '';
    if (emailValue.length > 0) {
      void onForgotPassword?.({ email: emailValue });
    }
    if (onModeChange !== undefined) {
      onModeChange('forgot-password');
    }
  };

  if (totpChallenge !== null) {
    return (
      <AuthFormLayout>
        <AuthFormLayout.Content>
          <AuthFormLayout.Header>
            <AuthFormLayout.Title>{t('identity.login.totpTitle')}</AuthFormLayout.Title>
            <AuthFormLayout.Subtitle>{t('identity.login.totpSubtitle')}</AuthFormLayout.Subtitle>
          </AuthFormLayout.Header>

          <form
            onSubmit={(e) => {
              void handleTotpSubmit(e);
            }}
            className="auth-form-fields"
          >
            <Input.Field
              label={t('identity.login.totpCodeLabel')}
              type="text"
              value={totpCode}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setTotpCode(e.target.value);
              }}
              required
              disabled={totpLoading}
              placeholder={t('identity.login.totpCodePlaceholder')}
              maxLength={8}
              autoComplete="one-time-code"
            />

            <Text size="xs" tone="muted">
              {t('identity.login.totpBackupHint')}
            </Text>

            {totpError !== null && <AuthFormLayout.Error>{totpError}</AuthFormLayout.Error>}

            <Button type="submit" className="w-full" disabled={totpLoading || totpCode.length < 6}>
              {totpLoading ? t('identity.login.totpVerifying') : t('identity.login.totpVerify')}
            </Button>
          </form>

          <div className="text-center">
            <Button variant="text" onClick={handleBackToLogin} disabled={totpLoading}>
              {t('identity.login.backToLogin')}
            </Button>
          </div>
        </AuthFormLayout.Content>
      </AuthFormLayout>
    );
  }

  if (smsChallenge !== null) {
    return (
      <AuthFormLayout>
        <AuthFormLayout.Content>
          <SmsChallenge
            challengeToken={smsChallenge}
            onVerify={handleSmsVerify}
            onSendCode={handleSmsSendCode}
            onCancel={handleBackToLogin}
          />
        </AuthFormLayout.Content>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>{t('identity.login.title')}</AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{t('identity.login.subtitle')}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        <OAuthButtons mode="login" {...(isLoading !== undefined && { disabled: isLoading })} />

        <PasskeyLoginButton onSuccess={onSuccess} disabled={isLoading} />

        <DemoQuickLogin
          enabled={demoModeEnabled}
          disabled={isLoading}
          onSelect={(email, demoPassword) => {
            void submitCredentials(email, demoPassword);
          }}
        />

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="auth-form-fields"
        >
          <Input.Field
            label={t('identity.login.identifierLabel')}
            id="login-identifier"
            name="username"
            type="text"
            value={identifier}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setIdentifier(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder={t('identity.login.identifierPlaceholder')}
            autoComplete="username"
          />

          <PasswordInput
            label={t('identity.login.passwordLabel')}
            id="login-password"
            name="password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPassword(e.target.value);
            }}
            required
            disabled={isLoading}
            autoComplete="current-password"
          />

          <Checkbox
            id="login-remember-me"
            name="rememberMe"
            checked={rememberMe}
            onChange={setRememberMe}
            disabled={isLoading}
            label={t('identity.login.rememberMeLabel')}
          />

          {error !== undefined && error !== null && (
            <>
              <AuthFormLayout.Error>{error}</AuthFormLayout.Error>
              {(lockReason !== null || lockedUntil !== null) && (
                <AccountLockedMessage lockReason={lockReason} lockedUntil={lockedUntil} />
              )}
            </>
          )}

          {ssoPromptUrl !== null && (
            <Alert tone="info">
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="small"
                  onClick={() => {
                    window.location.assign(
                      `${ssoPromptUrl}${identifier.includes('@') ? `?loginHint=${encodeURIComponent(identifier.trim())}` : ''}`,
                    );
                  }}
                >
                  {t('identity.login.ssoRequiredAction')}
                </Button>
              </div>
            </Alert>
          )}

          <TurnstileWidget onToken={handleCaptchaToken} />

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading === true ? (
              <Text as="span" className="flex items-center gap-2">
                <Spinner size="0.875rem" />
                {t('identity.login.signingIn')}
              </Text>
            ) : (
              t('identity.login.submit')
            )}
          </Button>
        </form>

        {enterpriseSsoEnabled && (
          <div className="flex flex-col gap-2" data-testid="enterprise-sso-section">
            {!ssoMode ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={isLoading}
                onClick={() => {
                  setSsoMode(true);
                  setSsoError(null);
                  if (identifier.includes('@')) {
                    setSsoEmail(identifier.trim());
                  }
                }}
              >
                {t('identity.login.ssoButton')}
              </Button>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  void handleEnterpriseSsoSubmit(e);
                }}
              >
                <Input.Field
                  label={t('identity.login.ssoEmailLabel')}
                  type="email"
                  value={ssoEmail}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setSsoEmail(e.target.value);
                  }}
                  placeholder={t('identity.login.ssoEmailPlaceholder')}
                  required
                  disabled={ssoChecking}
                />
                {ssoError !== null && <AuthFormLayout.Error>{ssoError}</AuthFormLayout.Error>}
                <Button
                  type="submit"
                  variant="secondary"
                  className="w-full"
                  disabled={ssoChecking || !ssoEmail.includes('@')}
                >
                  {ssoChecking ? t('identity.login.ssoChecking') : t('identity.login.ssoContinue')}
                </Button>
              </form>
            )}
          </div>
        )}

        {advancedAuthEnabled && onModeChange !== undefined && (
          <Button
            variant="text"
            className="w-full"
            onClick={() => {
              onModeChange('email-otp');
            }}
            disabled={isLoading}
          >
            {t('identity.login.oneTimeCode')}
          </Button>
        )}

        <div className="text-center">
          <Button variant="text" onClick={handleForgotPassword} disabled={isLoading}>
            {t('identity.login.forgotPassword')}
          </Button>
        </div>

        <AuthFormLayout.Footer>
          {t('identity.login.noAccountPrefix')}
          {onModeChange !== undefined ? (
            <Button
              variant="text"
              onClick={() => {
                onModeChange('register');
              }}
              size="inline"
              disabled={isLoading === true}
            >
              {t('identity.login.signUpLink')}
            </Button>
          ) : (
            <Link to="/auth?mode=register">{t('identity.login.signUpLink')}</Link>
          )}
        </AuthFormLayout.Footer>
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};

// ============================================================================
// 2. RegisterForm
// ============================================================================

interface RegisterFormProps {
  onRegister?: (data: RegisterRequest) => Promise<RegisterResponse>;
  onResendVerification?: (data: ResendVerificationRequest) => Promise<void>;
  onSuccess?: () => void;
  onModeChange?: (mode: AuthMode) => void;
  isLoading?: boolean;
  error?: string | null;
}

export const RegisterForm = ({
  onRegister,
  onResendVerification,
  onModeChange,
  isLoading,
  error,
}: RegisterFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [eligibilityAttested, setEligibilityAttested] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [registrationResult, setRegistrationResult] = useState<RegisterResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sent' | 'failed'>('idle');
  const { cooldown, isOnCooldown, startCooldown } = useResendCooldown();
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const handleCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (onRegister === undefined) return;
    setLocalError(null);

    try {
      const result = await onRegister({
        email,
        username,
        firstName,
        lastName,
        password,
        tosAccepted,
        eligibilityAttested,
        ...(captchaToken !== undefined ? { captchaToken } : {}),
      });

      if (result.status === 'verified') {
        try {
          await login({ identifier: email, password });
          navigate(getPostLoginRedirect(user));
          return;
        } catch {
          setRegistrationResult(result);
          return;
        }
      }

      setRegistrationResult(result);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : null);
    }
  };

  const handleResend = async (): Promise<void> => {
    if (
      onResendVerification === undefined ||
      registrationResult === null ||
      registrationResult.email.length === 0 ||
      isOnCooldown
    ) {
      return;
    }

    setResendLoading(true);
    setResendState('idle');
    try {
      await onResendVerification({ email: registrationResult.email });
      setResendState('sent');
      startCooldown();
    } catch {
      setResendState('failed');
    } finally {
      setResendLoading(false);
    }
  };

  if (registrationResult !== null) {
    return (
      <AuthFormLayout>
        <AuthFormLayout.Content>
          <AuthFormLayout.Header>
            <AuthFormLayout.Title>{t('identity.register.checkEmailTitle')}</AuthFormLayout.Title>
          </AuthFormLayout.Header>

          <div className="status-icon bg-success-muted mx-auto">
            <Icon name="mail" size="lg" className="text-success" />
          </div>

          <Text tone="muted" className="text-center">
            {registrationResult.message.length > 0
              ? registrationResult.message
              : t('identity.register.checkEmailFallback')}
          </Text>

          <Text tone="muted" className="text-xs text-center">
            {t('identity.register.sentToPrefix')}
            <Text as="strong">
              {registrationResult.email.length > 0 ? registrationResult.email : email}
            </Text>
          </Text>

          {resendState !== 'idle' && (
            <Text
              tone={resendState === 'failed' ? 'danger' : 'success'}
              className="text-sm text-center"
            >
              {resendState === 'failed'
                ? t('identity.register.resendFailed')
                : t('identity.register.resendSuccess')}
            </Text>
          )}

          {onResendVerification !== undefined && (
            <div className="text-center">
              <Button
                variant="text"
                onClick={() => {
                  void handleResend();
                }}
                disabled={resendLoading || isOnCooldown}
              >
                {resendLoading
                  ? t('identity.register.resending')
                  : isOnCooldown
                    ? t('identity.register.resendCountdown').replace(
                        '{seconds}',
                        cooldown.toString(),
                      )
                    : t('identity.register.resendAction')}
              </Button>
            </div>
          )}

          <AuthFormLayout.Footer>
            {t('identity.register.alreadyVerifiedPrefix')}
            {onModeChange !== undefined ? (
              <Button
                variant="text"
                onClick={() => {
                  onModeChange('login');
                }}
                size="inline"
                disabled={isLoading === true}
              >
                {t('identity.register.signInLink')}
              </Button>
            ) : (
              <Link to="/auth?mode=login">{t('identity.register.signInLink')}</Link>
            )}
          </AuthFormLayout.Footer>
        </AuthFormLayout.Content>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout>
      <AuthFormLayout.Content>
        <AuthFormLayout.Header>
          <AuthFormLayout.Title>{t('identity.register.title')}</AuthFormLayout.Title>
          <AuthFormLayout.Subtitle>{t('identity.register.subtitle')}</AuthFormLayout.Subtitle>
        </AuthFormLayout.Header>

        <OAuthButtons
          mode="register"
          eligibilityAttested={tosAccepted && eligibilityAttested}
          {...((isLoading === true || !tosAccepted || !eligibilityAttested) && { disabled: true })}
        />

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="auth-form-fields"
        >
          <Input.Field
            label={t('identity.register.emailLabel')}
            id="register-email"
            name="email"
            type="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setEmail(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder={t('identity.register.emailPlaceholder')}
            autoComplete="email"
          />

          <Input.Field
            label={t('identity.register.usernameLabel')}
            id="register-username"
            name="username"
            type="text"
            value={username}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setUsername(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder={t('identity.register.usernamePlaceholder')}
            autoComplete="username"
          />

          <Input.Field
            label={t('identity.register.firstNameLabel')}
            id="register-first-name"
            name="given-name"
            type="text"
            value={firstName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setFirstName(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder={t('identity.register.firstNamePlaceholder')}
            autoComplete="given-name"
          />

          <Input.Field
            label={t('identity.register.lastNameLabel')}
            id="register-last-name"
            name="family-name"
            type="text"
            value={lastName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setLastName(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder={t('identity.register.lastNamePlaceholder')}
            autoComplete="family-name"
          />

          <PasswordInput
            label={t('identity.register.passwordLabel')}
            id="register-password"
            name="new-password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPassword(e.target.value);
            }}
            required
            disabled={isLoading}
            placeholder={t('identity.register.passwordPlaceholder')}
            autoComplete="new-password"
          />

          <div className="auth-form-consent">
            <Checkbox
              id="register-tos"
              checked={tosAccepted}
              onChange={setTosAccepted}
              required
              disabled={isLoading}
              aria-label={t('identity.register.tosAria')}
              aria-describedby="register-tos-description"
            />
            <p id="register-tos-description" className="auth-form-consent__copy">
              {t('identity.register.tosPrefix')}
              <Link to="/terms">{t('identity.register.tosTerms')}</Link>
              {t('identity.register.tosMiddle')}
              <Link to="/privacy">{t('identity.register.tosPrivacy')}</Link>
              {t('identity.register.tosSuffix')}
            </p>
          </div>

          <div className="auth-form-consent">
            <Checkbox
              id="register-eligibility"
              checked={eligibilityAttested}
              onChange={setEligibilityAttested}
              required
              disabled={isLoading}
              aria-label={SIGNUP_ATTESTATION_STATEMENT}
              aria-describedby="register-eligibility-description"
            />
            <p id="register-eligibility-description" className="auth-form-consent__copy">
              {SIGNUP_ATTESTATION_STATEMENT}
            </p>
          </div>

          {(error !== undefined ? error : localError) !== null && (
            <AuthFormLayout.Error>{error !== undefined ? error : localError}</AuthFormLayout.Error>
          )}

          <TurnstileWidget onToken={handleCaptchaToken} />

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !tosAccepted || !eligibilityAttested}
          >
            {isLoading === true ? (
              <Text as="span" className="flex items-center gap-2">
                <Spinner size="0.875rem" />
                {t('identity.register.creating')}
              </Text>
            ) : (
              t('identity.register.submit')
            )}
          </Button>
        </form>

        <AuthFormLayout.Footer>
          {t('identity.register.haveAccountPrefix')}
          {onModeChange !== undefined ? (
            <Button
              variant="text"
              onClick={() => {
                onModeChange('login');
              }}
              size="inline"
              disabled={isLoading === true}
            >
              {t('identity.register.signInLink')}
            </Button>
          ) : (
            <Link to="/auth?mode=login">{t('identity.register.signInLink')}</Link>
          )}
        </AuthFormLayout.Footer>
      </AuthFormLayout.Content>
    </AuthFormLayout>
  );
};
