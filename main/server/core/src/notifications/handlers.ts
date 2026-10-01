// main/server/core/src/notifications/handlers.ts
/**
 * Notification Handlers
 *
 * HTTP handlers for push notification endpoints.
 * Thin layer that validates input, calls services, and formats responses.
 *
 * Browser push delivery is implemented end-to-end via Web Push / VAPID
 * (`deliverWebPush` in `push-dispatch.ts`); it self-disables and falls back to
 * in-app notifications when the `VAPID_*` env is not configured.
 */

import {
  type BaseMarkAsReadRequest,
  type Notification,
  type PreferencesResponse,
  type SendNotificationRequest,
  type SendNotificationResponse,
  type SubscribeRequest,
  type SubscribeResponse,
  type UnsubscribeRequest,
  type UnsubscribeResponse,
  type UpdatePreferencesRequest,
  type VapidKeyResponse,
} from '@bslt/shared/comms/notifications';
import { HTTP_STATUS } from '@bslt/shared/constants';
import { isAppError } from '@bslt/shared/system';

import { deliverWebPush } from './push-dispatch';
import { buildSendResponse, createInAppNotification, resolveTargetUserIds } from './send';
import {
  getPreferences,
  isNotificationAllowed,
  readPreferences,
  subscribe,
  unsubscribe,
  updatePreferences,
} from './service';
import { UNSUBSCRIBE_CATEGORIES, unsubscribeUser, validateUnsubscribeToken } from './unsubscribe';

import type { NotificationModuleDeps, NotificationRequest } from './types';
import type { UnsubscribeCategory } from './unsubscribe';
import type { HttpRequest } from '@bslt/server-system/http';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Handler result type for notification endpoints.
 *
 * Discriminates between successful responses (200/201) and
 * error responses (400-501) with a message body.
 */
type HandlerResult<T> =
  | { status: 200 | 201; body: T }
  | { status: 400 | 401 | 403 | 404 | 500 | 501; body: { message: string; code?: string } };

type NotificationHttpRequest = NotificationRequest & HttpRequest;

function getFirstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getJwtSecret(config: unknown): string | undefined {
  if (!isRecord(config)) {
    return undefined;
  }
  const auth = config['auth'];
  if (!isRecord(auth)) {
    return undefined;
  }
  const jwt = auth['jwt'];
  if (!isRecord(jwt)) {
    return undefined;
  }
  const secret = jwt['secret'];
  return typeof secret === 'string' && secret !== '' ? secret : undefined;
}

// ============================================================================
// Public Handlers (No auth required)
// ============================================================================

/**
 * Get VAPID public key for client subscription.
 *
 * GET /api/notifications/vapid-key
 *
 * NOTE: Web Push sending is currently unavailable. The endpoint still returns
 * a 200 capability response so clients can disable push UI without treating the
 * route as broken.
 *
 * @param _ctx - Notification module dependencies (unused)
 * @returns HandlerResult with push capability status
 */
export function handleGetVapidKey(ctx: NotificationModuleDeps): HandlerResult<VapidKeyResponse> {
  const publicKey = getVapidPublicKey(ctx);
  if (publicKey !== undefined) {
    return {
      status: HTTP_STATUS.OK,
      body: { enabled: true, publicKey, message: 'Web Push notifications are available.' },
    };
  }
  return {
    status: HTTP_STATUS.OK,
    body: {
      enabled: false,
      publicKey: null,
      message: 'Web Push notifications are not available. VAPID keys are not configured.',
    },
  };
}

/** Read the configured VAPID public key from the injected push provider, if any. */
function getVapidPublicKey(ctx: NotificationModuleDeps): string | undefined {
  const provider = ctx.notifications?.getWebPushProvider?.();
  if (
    typeof provider === 'object' &&
    provider !== null &&
    'getPublicKey' in provider &&
    typeof (provider as { getPublicKey: unknown }).getPublicKey === 'function'
  ) {
    const key = (provider as { getPublicKey: () => string | undefined }).getPublicKey();
    return key !== undefined && key !== '' ? key : undefined;
  }
  return undefined;
}

// ============================================================================
// Protected Handlers (User auth required)
// ============================================================================

/**
 * Subscribe to push notifications.
 *
 * POST /api/notifications/subscribe
 *
 * @param ctx - Notification module dependencies
 * @param body - Subscribe request body with subscription data, deviceId, userAgent
 * @param req - Request with authenticated user information
 * @returns HandlerResult with subscription ID or error
 */
