// main/apps/web/src/features/settings/hooks/useApiKeys.ts
/**
 * API Keys hooks — list, create, and revoke the current user's API keys.
 */

import { getAccessToken } from '@app/authToken';
import { createApiKeysClient } from '@bslt/api';
import { useMutation, useQuery, useQueryCache } from '@bslt/react';
import { clientConfig } from '@config';

import type { ApiKeysClient } from '@bslt/api';
import type {
  ApiKey,
  ApiKeysListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from '@bslt/shared/core/api-keys';

const API_KEYS_QUERY_KEY = ['apiKeys'] as const;

let apiKeysClient: ApiKeysClient | null = null;

function getApiKeysClient(): ApiKeysClient {
  apiKeysClient ??= createApiKeysClient({
    baseUrl: clientConfig.apiUrl,
    getToken: getAccessToken,
  });
  return apiKeysClient;
}

export interface UseApiKeysResult {
  readonly data: readonly ApiKey[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

export function useApiKeys(): UseApiKeysResult {
  const queryCache = useQueryCache();
  const query = useQuery<ApiKeysListResponse>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => getApiKeysClient().listApiKeys(),
    staleTime: 60 * 1000,
  });

  return {
    data: query.data?.keys ?? [],
    isLoading: query.status === 'pending',
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch: () => {
      queryCache.invalidateQuery(API_KEYS_QUERY_KEY);
    },
  };
}

export function useCreateApiKey() {
  return useMutation<CreateApiKeyResponse, Error, CreateApiKeyRequest>({
    mutationFn: (data) => getApiKeysClient().createApiKey(data),
    invalidateOnSuccess: [API_KEYS_QUERY_KEY],
  });
}

export function useDeleteApiKey() {
  const queryCache = useQueryCache();
  return useMutation<string, Error, string, { previous?: ApiKeysListResponse }>({
    mutationFn: async (id) => {
      await getApiKeysClient().deleteApiKey(id);
      return id;
    },
    // Drop the row immediately so revocation feels instant.
    onMutate: (id) => {
      const previous = queryCache.getQueryData(API_KEYS_QUERY_KEY) as
        | ApiKeysListResponse
        | undefined;
      if (previous !== undefined) {
        queryCache.setQueryData(API_KEYS_QUERY_KEY, {
          ...previous,
          keys: previous.keys.filter((key) => key.id !== id),
        });
      }
      return previous !== undefined ? { previous } : {};
    },
    onError: (_error, _id, context) => {
      if (context?.previous !== undefined) {
        queryCache.setQueryData(API_KEYS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      queryCache.invalidateQuery(API_KEYS_QUERY_KEY);
    },
  });
}
