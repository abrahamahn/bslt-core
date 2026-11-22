// main/modules/identity/web/AuthPages.tsx
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { toastStore } from '@bslt/react';
import { useAuthModeNavigation, useFormState, type AuthMode } from '@bslt/react/hooks';
import { Link, useLocation, useNavigate, useSearchParams } from '@bslt/react/router';
import { Alert, AuthLayout, Button, Checkbox, Heading, Spinner, Text } from '@bslt/ui';
import { useCapabilities, useModuleMessages } from '@bslt/web-platform';

import { getAccountStatus, SIGNUP_ATTESTATION_STATEMENT } from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { AuthForm, type AuthFormProps } from './AuthModal';
import {
  closeAuthModal,
  getPostLoginRedirect,
  isEligibilityAttestationRequired,
  openAuthModal,
  useAuth,
  useAuthModal,
  useOptionalAuthService,
  useVerifyEmail,
} from './authService';
import { useConfirmEmailChange, useReactivateAccount, useRevertEmailChange } from './hooks';

// ============================================================================
// 1. Auth Modal URL Stubs (/login, /register, /auth)
// ============================================================================

const VALID_MODES: readonly AuthMode[] = [
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'magic-link',
  'email-otp',
];

const ADVANCED_ONLY_MODES: readonly AuthMode[] = ['magic-link', 'email-otp'];

function isValidMode(value: string | null): value is AuthMode {
  return value !== null && (VALID_MODES as readonly string[]).includes(value);
}

const useAuthModalRoute = (mode: AuthMode): ReactElement => {
  const { user, isAuthenticated } = useAuth();
  const { open } = useAuthModal();
  const { status: capabilitiesStatus } = useCapabilities();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const wasOpened = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(getPostLoginRedirect(user, returnTo), { replace: true });
      return;
    }
    if (capabilitiesStatus === 'loading') {
      return;
    }
    openAuthModal(mode);
  }, [capabilitiesStatus, isAuthenticated, mode, navigate, returnTo, user]);

  useEffect(() => closeAuthModal, []);

  useEffect(() => {
    if (open) {
      wasOpened.current = true;
      return;
    }
    if (wasOpened.current && !isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate, open]);

  return <div data-testid="auth-modal-backdrop" />;
};

export const LoginModalRoute = (): ReactElement => useAuthModalRoute('login');

export const RegisterModalRoute = (): ReactElement => useAuthModalRoute('register');

export const AuthQueryModalRoute = (): ReactElement | null => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.loginTitle');
  void t('identity.routes.registerTitle');
  void t('identity.routes.authTitle');

  const { search } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const { hasAuthStrategy } = useCapabilities();
  const advancedAuthEnabled = hasAuthStrategy('magic');

  const requested: AuthMode =
    isValidMode(modeParam) && (!ADVANCED_ONLY_MODES.includes(modeParam) || advancedAuthEnabled)
      ? modeParam
      : 'login';

  const isResetPassword = requested === 'reset-password';

  useEffect(() => {
    if (isResetPassword) {
      const params = new URLSearchParams(search);
      params.delete('mode');
      const query = params.toString();
      navigate(`/auth/reset-password${query === '' ? '' : `?${query}`}`, { replace: true });
    }
  }, [isResetPassword, navigate, search]);

  const element = useAuthModalRoute(isResetPassword ? 'login' : requested);
  return isResetPassword ? null : element;
};

// ============================================================================
// 2. ResetPasswordPage (/auth/reset-password)
// ============================================================================

export const ResetPasswordPage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.resetPasswordTitle');
  const [searchParams] = useSearchParams();
  const { resetPassword } = useAuth();
  const { isLoading, error, wrapHandler } = useFormState();
  const { navigateToMode, navigateToLogin } = useAuthModeNavigation();

  const token = searchParams.get('token');

  const handleResetPassword = wrapHandler(
    async (data: { token: string; password: string }): Promise<void> => {
      await resetPassword(data);
      toastStore.getState().show({
        title: t('identity.reset.toastTitle'),
        description: t('identity.reset.toastDescription'),
      });
      navigateToLogin();
    },
  );

  const formProps: AuthFormProps = {
    mode: 'reset-password',
    onResetPassword: handleResetPassword,
    onModeChange: navigateToMode,
    ...(token !== null && { initialData: { token } }),
    isLoading,
    error,
  };

  return (
    <AuthLayout>
      <AuthForm {...formProps} />
    </AuthLayout>
  );
};

// ============================================================================
// 3. ConfirmEmailPage (/auth/confirm-email)
// ============================================================================

