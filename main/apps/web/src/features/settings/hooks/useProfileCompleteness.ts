// main/apps/web/src/features/settings/hooks/useProfileCompleteness.ts
/**
 * Profile Completeness Hook
 *
 * Hook for fetching the user's profile completeness percentage and missing fields.
 */

import { getAccessToken } from '@app/authToken';
import { createSettingsClient as createSettingsApi } from '@bslt/api';
import { useQuery, useQueryCache } from '@bslt/react';
import { MS_PER_MINUTE } from '@bslt/shared/constants/time';
import { clientConfig } from '@config';
import { profileCompletenessQueryKey } from '@features/profile/queryKeys';

import type { ProfileCompletenessResponse } from '@bslt/shared/core/users';

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

export interface UseProfileCompletenessResult {
  data: ProfileCompletenessResponse | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useProfileCompleteness(): UseProfileCompletenessResult {
  const queryCache = useQueryCache();

  const query = useQuery<ProfileCompletenessResponse>({
    queryKey: profileCompletenessQueryKey,
    queryFn: async (): Promise<ProfileCompletenessResponse> => {
      const api = getSettingsApi();
      return api.getProfileCompleteness();
    },
    staleTime: MS_PER_MINUTE,
  });

  const refetch = (): void => {
    queryCache.invalidateQuery(profileCompletenessQueryKey);
  };

  return {
    data: query.data ?? null,
    isLoading: query.status === 'pending',
    isError: query.status === 'error',
    error: query.error ?? null,
    refetch,
  };
}
