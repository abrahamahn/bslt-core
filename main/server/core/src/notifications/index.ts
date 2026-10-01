// main/server/core/src/notifications/index.ts
/**
 * @bslt/notifications - Push Notification Module
 *
 * Provides push notification infrastructure including:
 * - Subscription management (subscribe, unsubscribe, query)
 * - Preference management (get, update, quiet hours)
 * - Provider-facing contracts supplied by optional comms adapters
 * - HTTP handlers and route definitions
 *
 * @example
 * ```ts
 * import {
 *   subscribe,
 *   getPreferences,
 *   notificationRoutes,
 * } from '@bslt/notifications';
 *
 * // Register routes
 * registerRouteMap(app, ctx, notificationRoutes, routerOptions);
 *
 * // Use service directly
 * const subId = await subscribe(db, userId, subscription, deviceId, userAgent);
 * const prefs = await getPreferences(db, userId);
 * ```
 */

// Module types
export type { NotificationModuleDeps, NotificationRequest } from './types';

// Service - Subscription management
export {
  cleanupExpiredSubscriptions,
  clearAllData,
  createNotificationForEvent,
  getActiveSubscriptionCount,
  getAllActiveSubscriptions,
  getPreferences,
  getSubscriptionById,
  getSubscriptionCount,
  getSubscriptionStats,
  getUserSubscriptions,
  isNotificationAllowed,
  markSubscriptionsExpired,
  readPreferences,
  shouldSendNotification,
  subscribe,
  unsubscribe,
  updatePreferences,
  type NotificationEventType,
} from './service';

// Handlers
export {
  handleDeleteNotification,
  handleEmailUnsubscribe,
  handleGetPreferences,
  handleGetVapidKey,
  handleListNotifications,
  handleMarkAllAsRead,
  handleMarkAsRead,
  handleSendNotification,
  handleSubscribe,
  handleTestNotification,
  handleUnsubscribe,
  handleUpdatePreferences,
} from './handlers';

// Email unsubscribe
export {
  generateUnsubscribeHeaders,
  generateUnsubscribeToken,
  getUnsubscribedCategories,
  isUnsubscribed,
  NON_SUPPRESSIBLE_TYPES,
  resubscribeUser,
  shouldSendEmail,
  UNSUBSCRIBE_CATEGORIES,
  unsubscribeUser,
  validateUnsubscribeToken,
} from './unsubscribe';
export type { UnsubscribeCategory } from './unsubscribe';

// Admin activity alerts
export { notifyAdmins } from './admin-alerts';
export type {
  AdminAlertDeps,
  AdminAlertEvent,
  AdminAlertEventType,
  AdminAlertSubject,
} from './admin-alerts';

// Routes
export { notificationRoutes } from './routes';

// Errors (re-exported from @bslt/shared)
export {
  InvalidPreferencesError,
  InvalidSubscriptionError,
  NotificationRateLimitError,
  NotificationsDisabledError,
  NotificationSendError,
  PayloadTooLargeError,
  PreferencesNotFoundError,
  ProviderError,
  ProviderNotConfiguredError,
  QuietHoursActiveError,
  SubscriptionExistsError,
  SubscriptionExpiredError,
  SubscriptionNotFoundError,
  VapidNotConfiguredError,
} from '@bslt/shared/comms/notifications';
export { NOTIFICATION_PAYLOAD_MAX_SIZE } from '@bslt/shared/constants/system';

export { publishNotificationCreated } from './publish';
export type { NotificationPubSub } from './publish';