export async function handleSubscribe(
  ctx: NotificationModuleDeps,
  body: SubscribeRequest,
  req: NotificationRequest,
): Promise<HandlerResult<SubscribeResponse>> {
  if (req.user === undefined) {
    return {
      status: HTTP_STATUS.UNAUTHORIZED,
      body: { message: 'Unauthorized' },
    };
  }

  try {
    const subscriptionId = await subscribe(
      ctx.db,
      req.user.userId,
      body.subscription,
      body.deviceId,
      body.userAgent,
    );

    return {
      status: HTTP_STATUS.CREATED,
      body: {
        subscriptionId,
        message: 'Successfully subscribed to push notifications',
      },
    };
  } catch (error) {
    if (isAppError(error)) {
      const appError = error as Error & { code: string; statusCode: number };
      return {
        status: HTTP_STATUS.BAD_REQUEST,
        body: {
          message: appError.message,
          code: appError.code,
        },
      };
    }

    ctx.log.error(
      { err: error as Error, handler: 'handleSubscribe', userId: req.user.userId },
      'Failed to subscribe',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to subscribe' },
    };
  }
}

/**
 * Unsubscribe from push notifications.
 *
 * POST /api/notifications/unsubscribe
 *
 * @param ctx - Notification module dependencies
 * @param body - Unsubscribe request body with subscriptionId or endpoint
 * @param req - Request with authenticated user information
 * @returns HandlerResult indicating success or not-found
 */
