// main/apps/web/src/features/settings/hooks/useProfile.ts
/**
 * Profile Hook
 *
 * Hook for managing user profile updates.
 */

import { getAccessToken } from '@app/authToken';
import { createSettingsClient as createSettingsApi } from '@bslt/api';
import { useMutation, useQueryCache } from '@bslt/react';
import { clientConfig } from '@config';
import {
  currentUserProfileQueryKey,
  profileCompletenessQueryKey,
} from '@features/profile/queryKeys';

import type { UpdateProfileRequest, User } from '@bslt/shared/core/users';

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
// Profile Update Hook
// ============================================================================

export interface UseProfileUpdateOptions {
  onSuccess?: (user: User) => void;
  onError?: (error: Error) => void;
}

export interface UseProfileUpdateResult {
  updateProfile: (data: UpdateProfileRequest) => void;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
}

export function useProfileUpdate(options?: UseProfileUpdateOptions): UseProfileUpdateResult {
  const queryCache = useQueryCache();

  const mutation = useMutation<User, Error, UpdateProfileRequest>({
    mutationFn: async (data): Promise<User> => {
      const api = getSettingsApi();
      return api.updateProfile(data);
    },
    onSuccess: (user) => {
      // Invalidate the queries that actually render the current user's profile.
      // (['user','me'] / ['users'] are no-ops — no query subscribes to them.)
      queryCache.invalidateQuery(currentUserProfileQueryKey);
      queryCache.invalidateQuery(profileCompletenessQueryKey);
      options?.onSuccess?.(user);
    },
    onError: (error: Error): void => {
      options?.onError?.(error);
    },
  });

  return {
    updateProfile: mutation.mutate,
    isLoading: mutation.status === 'pending',
    isSuccess: mutation.status === 'success',
    isError: mutation.status === 'error',
    error: mutation.error,
    reset: mutation.reset,
  };
}
