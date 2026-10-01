// main/server/core/src/auth/oauth/provider-client.ts

import { OAuthError } from '../errors';

import {
  createAppleProvider,
  createGitHubProvider,
  createGoogleProvider,
  createKakaoProvider,
} from './providers';

import type { OAuthProviderClient } from './types';
import type { OAuthProvider } from '@bslt/db/schema';
import type { AuthConfig, OAuthProviderConfig } from '@bslt/shared/system/config';

export function getProviderClient(
  provider: OAuthProvider,
  config: AuthConfig,
): OAuthProviderClient {
  const providerConfig = config.oauth[provider as keyof typeof config.oauth];

  if (providerConfig == null) {
    throw new OAuthError(
      `OAuth provider ${provider} is not configured`,
      provider,
      'NOT_CONFIGURED',
    );
  }

  switch (provider) {
    case 'google':
      return createGoogleProvider(
        (providerConfig as OAuthProviderConfig).clientId,
        (providerConfig as OAuthProviderConfig).clientSecret,
      );
    case 'github':
      return createGitHubProvider(
        (providerConfig as OAuthProviderConfig).clientId,
        (providerConfig as OAuthProviderConfig).clientSecret,
      );
    case 'kakao':
      return createKakaoProvider(
        (providerConfig as OAuthProviderConfig).clientId,
        (providerConfig as OAuthProviderConfig).clientSecret,
      );
    case 'apple': {
      const appleConfig = providerConfig as OAuthProviderConfig & {
        teamId?: string;
        keyId?: string;
        privateKey?: string;
      };

      if (
        appleConfig.teamId !== undefined &&
        appleConfig.keyId !== undefined &&
        appleConfig.privateKey !== undefined
      ) {
        return createAppleProvider({
          clientId: appleConfig.clientId,
          teamId: appleConfig.teamId,
          keyId: appleConfig.keyId,
          privateKey: appleConfig.privateKey,
        });
      }
      throw new OAuthError(
        'Apple OAuth requires teamId, keyId, and privateKey configuration',
        'apple',
        'INCOMPLETE_CONFIG',
      );
    }
    default: {
      const exhaustiveCheck: never = provider;
      throw new OAuthError(
        `Unsupported OAuth provider: ${String(exhaustiveCheck)}`,
        provider,
        'UNSUPPORTED',
      );
    }
  }
}
