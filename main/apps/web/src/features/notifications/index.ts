// main/apps/web/src/features/notifications/index.ts
/**
 * Notifications Feature Module
 *
 * In-app notification bell, dropdown, and data hooks.
 */

export { NotificationBell } from './components/NotificationBell';
export type { NotificationBellProps } from './components/NotificationBell';
export { NotificationDropdown } from './components/NotificationDropdown';
export type { NotificationDropdownProps } from './components/NotificationDropdown';

export { useNotifications } from './hooks/useNotifications';
export type { UseNotificationsOptions, UseNotificationsResult } from './hooks/useNotifications';
export { useNotificationPreferences } from './hooks/useNotificationPreferences';
export type {
  NotificationPreferencesState,
  UseNotificationPreferencesOptions,
} from './hooks/useNotificationPreferences';
export {
  usePushPermission,
  usePushSubscription,
  useTestNotification,
} from './hooks/usePushNotifications';
export type {
  PushPermissionState,
  PushSubscriptionState,
  TestNotificationState,
  UsePushSubscriptionOptions,
} from './hooks/usePushNotifications';

export { getNotificationRoute } from './utils/getNotificationRoute';
