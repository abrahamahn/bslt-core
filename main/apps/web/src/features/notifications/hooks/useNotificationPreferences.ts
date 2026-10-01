// main/apps/web/src/features/notifications/hooks/useNotificationPreferences.ts
/**
 * useNotificationPreferences
 *
 * App-layer composition of the @bslt/api notification client with @bslt/react
 * query primitives to read and update a user's notification preferences.
 */

import { createNotificationClient } from '@bslt/api';
import { useMutation, useQuery, useQueryCache } from '@bslt/react';
import { useCallback, useMemo } from 'react';

import type { NotificationClientConfig } from '@bslt/api';
import type {
  NotificationPreferences,
  UpdatePreferencesRequest,
} from '@bslt/shared/comms/notifications';

const notificationQueryKeys = {
  preferences: () => ['notifications', 'preferences'] as const,
};

/**
 * Notification preferences state
 */
export interface NotificationPreferencesState {
  /** Whether currently loading preferences */
  isLoading: boolean;
  /** Whether saving preferences */
  isSaving: boolean;
  /** Current preferences */
  preferences: NotificationPreferences | null;
  /** Error if operation failed */
  error: Error | null;
  /** Update preferences */
  updatePreferences: (updates: UpdatePreferencesRequest) => Promise<void>;
  /** Refresh preferences from server */
  refresh: () => Promise<void>;
}

/**
 * Options for useNotificationPreferences hook
 */
export interface UseNotificationPreferencesOptions {
  /** API client configuration */
  clientConfig: NotificationClientConfig;
  /** Auto-fetch preferences on mount */
  autoFetch?: boolean;
}

/**
 * Hook to manage notification preferences
 */
export function useNotificationPreferences(
  options: UseNotificationPreferencesOptions,
): NotificationPreferencesState {
  const { clientConfig, autoFetch = true } = options;

  const client = useMemo(() => createNotificationClient(clientConfig), [clientConfig]);
  const cache = useQueryCache();

  const query = useQuery({
    queryKey: notificationQueryKeys.preferences(),
    queryFn: () => client.getPreferences(),
    enabled: autoFetch,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: UpdatePreferencesRequest) => client.updatePreferences(updates),
    // The server returns the full, updated preferences — write them straight
    // into the cache so the toggles reflect the new state immediately, without
    // waiting on a refetch (which is what left the UI stale until remount).
    onSuccess: (result) => {
      cache.setQueryData(notificationQueryKeys.preferences(), result);
    },
    // If the save failed (e.g. a transient auth error), drop the cached copy so
    // the next read refetches the server truth rather than a value never saved.
    onError: () => {
      cache.invalidateQuery(notificationQueryKeys.preferences());
    },
  });

  const handleUpdate = useCallback(
    async (updates: UpdatePreferencesRequest): Promise<void> => {
      await updateMutation.mutateAsync(updates);
    },
    [updateMutation],
  );

  const handleRefresh = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  return {
    isLoading: query.isLoading,
    isSaving: updateMutation.isPending,
    preferences: query.data?.preferences ?? null,
    error: query.error ?? updateMutation.error ?? null,
    updatePreferences: handleUpdate,
    refresh: handleRefresh,
  };
}
