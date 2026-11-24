// main/modules/identity/web/AuthPrimitives.tsx
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
} from 'react';

import { toastStore } from '@bslt/react';
import { Link } from '@bslt/react/router';
import { Alert, AuthFormLayout, Button, Icon, Input, OAuthButton, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { useAuth, useLoginWithPasskey, useOptionalAuthService } from './authService';
import { getOAuthLoginUrl, useEnabledAuthStrategies, useEnabledOAuthProviders } from './hooks';

import type { OAuthProvider } from '../contract';

const MS_PER_SECOND = 1000;

// ============================================================================
// 1. OAuth Provider Icons
// ============================================================================

interface ProviderIconProps {
  className?: string | undefined;
}

export const GoogleIcon = ({ className }: ProviderIconProps): ReactElement => (
  <Icon name="oauth-google" className={className} />
);

export const GitHubIcon = ({ className }: ProviderIconProps): ReactElement => (
  <Icon name="oauth-github" className={className} />
);

export const AppleIcon = ({ className }: ProviderIconProps): ReactElement => (
  <Icon name="oauth-apple" className={className} />
);

// ============================================================================
// 2. OAuthButtons
// ============================================================================

interface OAuthButtonsProps {
  mode?: 'login' | 'register';
  disabled?: boolean | undefined;
  eligibilityAttested?: boolean;
  baseUrl?: string | undefined;
}

const PROVIDER_ICONS: Record<OAuthProvider, ComponentType<{ className?: string | undefined }>> = {
  google: GoogleIcon,
  github: GitHubIcon,
  apple: AppleIcon,
};

export const OAuthButtons = ({
  mode = 'login',
  disabled,
  eligibilityAttested = false,
  baseUrl,
}: OAuthButtonsProps): ReactElement | null => {
  const t = useModuleMessages(enUsMessages);
  const auth = useOptionalAuthService();
  const resolvedBaseUrl =
    baseUrl ?? (typeof auth?.getBaseUrl === 'function' ? auth.getBaseUrl() : '');

  const oauthState = useEnabledOAuthProviders();
  const providers = oauthState.providers.filter((provider) => provider in PROVIDER_ICONS);

  if (providers.length === 0 || oauthState.error !== null) {
    return null;
  }

  const getProviderLabel = (provider: OAuthProvider): string => {
    switch (provider) {
      case 'google':
        return t('identity.oauth.google');
      case 'github':
        return t('identity.oauth.github');
      case 'apple':
        return t('identity.oauth.apple');
    }
  };

  const actionText =
    mode === 'register' ? t('identity.oauth.signUpWith') : t('identity.oauth.continueWith');

  const handleOAuthClick = (provider: OAuthProvider): void => {
    const url = getOAuthLoginUrl(resolvedBaseUrl, provider, eligibilityAttested);
    window.location.assign(url);
  };

  return (
    <>
      <div className="oauth-buttons">
        {providers.map((provider) => {
          const IconComponent = PROVIDER_ICONS[provider];
          const label = getProviderLabel(provider);
          const buttonLabel = `${actionText} ${label}`;
          return (
            <OAuthButton
              key={provider}
              type="button"
              onClick={() => {
                handleOAuthClick(provider);
              }}
              disabled={disabled}
            >
              <IconComponent className="oauth-button-icon" />
              <Text as="span">{buttonLabel}</Text>
            </OAuthButton>
          );
        })}
      </div>
      <AuthFormLayout.Divider>{t('identity.oauth.orDivider')}</AuthFormLayout.Divider>
    </>
  );
};

// ============================================================================
// 3. PasskeyLoginButton
// ============================================================================

interface PasskeyLoginButtonProps {
  onSuccess?: (() => void) | undefined;
  disabled?: boolean | undefined;
}

export function PasskeyLoginButton({
  onSuccess,
  disabled,
}: PasskeyLoginButtonProps): ReactElement | null {
  const t = useModuleMessages(enUsMessages);
  const strategyState = useEnabledAuthStrategies();
  const { login, isLoading, error } = useLoginWithPasskey(onSuccess);

  const isWebAuthnSupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;
  if (!isWebAuthnSupported) {
    return null;
  }

  const passkeyEnabled =
    strategyState.error === null &&
    !strategyState.isLoading &&
    strategyState.enabled.includes('webauthn');

  if (!passkeyEnabled) return null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          void login();
        }}
        disabled={disabled === true || isLoading}
      >
        {isLoading ? t('identity.passkey.verifying') : t('identity.passkey.signInWith')}
      </Button>
      {error !== null && (
        <Text size="sm" className="text-danger text-center">
          {error}
        </Text>
      )}
    </div>
  );
}

