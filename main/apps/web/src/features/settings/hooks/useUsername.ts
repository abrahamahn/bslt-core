// main/apps/web/src/features/settings/hooks/useUsername.ts
/**
 * Username Hook
 *
 * Hook for updating the user's username.
 */

import { getAccessToken } from '@app/authToken';
import { createSettingsClient as createSettingsApi } from '@bslt/api';
import { useMutation, useQueryCache } from '@bslt/react';
import { clientConfig } from '@config';
import {
  currentUserProfileQueryKey,
  profileCompletenessQueryKey,
} from '@features/profile/queryKeys';

import type { UpdateUsernameRequest, UpdateUsernameResponse } from '@bslt/shared/core/users';

// ============================================================================
// Settings API Instance
// ============================================================================

let settingsApi: ReturnType<typeof createSettingsApi> | null = null;

function getSettingsApi(): ReturnType<typeof createSettingsApi> {
  settingsApi ??= createSettingsApi({
    baseUrl: clientConfig.apiUrl,
    getToken: getAccessToken,
  });
  return settingsApi;
}

// ============================================================================
// Types
// ============================================================================

export interface UseUsernameUpdateOptions {
  onSuccess?: (response: UpdateUsernameResponse) => void;
  onError?: (error: Error) => void;
}

export interface UseUsernameUpdateResult {
  updateUsername: (data: UpdateUsernameRequest) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  data: UpdateUsernameResponse | null;
  reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useUsernameUpdate(options?: UseUsernameUpdateOptions): UseUsernameUpdateResult {
  const queryCache = useQueryCache();

  const mutation = useMutation<UpdateUsernameResponse, Error, UpdateUsernameRequest>({
    mutationFn: async (data): Promise<UpdateUsernameResponse> => {
      const api = getSettingsApi();
      return api.updateUsername(data);
    },
    onSuccess: (response) => {
      queryCache.invalidateQuery(currentUserProfileQueryKey);
      queryCache.invalidateQuery(profileCompletenessQueryKey);
      options?.onSuccess?.(response);
    },
    onError: (error: Error): void => {
      options?.onError?.(error);
    },
  });

  return {
    updateUsername: mutation.mutate,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    data: mutation.data ?? null,
    reset: mutation.reset,
  };
}