export async function handleUnsubscribe(
  ctx: NotificationModuleDeps,
  body: UnsubscribeRequest,
  req: NotificationRequest,
): Promise<HandlerResult<UnsubscribeResponse>> {
  if (req.user === undefined) {
    return {
      status: HTTP_STATUS.UNAUTHORIZED,
      body: { message: 'Unauthorized' },
    };
  }

  try {
    const removed = await unsubscribe(ctx.db, req.user.userId, body.subscriptionId, body.endpoint);

    if (!removed) {
      return {
        status: HTTP_STATUS.NOT_FOUND,
        body: { message: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' },
      };
    }

    return {
      status: HTTP_STATUS.OK,
      body: {
        success: true,
        message: 'Successfully unsubscribed from push notifications',
      },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleUnsubscribe', userId: req.user.userId },
      'Failed to unsubscribe',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to unsubscribe' },
    };
  }
}

/**
 * Get user notification preferences.
 *
 * GET /api/notifications/preferences
 *
 * @param ctx - Notification module dependencies
 * @param _body - Unused (GET request)
 * @param req - Request with authenticated user information
 * @returns HandlerResult with user preferences
 */
export async function handleGetPreferences(
  ctx: NotificationModuleDeps,
  _body: undefined,
  req: NotificationRequest,
): Promise<HandlerResult<PreferencesResponse>> {
  if (req.user === undefined) {
    return {
      status: HTTP_STATUS.UNAUTHORIZED,
      body: { message: 'Unauthorized' },
    };
  }

  try {
    const preferences = await getPreferences(ctx.db, req.user.userId);

    return {
      status: HTTP_STATUS.OK,
      body: { preferences },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleGetPreferences', userId: req.user.userId },
      'Failed to get preferences',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to get preferences' },
    };
  }
}

/**
 * Update user notification preferences.
 *
 * PUT /api/notifications/preferences
 *
 * @param ctx - Notification module dependencies
 * @param body - Partial preference updates
 * @param req - Request with authenticated user information
 * @returns HandlerResult with updated preferences
 */
export async function handleUpdatePreferences(
  ctx: NotificationModuleDeps,
  body: UpdatePreferencesRequest,
  req: NotificationRequest,
): Promise<HandlerResult<PreferencesResponse>> {
  if (req.user === undefined) {
    return {
      status: HTTP_STATUS.UNAUTHORIZED,
      body: { message: 'Unauthorized' },
    };
  }

  try {
    const preferences = await updatePreferences(ctx.db, req.user.userId, body);

    return {
      status: HTTP_STATUS.OK,
      body: { preferences },
    };
  } catch (error) {
    if (isAppError(error)) {
      const appError = error as Error & { code: string; statusCode: number };
      return {
        status: HTTP_STATUS.BAD_REQUEST,
        body: {
          message: appError.message,
          code: appError.code,
        },
      };
    }

    ctx.log.error(
      { err: error as Error, handler: 'handleUpdatePreferences', userId: req.user.userId },
      'Failed to update preferences',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to update preferences' },
    };
  }
}

/**
 * Send test notification to self.
 *
 * POST /api/notifications/test
 *
 * Browser push is disabled, so this creates an in-app notification for the
 * current user and returns the same batch response shape as admin sends.
 *
 * @param ctx - Notification module dependencies
 * @param _body - Unused
 * @param req - Request with authenticated user information
 * @returns HandlerResult with send result
 */
export async function handleTestNotification(
  ctx: NotificationModuleDeps,
  _body: undefined,
  req: NotificationRequest,
): Promise<HandlerResult<SendNotificationResponse>> {
  if (req.user === undefined) {
    return {
      status: HTTP_STATUS.UNAUTHORIZED,
      body: { message: 'Unauthorized' },
    };
  }

  const results = await Promise.all([
    createInAppNotification(ctx, req.user.userId, {
      type: 'system',
      priority: 'normal',
      payload: {
        title: 'Test notification',
        body: 'Your in-app notifications are working.',
      },
      userIds: [req.user.userId],
    }),
  ]);

  return {
    status: HTTP_STATUS.OK,
    body: buildSendResponse(results),
  };
}

/**
 * Send notification to specific users or broadcast.
 *
 * POST /api/notifications/send
 *
 * Browser push is disabled, so this delivers to the in-app notification feed.
 * Empty userIds are treated as a broadcast to active users.
 *
 * @param ctx - Notification module dependencies
 * @param body - Send notification request body
 * @param req - Request with authenticated admin user information
 * @returns HandlerResult with send result
 */
export async function handleSendNotification(
  ctx: NotificationModuleDeps,
  body: SendNotificationRequest,
  req: NotificationRequest,
): Promise<HandlerResult<SendNotificationResponse>> {
  if (req.user === undefined) {
    return {
      status: HTTP_STATUS.UNAUTHORIZED,
      body: { message: 'Unauthorized' },
    };
  }

  try {
    const targetUserIds = await resolveTargetUserIds(ctx, body);

    // Honour the preferences the user actually set.
    //
    // `notification_preferences` records a global switch, quiet hours, and a
    // per-type channel list, and there is a settings screen that writes all of
    // it — and until now nothing read any of it when deciding whether to
    // deliver. The evaluator (`isNotificationAllowed`) already existed, fully
    // written and documented, with no caller. A broadcast reached every active
    // user regardless of what they had asked for; most starkly, the shipped
    // default for `marketing` is `{ enabled: false, channels: ['email'] }`, so
    // a marketing broadcast pushed to the browser of every user whose stored
    // preferences said, in as many words, not to.
    //
    // Preferences are fetched once per user and evaluated for both channels,
    // rather than calling `shouldSendNotification` twice, which would double the
    // query count on a broadcast to every active user. The read is deliberately
    // `readPreferences`, not `getPreferences`: deciding whether to deliver must
    // not write a default row for every recipient who has never opened Settings.
    const routed = await Promise.all(
      targetUserIds.map(async (userId) => {
        const prefs = await readPreferences(ctx.db, userId);
        return {
          userId,
          inApp: isNotificationAllowed(prefs, body.type, 'in_app'),
          push: isNotificationAllowed(prefs, body.type, 'push'),
        };
      }),
    );

    const inAppTargets = routed.filter((target) => target.inApp).map((target) => target.userId);
    const pushTargets = routed.filter((target) => target.push).map((target) => target.userId);

    const suppressed = targetUserIds.length - inAppTargets.length;
    if (suppressed > 0) {
      ctx.log.info(
        { type: body.type, targeted: targetUserIds.length, suppressed },
        'Notifications suppressed by user preference',
      );
    }

    const results = await Promise.all(
      inAppTargets.map((userId) => createInAppNotification(ctx, userId, body)),
    );

    // Best-effort browser push alongside the in-app feed (no-op unless
    // Web Push is configured and the user has subscriptions).
    await Promise.all(pushTargets.map((userId) => deliverWebPush(ctx, userId, body)));

    return {
      status: HTTP_STATUS.OK,
      body: buildSendResponse(results),
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleSendNotification', userId: req.user.userId },
      'Failed to send notification',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to send notification' },
    };
  }
}

// ============================================================================
// In-App Notification Handlers
// ============================================================================

/** Response shape for the list notifications endpoint */
interface NotificationsListBody {
  notifications: Notification[];
  unreadCount: number;
}

/**
 * List in-app notifications for the authenticated user.
 *
 * GET /api/notifications/list
 *
 * Query params: limit (default 20), offset (default 0)
 *
 * @param ctx - Notification module dependencies
 * @param _body - Unused (GET request)
 * @param req - Request with authenticated user information
 * @returns HandlerResult with notifications array and unread count
 */
export async function handleListNotifications(
  ctx: NotificationModuleDeps,
  _body: undefined,
  req: NotificationHttpRequest,
): Promise<HandlerResult<NotificationsListBody>> {
  if (req.user === undefined) {
    return { status: HTTP_STATUS.UNAUTHORIZED, body: { message: 'Unauthorized' } };
  }

  try {
    const limitStr = getFirstQueryValue(req.query['limit']);
    const offsetStr = getFirstQueryValue(req.query['offset']);
    const parsedLimit = limitStr !== undefined ? parseInt(limitStr, 10) : NaN;
    const parsedOffset = offsetStr !== undefined ? parseInt(offsetStr, 10) : NaN;
    const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    const offset = !isNaN(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

    const [notifications, unreadCount] = await Promise.all([
      ctx.repos.notifications.findByUserId(req.user.userId, limit, offset),
      ctx.repos.notifications.countUnread(req.user.userId),
    ]);

    // Format DB dates to ISO strings for API response
    const formatted: Notification[] = notifications.map((n) => ({
      id: n.id as Notification['id'],
      userId: n.userId as Notification['userId'],
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data ?? undefined,
      isRead: n.isRead,
      readAt: n.readAt instanceof Date ? n.readAt.toISOString() : undefined,
      createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
    }));

    return {
      status: HTTP_STATUS.OK,
      body: { notifications: formatted, unreadCount },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleListNotifications', userId: req.user.userId },
      'Failed to list notifications',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to list notifications' },
    };
  }
}

/**
 * Mark specific notifications as read.
 *
 * POST /api/notifications/mark-read
 *
 * Scoped to the authenticated user: ids owned by other users are ignored.
 * Returns 404 when none of the requested notifications belong to the user.
 *
 * @param ctx - Notification module dependencies
 * @param body - Request body with notification IDs
 * @param req - Request with authenticated user information
 * @returns HandlerResult with success message
 */
export async function handleMarkAsRead(
  ctx: NotificationModuleDeps,
  body: BaseMarkAsReadRequest,
  req: NotificationRequest,
): Promise<HandlerResult<{ message: string; count: number }>> {
  if (req.user === undefined) {
    return { status: HTTP_STATUS.UNAUTHORIZED, body: { message: 'Unauthorized' } };
  }

  try {
    const count = await ctx.repos.notifications.markManyAsRead(body.ids, req.user.userId);

    if (count === 0) {
      return { status: HTTP_STATUS.NOT_FOUND, body: { message: 'Notification not found' } };
    }

    return {
      status: HTTP_STATUS.OK,
      body: { message: `Marked ${String(count)} notifications as read`, count },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleMarkAsRead', userId: req.user.userId },
      'Failed to mark notifications as read',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to mark notifications as read' },
    };
  }
}

/**
 * Mark all notifications as read for the authenticated user.
 *
 * POST /api/notifications/mark-all-read
 *
 * @param ctx - Notification module dependencies
 * @param _body - Unused
 * @param req - Request with authenticated user information
 * @returns HandlerResult with count of marked notifications
 */
export async function handleMarkAllAsRead(
  ctx: NotificationModuleDeps,
  _body: undefined,
  req: NotificationRequest,
): Promise<HandlerResult<{ message: string; count: number }>> {
  if (req.user === undefined) {
    return { status: HTTP_STATUS.UNAUTHORIZED, body: { message: 'Unauthorized' } };
  }

  try {
    const count = await ctx.repos.notifications.markAllAsRead(req.user.userId);

    return {
      status: HTTP_STATUS.OK,
      body: { message: `Marked ${String(count)} notifications as read`, count },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleMarkAllAsRead', userId: req.user.userId },
      'Failed to mark all notifications as read',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to mark all notifications as read' },
    };
  }
}

/**
 * Delete a specific notification.
 *
 * POST /api/notifications/delete
 *
 * Scoped to the authenticated user: a notification owned by another user is
 * reported as not found (404) and left untouched.
 *
 * @param ctx - Notification module dependencies
 * @param body - Request body with notification ID
 * @param req - Request with authenticated user information
 * @returns HandlerResult with success status
 */
export async function handleDeleteNotification(
  ctx: NotificationModuleDeps,
  body: { id: string },
  req: NotificationRequest,
): Promise<HandlerResult<{ message: string }>> {
  if (req.user === undefined) {
    return { status: HTTP_STATUS.UNAUTHORIZED, body: { message: 'Unauthorized' } };
  }

  try {
    const deleted = await ctx.repos.notifications.delete(body.id, req.user.userId);

    if (!deleted) {
      return { status: HTTP_STATUS.NOT_FOUND, body: { message: 'Notification not found' } };
    }

    return {
      status: HTTP_STATUS.OK,
      body: { message: 'Notification deleted' },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleDeleteNotification', userId: req.user.userId },
      'Failed to delete notification',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to delete notification' },
    };
  }
}

// ============================================================================
// Email Unsubscribe Handler (Public — no auth required)
// ============================================================================

/**
 * Handle one-click email unsubscribe via token.
 *
 * GET /api/email/unsubscribe/:token?uid=...&cat=...
 *
 * Validates the HMAC token against the user ID and category,
 * then records the unsubscribe preference.
 *
 * Returns an HTML page confirming the unsubscribe (user-facing).
 *
 * @param ctx - Notification module dependencies
 * @param _body - Unused
 * @param req - HTTP request with path params and query string
 * @returns HandlerResult with confirmation HTML or error
 * @complexity O(1)
 */
export async function handleEmailUnsubscribe(
  ctx: NotificationModuleDeps,
  _body: unknown,
  req: NotificationHttpRequest,
): Promise<HandlerResult<{ message: string; html?: string }>> {
  try {
    const fallbackQuery = new URL(req.url, 'http://localhost').searchParams;
    const token = req.params['token'] ?? '';
    const userId = getFirstQueryValue(req.query['uid']) ?? fallbackQuery.get('uid') ?? '';
    const category = getFirstQueryValue(req.query['cat']) ?? fallbackQuery.get('cat') ?? '';

    // Validate inputs
    if (token === '' || userId === '' || category === '') {
      return {
        status: HTTP_STATUS.BAD_REQUEST,
        body: { message: 'Missing required parameters: token, uid, cat' },
      };
    }

    // Validate category
    if (!UNSUBSCRIBE_CATEGORIES.includes(category as UnsubscribeCategory)) {
      return {
        status: HTTP_STATUS.BAD_REQUEST,
        body: { message: `Invalid category: ${category}` },
      };
    }

    // Get the app secret for token validation
    const secret = getJwtSecret(ctx.config);
    if (secret === undefined) {
      ctx.log.error(
        { handler: 'handleEmailUnsubscribe' },
        'App secret not available for token validation',
      );
      return {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        body: { message: 'Configuration error' },
      };
    }

    // Validate the HMAC token
    const valid = validateUnsubscribeToken(token, userId, category as UnsubscribeCategory, secret);
    if (!valid) {
      return {
        status: HTTP_STATUS.BAD_REQUEST,
        body: { message: 'Invalid or expired unsubscribe link' },
      };
    }

    // Record the unsubscribe preference
    await unsubscribeUser(ctx.db, userId, category as UnsubscribeCategory);

    ctx.log.info(
      { handler: 'handleEmailUnsubscribe', userId, category },
      'User unsubscribed from email category',
    );

    const categoryLabel = category === 'all' ? 'all non-essential' : category;
    const confirmHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background-color: #f4f5f7; color: #333; }
    .card { background: white; padding: 48px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; max-width: 480px; }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { color: #4b5563; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribed</h1>
    <p>You have been unsubscribed from <strong>${categoryLabel}</strong> emails.</p>
    <p>You will continue to receive transactional and security emails.</p>
  </div>
</body>
</html>`.trim();

    return {
      status: HTTP_STATUS.OK,
      body: { message: `Unsubscribed from ${categoryLabel} emails`, html: confirmHtml },
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'handleEmailUnsubscribe' },
      'Failed to process email unsubscribe',
    );
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to process unsubscribe request' },
    };
  }
}
