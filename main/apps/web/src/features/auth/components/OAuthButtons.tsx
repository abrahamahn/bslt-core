// main/apps/web/src/features/auth/components/OAuthButtons.tsx
/**
 * OAuth Buttons Component
 *
 * Displays OAuth provider buttons for social login/registration.
 * Only shows buttons for enabled providers.
 */

import { useClientEnvironment } from '@app/ClientEnvironment';
import { getOAuthLoginUrl, useEnabledOAuthProviders } from '@bslt/react';
import { AuthFormLayout, OAuthButton, Text } from '@bslt/ui';
import { useMemo } from 'react';

import { AppleIcon, GitHubIcon, GoogleIcon, KakaoIcon } from './OAuthProviderIcons';

import type { OAuthProvider } from '@bslt/shared/core/auth';
import type { ComponentType, ReactElement } from 'react';

// ============================================================================
// Provider Config
// ============================================================================

const PROVIDER_CONFIG: Record<
  OAuthProvider,
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  google: { label: 'Google', icon: GoogleIcon },
  github: { label: 'GitHub', icon: GitHubIcon },
  kakao: { label: 'Kakao', icon: KakaoIcon },
  apple: { label: 'Apple', icon: AppleIcon },
};

// ============================================================================
// Types
// ============================================================================

export interface OAuthButtonsProps {
  /** Text to show on buttons - "Continue with" for login, "Sign up with" for register */
  mode?: 'login' | 'register';
  /** Disable buttons during form submission */
  disabled?: boolean;
  /**
   * Whether the user has confirmed the signup eligibility statement AND
   * consented to the signup agreements — the flag carries both to the server.
   *
   * Signing up with a provider creates an account just as surely as the password
   * form does, so the sign-up surface sets this only once every consent box is
   * ticked. The server refuses to create an OAuth account without it. The login
   * surface never sets it: existing users are not asked to re-attest.
   */
  eligibilityAttested?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const OAuthButtons = ({
  mode = 'login',
  disabled,
  eligibilityAttested = false,
}: OAuthButtonsProps): ReactElement | null => {
  const { config } = useClientEnvironment();

  const clientConfig = useMemo(
    () => ({
      baseUrl: config.apiUrl,
    }),
    [config.apiUrl],
  );

  const oauthState = useEnabledOAuthProviders(clientConfig);
  const providers = oauthState.providers.filter((provider) => provider in PROVIDER_CONFIG);

  // OAuth is optional. Keep the primary password/passkey login usable while the
  // public provider endpoint is loading, disabled, or unavailable.
  if (providers.length === 0 || oauthState.error !== null) {
    return null;
  }

  const actionText = mode === 'register' ? 'Sign up with' : 'Continue with';

  const handleOAuthClick = (provider: OAuthProvider): void => {
    const url = getOAuthLoginUrl(config.apiUrl, provider, eligibilityAttested);
    window.location.assign(url);
  };

  return (
    <>
      <div className="oauth-buttons">
        {providers.map((provider) => {
          const { label, icon: IconComponent } = PROVIDER_CONFIG[provider];
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
              <Text as="span">
                {actionText} {label}
              </Text>
            </OAuthButton>
          );
        })}
      </div>
      <AuthFormLayout.Divider>or</AuthFormLayout.Divider>
    </>
  );
};
