// main/client/react/src/oauth/hooks.ts
/**
 * OAuth React Hooks
 *
 * Provides convenient hooks for working with OAuth:
 * - useEnabledOAuthProviders: Get list of enabled OAuth providers
 * - useOAuthConnections: Get/manage connected OAuth accounts
 * - getOAuthLoginUrl: Pure function to build OAuth login URL
 */

import { AUTH_STRATEGIES } from '@bslt/shared/constants/config';
import { API_PREFIX } from '@bslt/shared/constants/system/platform';
import {
  oauthConnectionsResponseSchema,
  oauthEnabledProvidersResponseSchema,
  oauthLinkResponseSchema,
  oauthUnlinkResponseSchema,
} from '@bslt/shared/core/auth';
import { trimTrailingSlashes } from '@bslt/shared/helpers/string';
import { useCallback, useMemo } from 'react';

import { useMutation } from '../query/useMutation';
import { useQuery } from '../query/useQuery';

import type {
  AuthStrategy,
  OAuthConnection,
  OAuthConnectionsResponse,
  OAuthEnabledProvidersResponse,
  OAuthLinkResponse,
  OAuthProvider,
  OAuthUnlinkResponse,
} from '@bslt/shared/core/auth';

export interface OAuthClientConfig {
  baseUrl: string;
  getToken?: (() => string | null) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface OAuthApiClient {
  getAuthStrategies: () => Promise<{
    enabled: AuthStrategy[];
    disabled: AuthStrategy[];
  }>;
  getEnabledOAuthProviders: () => Promise<OAuthEnabledProvidersResponse>;
  getOAuthConnections: () => Promise<OAuthConnectionsResponse>;
  linkOAuthProvider: (provider: OAuthProvider) => Promise<OAuthLinkResponse>;
  unlinkOAuthProvider: (provider: OAuthProvider) => Promise<OAuthUnlinkResponse>;
  getOAuthLinkUrl: (provider: OAuthProvider) => string;
}

type ResponseSchema<T> = {
  parse(data: unknown): T;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfTokenCache = new Map<string, string>();

const isFormDataBody = (body: BodyInit | null | undefined): body is FormData =>
  typeof FormData !== 'undefined' && body instanceof FormData;

function isCsrfError(status: number, data: Record<string, unknown>): boolean {
  if (status !== 403) return false;
  const message = typeof data['message'] === 'string' ? data['message'].toLowerCase() : '';
  return message.includes('csrf');
}

function createResponseError(status: number, data: Record<string, unknown>): Error {
  const message = typeof data['message'] === 'string' ? data['message'] : `HTTP ${String(status)}`;
  return new Error(message);
}

async function fetchCsrfToken(baseUrl: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(`${baseUrl}${API_PREFIX}/csrf-token`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof data['token'] !== 'string' || data['token'].length === 0) {
    throw createResponseError(response.status, data);
  }

  csrfTokenCache.set(baseUrl, data['token']);
  return data['token'];
}

function parseAuthStrategy(value: unknown): AuthStrategy {
  if (typeof value === 'string' && (AUTH_STRATEGIES as readonly string[]).includes(value)) {
    return value as AuthStrategy;
  }
  throw new Error('Invalid auth strategy');
}

const authStrategiesResponseSchema: ResponseSchema<{
  enabled: AuthStrategy[];
  disabled: AuthStrategy[];
}> = {
  parse(value: unknown) {
    if (value === null || typeof value !== 'object') {
      throw new Error('Invalid auth strategies response');
    }
    const obj = value as Record<string, unknown>;
    const enabledRaw = obj['enabled'];
    const disabledRaw = obj['disabled'];
    if (!Array.isArray(enabledRaw) || !Array.isArray(disabledRaw)) {
      throw new Error('Invalid auth strategies payload');
    }
    return {
      enabled: enabledRaw.map(parseAuthStrategy),
      disabled: disabledRaw.map(parseAuthStrategy),
    };
  },
};

function createOAuthApiClient(config: OAuthClientConfig): OAuthApiClient {
  const baseUrl = trimTrailingSlashes(config.baseUrl);
  const fetcher = config.fetchImpl ?? fetch;

  const request = async <T>(
    path: string,
    options?: RequestInit,
    responseSchema?: ResponseSchema<T>,
    attempt = 0,
  ): Promise<T> => {
    const method = options?.method ?? 'GET';
    const requiresCsrf = !SAFE_METHODS.has(method.toUpperCase());
    const headers = new Headers(options?.headers);

    if (!isFormDataBody(options?.body)) {
      headers.set('Content-Type', 'application/json');
    }

    const token = config.getToken?.();
    if (token !== null && token !== undefined && token.length > 0) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const csrfToken = csrfTokenCache.get(baseUrl) ?? null;
    if (requiresCsrf && csrfToken !== null && csrfToken.length > 0) {
      headers.set('x-csrf-token', csrfToken);
    }

    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${API_PREFIX}${path}`, {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch ${method} ${path}: ${message}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      if (requiresCsrf && attempt === 0 && isCsrfError(response.status, data)) {
        await fetchCsrfToken(baseUrl, fetcher);
        return request(path, options, responseSchema, 1);
      }
      throw createResponseError(response.status, data);
    }

    if (responseSchema !== undefined) {
      return responseSchema.parse(data);
    }

    return data as T;
  };

  return {
    getAuthStrategies: () => request('/auth/strategies', undefined, authStrategiesResponseSchema),
    getEnabledOAuthProviders: () =>
      request('/auth/oauth/providers', undefined, oauthEnabledProvidersResponseSchema),
    getOAuthConnections: () =>
      request('/auth/oauth/connections', undefined, oauthConnectionsResponseSchema),
    linkOAuthProvider: (provider) =>
      request(
        `/auth/oauth/${provider}/link`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        oauthLinkResponseSchema,
      ),
    unlinkOAuthProvider: (provider) =>
      request(
        `/auth/oauth/${provider}/unlink`,
        {
          method: 'DELETE',
        },
        oauthUnlinkResponseSchema,
      ),
    getOAuthLinkUrl: (provider) => `${baseUrl}${API_PREFIX}/auth/oauth/${provider}/link`,
  };
}

// ============================================================================
// Query Keys
// ============================================================================

export const oauthQueryKeys = {
  all: ['oauth'] as const,
  authStrategies: () => [...oauthQueryKeys.all, 'auth-strategies'] as const,
  enabledProviders: () => [...oauthQueryKeys.all, 'enabled-providers'] as const,
  connections: () => [...oauthQueryKeys.all, 'connections'] as const,
} as const;

export interface EnabledAuthStrategiesState {
  isLoading: boolean;
  enabled: AuthStrategy[];
  disabled: AuthStrategy[];
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useEnabledAuthStrategies(
  clientConfig: OAuthClientConfig,
): EnabledAuthStrategiesState {
  const client = useMemo(() => createOAuthApiClient(clientConfig), [clientConfig]);

  const query = useQuery({
    queryKey: oauthQueryKeys.authStrategies(),
    queryFn: () => client.getAuthStrategies(),
    retry: 1,
  });

  const handleRefresh = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  return {
    enabled: query.data?.enabled ?? [],
    disabled: query.data?.disabled ?? [],
    isLoading: query.isLoading,
    error: query.error ?? null,
    refresh: handleRefresh,
  };
}

// ============================================================================
// useEnabledOAuthProviders
// ============================================================================

/**
 * Enabled OAuth providers state
 */
export interface EnabledOAuthProvidersState {
  /** Whether loading providers */
  isLoading: boolean;
  /** List of enabled provider names */
  providers: OAuthProvider[];
  /** Error if failed */
  error: Error | null;
  /** Refresh providers from server */
  refresh: () => Promise<void>;
}

/**
 * Hook to get list of enabled OAuth providers (public endpoint)
 */
export function useEnabledOAuthProviders(
  clientConfig: OAuthClientConfig,
): EnabledOAuthProvidersState {
  const client = useMemo(() => createOAuthApiClient(clientConfig), [clientConfig]);

  const query = useQuery({
    queryKey: oauthQueryKeys.enabledProviders(),
    queryFn: () => client.getEnabledOAuthProviders(),
    retry: 1,
  });

  const handleRefresh = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  return {
    providers: query.data?.providers ?? [],
    isLoading: query.isLoading,
    error: query.error ?? null,
    refresh: handleRefresh,
  };
}

// ============================================================================
// useOAuthConnections
// ============================================================================

/**
 * OAuth connections state
 */
export interface OAuthConnectionsState {
  /** Whether loading connections */
  isLoading: boolean;
  /** Whether an action is in progress */
  isActing: boolean;
  /** List of connected OAuth accounts */
  connections: OAuthConnection[];
  /** Error if failed */
  error: Error | null;
  /** Unlink an OAuth provider */
  unlink: (provider: OAuthProvider) => Promise<void>;
  /** Start OAuth linking flow and return the provider redirect URL */
  link: (provider: OAuthProvider) => Promise<string>;
  /** Get URL to start OAuth linking flow */
  getLinkUrl: (provider: OAuthProvider) => string;
  /** Refresh connections from server */
  refresh: () => Promise<void>;
}

/**
 * Hook to manage OAuth connections (protected endpoint)
 */
export function useOAuthConnections(clientConfig: OAuthClientConfig): OAuthConnectionsState {
  const client = useMemo(() => createOAuthApiClient(clientConfig), [clientConfig]);

  const query = useQuery({
    queryKey: oauthQueryKeys.connections(),
    queryFn: () => client.getOAuthConnections(),
  });

  const unlinkMutation = useMutation({
    mutationFn: (provider: OAuthProvider) => client.unlinkOAuthProvider(provider),
    invalidateOnSuccess: [oauthQueryKeys.connections()],
  });

  const linkMutation = useMutation({
    mutationFn: (provider: OAuthProvider) => client.linkOAuthProvider(provider),
  });

  const handleUnlink = useCallback(
    async (provider: OAuthProvider): Promise<void> => {
      await unlinkMutation.mutateAsync(provider);
    },
    [unlinkMutation],
  );

  const handleLink = useCallback(
    async (provider: OAuthProvider): Promise<string> => {
      const response = await linkMutation.mutateAsync(provider);
      return response.url;
    },
    [linkMutation],
  );

  const getLinkUrl = useCallback(
    (provider: OAuthProvider): string => {
      return client.getOAuthLinkUrl(provider);
    },
    [client],
  );

  const handleRefresh = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  return {
    connections: query.data?.connections ?? [],
    isLoading: query.isLoading,
    isActing: unlinkMutation.isPending || linkMutation.isPending,
    error: query.error ?? unlinkMutation.error ?? linkMutation.error ?? null,
    unlink: handleUnlink,
    link: handleLink,
    getLinkUrl,
    refresh: handleRefresh,
  };
}

// ============================================================================
// Helper: getOAuthLoginUrl
// ============================================================================

/**
 * Get the URL to initiate OAuth login
 *
 * @param baseUrl - API base URL
 * @param provider - OAuth provider name
 * @param eligibilityAttested - Set only from a sign-up surface where the user has
 *   ticked the eligibility box. OAuth leaves the page, so this is the only way to
 *   carry the tick to the server; it is sealed into the encrypted OAuth state and
 *   required at the callback if that callback creates an account. The one checkbox
 *   statement covers eligibility AND accepting the terms, so the tick also carries
 *   `consented=true` — consent to the published signup agreements, which the
 *   server records against the new account.
 * @returns URL to redirect browser to
 */
export function getOAuthLoginUrl(
  baseUrl: string,
  provider: OAuthProvider,
  eligibilityAttested = false,
): string {
  const normalizedBase = trimTrailingSlashes(baseUrl);
  const providerStr = provider as string;
  const url = `${normalizedBase}${API_PREFIX}/auth/oauth/${providerStr}`;
  return eligibilityAttested ? `${url}?attested=true&consented=true` : url;
}