// ============================================================================
// 4. TurnstileWidget
// ============================================================================

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  onError?: (() => void) | undefined;
  onExpire?: (() => void) | undefined;
  enabled?: boolean | undefined;
  siteKey?: string | undefined;
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  size?: 'invisible' | 'normal' | 'compact';
  theme?: 'light' | 'dark' | 'auto';
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const viteEnv = (import.meta as { readonly env?: Readonly<Record<string, unknown>> }).env;
const DEFAULT_CAPTCHA_ENABLED = viteEnv?.['VITE_CAPTCHA_ENABLED'] === 'true';
const DEFAULT_CAPTCHA_SITE_KEY =
  typeof viteEnv?.['VITE_CAPTCHA_SITE_KEY'] === 'string' ? viteEnv['VITE_CAPTCHA_SITE_KEY'] : '';

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let scriptLoaded = false;
let scriptLoading = false;

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptLoading) {
    return new Promise((resolve) => {
      const check = (): void => {
        if (scriptLoaded) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  scriptLoading = true;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = (): void => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
    };
    script.onerror = (): void => {
      scriptLoading = false;
      reject(new Error('Failed to load Turnstile script'));
    };
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  onToken,
  onError,
  onExpire,
  enabled = DEFAULT_CAPTCHA_ENABLED,
  siteKey = DEFAULT_CAPTCHA_SITE_KEY,
}: TurnstileWidgetProps): ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const handleToken = useCallback(
    (token: string): void => {
      onToken(token);
    },
    [onToken],
  );

  useEffect(() => {
    if (!enabled || siteKey === '') return;

    let mounted = true;

    const init = async (): Promise<void> => {
      try {
        await loadTurnstileScript();
      } catch {
        onError?.();
        return;
      }

      if (!mounted || containerRef.current === null || window.turnstile === undefined) return;

      const renderOptions: TurnstileRenderOptions = {
        sitekey: siteKey,
        callback: handleToken,
        size: 'invisible',
        theme: 'auto',
      };
      if (onError !== undefined) {
        renderOptions['error-callback'] = onError;
      }
      if (onExpire !== undefined) {
        renderOptions['expired-callback'] = onExpire;
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, renderOptions);
    };

    void init();

    return (): void => {
      mounted = false;
      if (widgetIdRef.current !== null && window.turnstile !== undefined) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [enabled, siteKey, handleToken, onError, onExpire]);

  if (!enabled || siteKey === '') {
    return null;
  }

  return <div ref={containerRef} />;
}

// ============================================================================
// 5. AccountLockedMessage
// ============================================================================

interface AccountLockedMessageProps {
  lockReason?: string | null | undefined;
  lockedUntil?: string | null | undefined;
}

export const AccountLockedMessage = ({
  lockReason,
  lockedUntil,
}: AccountLockedMessageProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const hasReason = lockReason !== undefined && lockReason !== null && lockReason.length > 0;
  const hasExpiry = lockedUntil !== undefined && lockedUntil !== null && lockedUntil.length > 0;

  const formatLockExpiry = (until: string): string => {
    const expiryDate = new Date(until);
    const now = new Date();

    if (expiryDate.getFullYear() > 2090) {
      return t('identity.locked.permanent');
    }
    if (expiryDate <= now) {
      return t('identity.locked.expired');
    }

    const diffMs = expiryDate.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 60) {
      const unit =
        diffMinutes === 1 ? t('identity.locked.unitMinute') : t('identity.locked.unitMinutes');
      return t('identity.locked.unlockMinutes')
        .replace('{count}', String(diffMinutes))
        .replace('{unit}', unit);
    }
    if (diffHours < 24) {
      const unit = diffHours === 1 ? t('identity.locked.unitHour') : t('identity.locked.unitHours');
      return t('identity.locked.unlockMinutes')
        .replace('{count}', String(diffHours))
        .replace('{unit}', unit);
    }
    const unit = diffDays === 1 ? t('identity.locked.unitDay') : t('identity.locked.unitDays');
    return t('identity.locked.unlockMinutes')
      .replace('{count}', String(diffDays))
      .replace('{unit}', unit);
  };

  const formattedLockReason = hasReason ? ` ${lockReason}` : '';

  return (
    <Alert tone="danger" className="mt-4">
      <div className="space-y-2">
        <Text size="sm" className="font-semibold">
          {t('identity.locked.heading')}
        </Text>

        {hasReason && (
          <Text size="sm">
            <strong>{t('identity.locked.reasonLabel')}</strong>
            {formattedLockReason}
          </Text>
        )}

        {hasExpiry && (
          <Text size="sm" tone="muted">
            {formatLockExpiry(lockedUntil)}
          </Text>
        )}

        <Text size="xs" tone="muted">
          {t('identity.locked.supportPrefix')}
          <Link to="/support" className="underline">
            {t('identity.locked.supportLink')}
          </Link>
          {t('identity.locked.supportSuffix')}
        </Text>
      </div>
    </Alert>
  );
};

// ============================================================================
// 6. SmsChallenge
// ============================================================================

interface SmsChallengeProps {
  challengeToken: string;
  onVerify: (challengeToken: string, code: string) => Promise<void>;
  onSendCode: (challengeToken: string) => Promise<void>;
  onCancel: () => void;
}

export const SmsChallenge = ({
  challengeToken,
  onVerify,
  onSendCode,
  onCancel,
}: SmsChallengeProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    const sendInitial = async (): Promise<void> => {
      try {
        await onSendCode(challengeToken);
        setCodeSent(true);
        setResendCooldown(60);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('identity.sms.sendFailed'));
      }
    };
    void sendInitial();
    return undefined;
  }, [challengeToken, onSendCode, t]);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, MS_PER_SECOND);
    return (): void => {
      clearInterval(timer);
    };
  }, [resendCooldown]);

  const handleVerify = useCallback(async () => {
    if (code.trim().length < 6) return;
    setIsLoading(true);
    setError(null);
    try {
      await onVerify(challengeToken, code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('identity.sms.verifyFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [challengeToken, code, onVerify, t]);

  const handleResend = useCallback(async () => {
    setError(null);
    try {
      await onSendCode(challengeToken);
      setResendCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('identity.sms.resendFailed'));
    }
  }, [challengeToken, onSendCode, t]);

  return (
    <div className="space-y-4">
      <Text size="lg">{t('identity.sms.heading')}</Text>
      <Text tone="muted" size="sm">
        {codeSent ? t('identity.sms.enterCode') : t('identity.sms.sendingCode')}
      </Text>

      <form
        className="flex gap-2"
        onSubmit={(e): void => {
          e.preventDefault();
          void handleVerify();
        }}
      >
        <Input
          type="text"
          placeholder={t('identity.sms.codePlaceholder')}
          value={code}
          onChange={(e): void => {
            setCode(e.target.value.replace(/\D/g, ''));
          }}
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={!codeSent}
        />
        <Button type="submit" disabled={isLoading || code.trim().length < 6}>
          {isLoading ? t('identity.sms.verifying') : t('identity.sms.verify')}
        </Button>
      </form>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={(): void => {
            void handleResend();
          }}
          disabled={resendCooldown > 0}
        >
          {resendCooldown > 0
            ? t('identity.sms.resendCountdown').replace('{seconds}', String(resendCooldown))
            : t('identity.sms.resendCode')}
        </Button>
        <Button type="button" variant="text" size="small" onClick={onCancel}>
          {t('identity.sms.cancel')}
        </Button>
      </div>
    </div>
  );
};

// ============================================================================
// 7. NewDeviceBanner
// ============================================================================

export function NewDeviceBanner(): null {
  const t = useModuleMessages(enUsMessages);
  const { isNewDevice, dismissNewDeviceBanner } = useAuth();
  const raised = useRef(false);

  useEffect(() => {
    if (!isNewDevice || raised.current) return;
    raised.current = true;

    toastStore.getState().show({
      tone: 'warning',
      title: t('identity.newDevice.title'),
      description: t('identity.newDevice.description'),
      action: {
        label: t('identity.newDevice.action'),
        onClick: () => {
          window.location.assign('/settings/security');
        },
      },
    });

    dismissNewDeviceBanner();
  }, [isNewDevice, dismissNewDeviceBanner, t]);

  return null;
}
