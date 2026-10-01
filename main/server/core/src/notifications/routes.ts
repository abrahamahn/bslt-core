// main/server/core/src/notifications/routes.ts
/**
 * Notification Routes
 *
 * Route definitions for the notifications module.
 * Uses the generic router pattern from @bslt/db for DRY registration.
 *
 * The handler context is narrowed from HandlerContext to NotificationModuleDeps
 * at the route definition boundary. At runtime, the server passes AppContext
 * (which satisfies NotificationModuleDeps) as the handler context.
 */

import {
  createRouteMap,
  createScopedRouteHelpers,
  type HttpRequest,
} from '@bslt/server-system/http';
import {
  baseMarkAsReadRequestSchema,
  notificationDeleteRequestSchema,
  sendNotificationRequestSchema,
  subscribeRequestSchema,
  unsubscribeRequestSchema,
  updatePreferencesRequestSchema,
} from '@bslt/shared/comms/notifications';
import {
  type BaseMarkAsReadRequest,
  type SendNotificationRequest,
  type SubscribeRequest,
  type UnsubscribeRequest,
  type UpdatePreferencesRequest,
} from '@bslt/shared/comms/notifications';
import { emptyBodySchema, type EmptyBody } from '@bslt/shared/system';

import {
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

import type { NotificationModuleDeps, NotificationRequest } from './types';

const notificationRouteHelpers = createScopedRouteHelpers<
  NotificationModuleDeps,
  NotificationRequest & HttpRequest
>(
  (ctx) => ctx as NotificationModuleDeps,
  (request) => request as NotificationRequest & HttpRequest,
);

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Notification module route map.
 *
 * Defines all notification-related HTTP routes with their handlers,
 * validation schemas, and auth requirements.
 *
 * Routes:
 * - GET  notifications/vapid-key           (public)  - Get VAPID public key
 * - POST notifications/subscribe           (user)    - Subscribe to push notifications
 * - POST notifications/unsubscribe         (user)    - Unsubscribe from push notifications
 * - GET  notifications/preferences         (user)    - Get notification preferences
 * - PUT  notifications/preferences/update  (user)    - Update notification preferences
 * - POST notifications/test               (user)    - Send test notification
 * - POST notifications/send               (admin)   - Send notification to users
 * - GET  notifications/list               (user)    - List in-app notifications
 * - POST notifications/mark-read          (user)    - Mark specific notifications as read
 * - POST notifications/mark-all-read      (user)    - Mark all notifications as read
 * - POST notifications/delete             (user)    - Delete a notification
 */
export const notificationRoutes = createRouteMap([
  // Public route - get VAPID key for client subscription
  [
    'notifications/vapid-key',
    notificationRouteHelpers.publicRoute<undefined>('GET', (ctx) => handleGetVapidKey(ctx)),
  ],

  // Protected routes - require user authentication
  [
    'notifications/subscribe',
    notificationRouteHelpers.protectedRoute<SubscribeRequest>(
      'POST',
      async (ctx, body, req) => handleSubscribe(ctx, body, req),
      'user',
      subscribeRequestSchema,
    ),
  ],

  [
    'notifications/unsubscribe',
    notificationRouteHelpers.protectedRoute<UnsubscribeRequest>(
      'POST',
      async (ctx, body, req) => handleUnsubscribe(ctx, body, req),
      'user',
      unsubscribeRequestSchema,
    ),
  ],

  [
    'notifications/preferences',
    notificationRouteHelpers.protectedRoute<undefined>(
      'GET',
      async (ctx, _body, req) => handleGetPreferences(ctx, _body, req),
      'user',
    ),
  ],

  [
    'notifications/preferences/update',
    notificationRouteHelpers.protectedRoute<UpdatePreferencesRequest>(
      'PUT',
      (ctx, body, req) => handleUpdatePreferences(ctx, body, req),
      'user',
      updatePreferencesRequestSchema,
    ),
  ],

  [
    'notifications/test',
    notificationRouteHelpers.protectedRoute<EmptyBody>(
      'POST',
      (ctx, _body, req) => handleTestNotification(ctx, undefined, req),
      'user',
      emptyBodySchema,
    ),
  ],

  // Admin routes - require admin authentication
  [
    'notifications/send',
    notificationRouteHelpers.protectedRoute<SendNotificationRequest>(
      'POST',
      (ctx, body, req) => handleSendNotification(ctx, body, req),
      'admin',
      sendNotificationRequestSchema,
    ),
  ],

  // In-app notification routes
  [
    'notifications/list',
    notificationRouteHelpers.protectedRoute<undefined>(
      'GET',
      async (ctx, _body, req) => handleListNotifications(ctx, _body, req),
      'user',
    ),
  ],

  [
    'notifications/mark-read',
    notificationRouteHelpers.protectedRoute<BaseMarkAsReadRequest>(
      'POST',
      async (ctx, body, req) => handleMarkAsRead(ctx, body, req),
      'user',
      baseMarkAsReadRequestSchema,
    ),
  ],

  [
    'notifications/mark-all-read',
    notificationRouteHelpers.protectedRoute<EmptyBody>(
      'POST',
      async (ctx, _body, req) => handleMarkAllAsRead(ctx, undefined, req),
      'user',
      emptyBodySchema,
    ),
  ],

  [
    'notifications/delete',
    notificationRouteHelpers.protectedRoute<{ id: string }>(
      'POST',
      async (ctx, body, req) => handleDeleteNotification(ctx, body, req),
      'user',
      notificationDeleteRequestSchema,
    ),
  ],

  // Email unsubscribe — public, no auth required (token-based verification)
  [
    'email/unsubscribe/:token',
    notificationRouteHelpers.publicRoute<undefined>('GET', async (ctx, _body, req) =>
      handleEmailUnsubscribe(ctx, _body, req),
    ),
  ],
]);