export const ConfirmEmailPage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.confirmEmailTitle');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { mutate: verifyEmail } = useVerifyEmail();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const token = searchParams.get('token');
  const verifyStarted = useRef(false);

  useEffect(() => {
    if (token === null) {
      queueMicrotask(() => {
        setStatus('error');
        setMessage(t('identity.confirmEmail.invalidLink'));
      });
      return;
    }

    if (verifyStarted.current) return;
    verifyStarted.current = true;

    const verify = async (): Promise<void> => {
      try {
        await verifyEmail({ token });
        setStatus('success');
        setMessage(t('identity.confirmEmail.verifiedMessage'));
        const redirectPath = getPostLoginRedirect(user);
        setTimeout(() => {
          navigate(redirectPath);
        }, 2000);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : t('identity.confirmEmail.failedFallback'));
      }
    };

    void verify();
  }, [token, verifyEmail, navigate, user, t]);

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          {status === 'loading' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  {t('identity.confirmEmail.loadingHeading')}
                </Heading>
              </div>
              <div className="flex-center">
                <Spinner size="lg" />
              </div>
              <Text tone="muted" className="text-center">
                {t('identity.confirmEmail.loadingBody')}
              </Text>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-success">
                  {t('identity.confirmEmail.successHeading')}
                </Heading>
              </div>
              <Alert tone="success" title={t('identity.confirmEmail.successAlertTitle')}>
                {t('identity.confirmEmail.successAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              <Text tone="muted" className="text-center text-sm">
                {t('identity.confirmEmail.redirecting')}
              </Text>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-danger">
                  {t('identity.confirmEmail.errorHeading')}
                </Heading>
              </div>
              <Alert tone="danger" title={t('identity.confirmEmail.errorHeading')}>
                {t('identity.confirmEmail.errorAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              <Button
                onClick={() => {
                  navigate('/login');
                }}
                className="w-full"
              >
                {t('identity.confirmEmail.goToSignIn')}
              </Button>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

// ============================================================================
// 4. ConfirmEmailChangePage (/auth/change-email/confirm)
// ============================================================================

export const ConfirmEmailChangePage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.confirmEmailChangeTitle');
  const confirmEmailChange = useConfirmEmailChange();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const token = searchParams.get('token');

  useEffect(() => {
    if (token === null) {
      queueMicrotask(() => {
        setStatus('error');
        setMessage(t('identity.confirmEmailChange.missingToken'));
      });
      return;
    }

    const confirm = async (): Promise<void> => {
      try {
        const result = await confirmEmailChange({ token });
        setStatus('success');
        setMessage(result.message);
        setNewEmail(result.email);
      } catch (err) {
        setStatus('error');
        setMessage(
          err instanceof Error ? err.message : t('identity.confirmEmailChange.failedFallback'),
        );
      }
    };

    void confirm();
  }, [confirmEmailChange, token, t]);

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          {status === 'loading' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  {t('identity.confirmEmailChange.loadingHeading')}
                </Heading>
              </div>
              <div className="flex-center">
                <Spinner size="lg" />
              </div>
              <Text tone="muted" className="text-center">
                {t('identity.confirmEmailChange.loadingBody')}
              </Text>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-success">
                  {t('identity.confirmEmailChange.successHeading')}
                </Heading>
              </div>
              <Alert tone="success" title={t('identity.confirmEmailChange.successAlertTitle')}>
                {t('identity.confirmEmailChange.successAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              {newEmail !== '' && (
                <Text tone="muted" className="text-center text-sm">
                  {t('identity.confirmEmailChange.nowPrefix')}
                  <strong>{newEmail}</strong>
                </Text>
              )}
              <Button
                onClick={() => {
                  navigate('/settings');
                }}
                className="w-full"
              >
                {t('identity.confirmEmailChange.goToSettings')}
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-danger">
                  {t('identity.confirmEmailChange.errorHeading')}
                </Heading>
              </div>
              <Alert tone="danger" title={t('identity.confirmEmailChange.errorHeading')}>
                {t('identity.confirmEmailChange.errorAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    navigate('/settings');
                  }}
                  className="flex-1"
                >
                  {t('identity.confirmEmailChange.goToSettings')}
                </Button>
                <Button
                  onClick={() => {
                    navigate('/login');
                  }}
                  variant="secondary"
                  className="flex-1"
                >
                  {t('identity.confirmEmailChange.goToSignIn')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

// ============================================================================
// 5. RevertEmailChangePage (/auth/change-email/revert)
// ============================================================================

export const RevertEmailChangePage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.revertEmailChangeTitle');
  const revertEmailChange = useRevertEmailChange();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  const token = searchParams.get('token');

  useEffect(() => {
    if (token === null) {
      queueMicrotask(() => {
        setStatus('error');
        setMessage(t('identity.revertEmailChange.missingToken'));
      });
      return;
    }

    const revert = async (): Promise<void> => {
      try {
        const result = await revertEmailChange({ token });
        setStatus('success');
        setMessage(result.message);
        setEmail(result.email);
      } catch (err) {
        setStatus('error');
        setMessage(
          err instanceof Error ? err.message : t('identity.revertEmailChange.failedFallback'),
        );
      }
    };

    void revert();
  }, [revertEmailChange, token, t]);

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          {status === 'loading' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  {t('identity.revertEmailChange.loadingHeading')}
                </Heading>
              </div>
              <div className="flex-center">
                <Spinner size="lg" />
              </div>
              <Text tone="muted" className="text-center">
                {t('identity.revertEmailChange.loadingBody')}
              </Text>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-success">
                  {t('identity.revertEmailChange.successHeading')}
                </Heading>
              </div>
              <Alert tone="success" title={t('identity.revertEmailChange.successHeading')}>
                {t('identity.revertEmailChange.successAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              {email !== '' && (
                <Text tone="muted" className="text-center text-sm">
                  {t('identity.revertEmailChange.nowPrefix')}
                  <strong>{email}</strong>
                </Text>
              )}
              <Text tone="muted" className="text-center text-sm">
                {t('identity.revertEmailChange.lockedPrefix')}
                <Link to="/support" className="underline">
                  {t('identity.revertEmailChange.supportLink')}
                </Link>
                {t('identity.revertEmailChange.lockedSuffix')}
              </Text>
              <Button
                onClick={() => {
                  navigate('/login');
                }}
                className="w-full"
              >
                {t('identity.revertEmailChange.goToLogin')}
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-danger">
                  {t('identity.revertEmailChange.errorHeading')}
                </Heading>
              </div>
              <Alert tone="danger" title={t('identity.revertEmailChange.errorHeading')}>
                {t('identity.revertEmailChange.errorAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              <Button
                onClick={() => {
                  navigate('/login');
                }}
                className="w-full"
              >
                {t('identity.revertEmailChange.goToLogin')}
              </Button>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

// ============================================================================
// 6. MagicLinkVerifyPage (/auth/magic-link/verify)
// ============================================================================

export const MagicLinkVerifyPage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.magicLinkVerifyTitle');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authService = useOptionalAuthService();

  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'attestation'>(
    token === null ? 'error' : 'loading',
  );
  const [message, setMessage] = useState(
    token === null ? t('identity.magicLinkVerify.missingToken') : '',
  );
  const [eligibilityAttested, setEligibilityAttested] = useState(false);

  const verifyStarted = useRef(false);

  const verify = useCallback(
    async (attested: boolean): Promise<void> => {
      if (token === null || authService === undefined) return;
      try {
        await authService.verifyMagicLink({
          token,
          ...(attested ? { eligibilityAttested: true, tosAccepted: true } : {}),
        });
        const state = authService.getState();
        setStatus('success');
        setMessage(t('identity.magicLinkVerify.signedInMessage'));
        const redirectPath = getPostLoginRedirect(state.user);
        setTimeout(() => {
          navigate(redirectPath);
        }, 2000);
      } catch (err) {
        if (isEligibilityAttestationRequired(err)) {
          setStatus('attestation');
          setMessage(err instanceof Error ? err.message : '');
          return;
        }
        setStatus('error');
        setMessage(
          err instanceof Error ? err.message : t('identity.magicLinkVerify.failedFallback'),
        );
      }
    },
    [token, authService, navigate, t],
  );

  useEffect(() => {
    if (token === null) return;
    if (verifyStarted.current) return;
    verifyStarted.current = true;
    void verify(false);
  }, [token, verify]);

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          {status === 'loading' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  {t('identity.magicLinkVerify.loadingHeading')}
                </Heading>
              </div>
              <div className="flex-center">
                <Spinner size="lg" />
              </div>
              <Text tone="muted" className="text-center">
                {t('identity.magicLinkVerify.loadingBody')}
              </Text>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-success">
                  {t('identity.magicLinkVerify.successHeading')}
                </Heading>
              </div>
              <Alert tone="success" title={t('identity.magicLinkVerify.successAlertTitle')}>
                {message}
              </Alert>
              <Text tone="muted" className="text-center text-sm">
                {t('identity.magicLinkVerify.redirecting')}
              </Text>
            </>
          )}

          {status === 'attestation' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title">
                  {t('identity.magicLinkVerify.attestationHeading')}
                </Heading>
              </div>
              <Text tone="muted" className="text-center">
                {t('identity.magicLinkVerify.attestationBody')}
              </Text>

              <div className="auth-form-consent">
                <Checkbox
                  id="magic-link-eligibility"
                  checked={eligibilityAttested}
                  onChange={setEligibilityAttested}
                  required
                  aria-label={SIGNUP_ATTESTATION_STATEMENT}
                  aria-describedby="magic-link-eligibility-description"
                />
                <p id="magic-link-eligibility-description" className="auth-form-consent__copy">
                  {SIGNUP_ATTESTATION_STATEMENT}
                </p>
              </div>

              <Button
                className="w-full"
                disabled={!eligibilityAttested}
                onClick={() => {
                  setStatus('loading');
                  void verify(true);
                }}
              >
                {t('identity.magicLinkVerify.createAccount')}
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="auth-form-header">
                <Heading as="h2" size="md" className="auth-form-title text-danger">
                  {t('identity.magicLinkVerify.errorHeading')}
                </Heading>
              </div>
              <Alert tone="danger" title={t('identity.magicLinkVerify.errorHeading')}>
                {t('identity.magicLinkVerify.errorAlertBody')}
              </Alert>
              <Text tone="muted" className="text-center">
                {message}
              </Text>
              <Button
                onClick={() => {
                  navigate('/login');
                }}
                className="w-full"
              >
                {t('identity.magicLinkVerify.goToSignIn')}
              </Button>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

// ============================================================================
// 7. ReactivatePromptPage (/reactivate)
// ============================================================================

const toLifecycleDate = (value: string | null | undefined): Date | null =>
  value != null ? new Date(value) : null;

export const ReactivatePromptPage = (): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  void t('identity.routes.reactivateTitle');
  const navigate = useNavigate();
  const { user, reloadUser, logout } = useAuth();

  const status =
    user !== null
      ? getAccountStatus({
          deactivatedAt: toLifecycleDate(user.deactivatedAt),
          deletedAt: toLifecycleDate(user.deletedAt),
          deletionGracePeriodEnds: toLifecycleDate(user.deletionGracePeriodEnds),
        })
      : 'active';

  const role = user?.role;
  const destination = getPostLoginRedirect(role != null ? { role } : null);

  useEffect(() => {
    if (user === null) {
      navigate('/login');
      return;
    }
    if (status === 'active') {
      navigate(destination);
    }
  }, [user, status, destination, navigate]);

  const { reactivate, isLoading, error } = useReactivateAccount({
    onSuccess: () => {
      void reloadUser().then(() => {
        navigate(destination);
      });
    },
  });

  const handleSignOut = (): void => {
    void logout().then(() => {
      navigate('/login');
    });
  };

  const isPendingDeletion = status === 'pending_deletion';
  const gracePeriodEnds = toLifecycleDate(user?.deletionGracePeriodEnds);

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-form-content">
          <div className="auth-form-header">
            <Heading as="h2" size="md" className="auth-form-title">
              {isPendingDeletion
                ? t('identity.reactivate.restoreHeading')
                : t('identity.reactivate.welcomeHeading')}
            </Heading>
          </div>

          <Alert
            tone={isPendingDeletion ? 'warning' : 'info'}
            title={t('identity.reactivate.inactiveTitle')}
          >
            {isPendingDeletion
              ? t('identity.reactivate.pendingDeletionBody')
              : t('identity.reactivate.deactivatedBody')}
          </Alert>

          {isPendingDeletion && gracePeriodEnds !== null && (
            <Text tone="muted" className="text-center text-sm">
              {t('identity.reactivate.scheduledFor').replace(
                '{date}',
                gracePeriodEnds.toLocaleDateString(),
              )}
            </Text>
          )}

          {error !== null && (
            <Alert tone="danger" title={t('identity.reactivate.failedTitle')}>
              {error.message}
            </Alert>
          )}

          <Button onClick={reactivate} disabled={isLoading} className="w-full">
            {isLoading
              ? t('identity.reactivate.reactivating')
              : t('identity.reactivate.reactivateAction')}
          </Button>

          <Button
            variant="secondary"
            onClick={handleSignOut}
            disabled={isLoading}
            className="w-full"
          >
            {t('identity.reactivate.signOutAction')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
};
