// main/apps/web/src/features/notifications/hooks/useNotifications.ts
/**
 * useNotifications hook
 *
 * Fetches in-app notifications and provides mutation helpers
 * for marking as read, marking all as read, and deleting.
 */

import { getAccessToken } from '@app/authToken';
import { useClientEnvironment } from '@app/ClientEnvironment';
import { useAuth } from '@auth/hooks';
import { createNotificationClient } from '@bslt/api';
import { useMutation, useQuery } from '@bslt/react';
import { notificationsChannel } from '@bslt/shared/db';
import { useCallback, useEffect, useMemo } from 'react';

/** How often the notification list/badge polls for server-side changes. */
const NOTIFICATIONS_POLL_MS = 60_000;

import type {
  DeleteNotificationResponse,
  MarkReadResponse,
  NotificationClient,
  NotificationsListResponse,
} from '@bslt/api';
import type { Notification } from '@bslt/shared/comms/notifications';

import { subscribeToKey } from '@/lib/realtime';

// ============================================================================
// Types
// ============================================================================

export interface UseNotificationsOptions {
  enabled?: boolean;
  limit?: number;
}

export interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  markAsRead: (ids: string[]) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  isMarkingRead: boolean;
  isMarkingAllRead: boolean;
  isDeleting: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsResult {
  const { config } = useClientEnvironment();
  const { refreshToken, user } = useAuth();
  const limit = options.limit ?? 20;

  const api = useMemo(
    (): NotificationClient =>
      createNotificationClient({
        baseUrl: config.apiUrl,
        getToken: getAccessToken,
        // Refresh the memory-only access token and retry once on a 401 so a
        // lapsed token (e.g. throttled refresh timer in a backgrounded tab)
        // self-heals instead of surfacing as a stuck "Unauthorized".
        onUnauthorized: refreshToken,
      }),
    [config.apiUrl, refreshToken],
  );

  const queryResult = useQuery<NotificationsListResponse>({
    queryKey: ['notifications', limit],
    queryFn: async (): Promise<NotificationsListResponse> => {
      return api.listNotifications(limit);
    },
    enabled: options.enabled !== false,
    staleTime: 15000,
  });

  // The query layer only re-evaluates staleness on window focus/online, so a
  // notification created server-side never bumps the badge while the tab stays
  // focused. Poll on a timer (visible tabs only) to keep the unread count live.
  const enabled = options.enabled !== false;
  const { refetch } = queryResult;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refetch();
    }, NOTIFICATIONS_POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, refetch]);

  // Realtime: the server publishes `{key, version}` on this user's own channel
  // when a notification is created. The frame carries no payload, so the only
  // thing to do with it is refetch the authoritative list — which is also why a
  // push arriving alongside the poll cannot double-count anything.
  //
  // The poll above STAYS. Sockets drop and proxies close idle connections, and
  // a notification that only ever arrives over a live socket is one that
  // silently never arrives.
  const userId = user?.id;
  useEffect(() => {
    if (!enabled || userId === undefined || userId === '') return;
    return subscribeToKey(notificationsChannel(userId), () => {
      void refetch();
    });
  }, [enabled, userId, refetch]);

  const markReadMutation = useMutation<MarkReadResponse, Error, string[]>({
    mutationFn: async (ids): Promise<MarkReadResponse> => {
      return api.markRead(ids);
    },
    onSuccess: (): void => {
      void queryResult.refetch();
    },
  });

  const markAllReadMutation = useMutation<MarkReadResponse, Error, undefined>({
    mutationFn: async (): Promise<MarkReadResponse> => {
      return api.markAllRead();
    },
    onSuccess: (): void => {
      void queryResult.refetch();
    },
  });

  const deleteMutation = useMutation<DeleteNotificationResponse, Error, string>({
    mutationFn: async (id): Promise<DeleteNotificationResponse> => {
      return api.deleteNotification(id);
    },
    onSuccess: (): void => {
      void queryResult.refetch();
    },
  });

  const markAsRead = useCallback(
    (ids: string[]): void => {
      markReadMutation.mutate(ids);
    },
    [markReadMutation],
  );

  const markAllAsRead = useCallback((): void => {
    markAllReadMutation.mutate(undefined);
  }, [markAllReadMutation]);

  const deleteNotification = useCallback(
    (id: string): void => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  return {
    notifications: queryResult.data?.notifications ?? [],
    unreadCount: queryResult.data?.unreadCount ?? 0,
    isLoading: queryResult.isLoading,
    isError: queryResult.isError,
    error: queryResult.error,
    refetch: queryResult.refetch,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isMarkingRead: markReadMutation.status === 'pending',
    isMarkingAllRead: markAllReadMutation.status === 'pending',
    isDeleting: deleteMutation.status === 'pending',
  };
}
