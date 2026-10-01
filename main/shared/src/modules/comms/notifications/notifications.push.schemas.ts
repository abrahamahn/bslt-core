// main/shared/src/modules/comms/notifications/notifications.push.schemas.ts
/**
 * Push Notification Validation Schemas
 *
 * Validation schemas for notification-related requests and data.
 */

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_TYPES,
} from '../../../constants/core';
import { NOTIFICATION_PAYLOAD_MAX_SIZE } from '../../../constants/system';
import { createSchema, urlSchema, uuidSchema } from '../../../schema';

import type {
  BatchSendResult as SharedBatchSendResult,
  NotificationAction as SharedNotificationAction,
  NotificationChannel as SharedNotificationChannel,
  NotificationPayload as SharedNotificationPayload,
  NotificationPriority as SharedNotificationPriority,
  NotificationType as SharedNotificationType,
  PreferencesResponse as SharedPreferencesResponse,
  PushSubscription as SharedPushSubscription,
  PushSubscriptionKeys as SharedPushSubscriptionKeys,
  SendNotificationRequest as SharedSendNotificationRequest,
  SendNotificationResponse as SharedSendNotificationResponse,
  SendResult as SharedSendResult,
  SubscribeRequest as SharedSubscribeRequest,
  SubscribeResponse as SharedSubscribeResponse,
  UnsubscribeRequest as SharedUnsubscribeRequest,
  UnsubscribeResponse as SharedUnsubscribeResponse,
  UpdatePreferencesRequest as SharedUpdatePreferencesRequest,
  VapidKeyResponse as SharedVapidKeyResponse,
} from './notifications.types';
import type { Schema } from '../../../schema';

// ============================================================================
// Re-exports
// ============================================================================

export { NOTIFICATION_CHANNELS, NOTIFICATION_PRIORITIES, NOTIFICATION_TYPES };

// ============================================================================
// Types
// ============================================================================

export type NotificationType = SharedNotificationType;
export type NotificationChannel = SharedNotificationChannel;
export type NotificationPriority = SharedNotificationPriority;

// ============================================================================
// Validation Helpers
// ============================================================================

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * A notification's link or asset target.
 *
 * Accepts a root-relative path, because that is what an in-app destination
 * actually looks like (`/dashboard`) — the generic `urlSchema` requires an
 * absolute URL and so rejected the sender's own placeholder.
 *
 * Rejects, deliberately:
 * - non-http(s) schemes: the value is handed to `openWindow`, so `javascript:`
 *   and `data:` here are script execution, not navigation;
 * - protocol-relative and backslash authority forms (`//evil.com`,
 *   `/\evil.com`), which read as a path but navigate off-origin.
 */
export const notificationTargetUrlSchema: Schema<string> = createSchema((data: unknown) => {
  if (typeof data !== 'string') throw new Error('URL must be a string');
  if (data === '') throw new Error('Invalid URL format');

  if (data.startsWith('/')) {
    // `//host` and `/\host` are authority forms wearing a path's clothes.
    const second = data[1];
    if (second === '/' || second === '\\') throw new Error('Invalid URL format');
    return data;
  }

  let parsed: URL;
  try {
    parsed = new URL(data);
  } catch {
    throw new Error('Invalid URL format');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid URL format');
  }
  return data;
});

function isBase64Url(value: string): boolean {
  return BASE64URL_REGEX.test(value);
}

// ============================================================================
// Enum Schemas
// ============================================================================

/**
 * Notification type schema
 */
export const notificationTypeSchema: Schema<NotificationType> = createSchema((data: unknown) => {
  if (typeof data !== 'string' || !NOTIFICATION_TYPES.includes(data as NotificationType)) {
    throw new Error(`Invalid notification type. Must be one of: ${NOTIFICATION_TYPES.join(', ')}`);
  }
  return data as NotificationType;
});

/**
 * Notification channel schema
 */
export const notificationChannelSchema: Schema<NotificationChannel> = createSchema(
  (data: unknown) => {
    if (typeof data !== 'string' || !NOTIFICATION_CHANNELS.includes(data as NotificationChannel)) {
      throw new Error(
        `Invalid notification channel. Must be one of: ${NOTIFICATION_CHANNELS.join(', ')}`,
      );
    }
    return data as NotificationChannel;
  },
);

/**
 * Notification priority schema
 */
export const notificationPrioritySchema: Schema<NotificationPriority> = createSchema(
  (data: unknown) => {
    if (
      typeof data !== 'string' ||
      !NOTIFICATION_PRIORITIES.includes(data as NotificationPriority)
    ) {
      throw new Error(
        `Invalid notification priority. Must be one of: ${NOTIFICATION_PRIORITIES.join(', ')}`,
      );
    }
    return data as NotificationPriority;
  },
);

// ============================================================================
// Push Subscription Schemas
// ============================================================================

/**
 * Push subscription keys
 */
export type PushSubscriptionKeys = SharedPushSubscriptionKeys;

export const pushSubscriptionKeysSchema: Schema<PushSubscriptionKeys> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid push subscription keys');
    }
    const obj = data as Record<string, unknown>;

    if (typeof obj['p256dh'] !== 'string' || obj['p256dh'].length < 1) {
      throw new Error('p256dh key is required');
    }
    if (!isBase64Url(obj['p256dh'])) {
      throw new Error('p256dh must be base64url encoded');
    }

    if (typeof obj['auth'] !== 'string' || obj['auth'].length < 1) {
      throw new Error('auth key is required');
    }
    if (!isBase64Url(obj['auth'])) {
      throw new Error('auth must be base64url encoded');
    }

    return { p256dh: obj['p256dh'], auth: obj['auth'] };
  },
);

/**
 * Push subscription (from browser)
 */
export type PushSubscription = SharedPushSubscription;

export const pushSubscriptionSchema: Schema<PushSubscription> = createSchema((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid push subscription');
  }
  const obj = data as Record<string, unknown>;

  const endpoint = urlSchema.parse(obj['endpoint']);

  return {
    endpoint,
    expirationTime: typeof obj['expirationTime'] === 'number' ? obj['expirationTime'] : null,
    keys: pushSubscriptionKeysSchema.parse(obj['keys']),
  };
});

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Subscribe request
 */
export type SubscribeRequest = SharedSubscribeRequest;

export const subscribeRequestSchema: Schema<SubscribeRequest> = createSchema((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid subscribe request');
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj['deviceId'] !== 'string' || obj['deviceId'].length < 1) {
    throw new Error('deviceId is required');
  }
  if (obj['deviceId'].length > 255) {
    throw new Error('deviceId is too long');
  }

  let userAgent = '';
  if (typeof obj['userAgent'] === 'string') {
    if (obj['userAgent'].length > 1024) {
      throw new Error('userAgent is too long');
    }
    userAgent = obj['userAgent'];
  }

  return {
    subscription: pushSubscriptionSchema.parse(obj['subscription']),
    deviceId: obj['deviceId'],
    userAgent,
  };
});

export type SubscribeRequestSchema = SubscribeRequest;

/**
 * Unsubscribe request
 */
export type UnsubscribeRequest = SharedUnsubscribeRequest;

export const unsubscribeRequestSchema: Schema<UnsubscribeRequest> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid unsubscribe request');
    }
    const obj = data as Record<string, unknown>;

    let subscriptionId: string | undefined;
    if (obj['subscriptionId'] !== undefined) {
      subscriptionId = uuidSchema.parse(obj['subscriptionId']);
    }

    let endpoint: string | undefined;
    if (obj['endpoint'] !== undefined) {
      endpoint = urlSchema.parse(obj['endpoint']);
    }

    if (subscriptionId === undefined && endpoint === undefined) {
      throw new Error('Either subscriptionId or endpoint is required');
    }

    return { subscriptionId, endpoint };
  },
);

export type UnsubscribeRequestSchema = UnsubscribeRequest;

/**
 * Quiet hours configuration
 */
export interface QuietHours {
  enabled?: boolean;
  startHour?: number;
  endHour?: number;
  timezone?: string;
}

export const quietHoursSchema: Schema<QuietHours> = createSchema((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    return {};
  }
  const obj = data as Record<string, unknown>;

  const result: QuietHours = {};

  if (typeof obj['enabled'] === 'boolean') {
    result.enabled = obj['enabled'];
  }

  if (typeof obj['startHour'] === 'number') {
    if (!Number.isInteger(obj['startHour']) || obj['startHour'] < 0 || obj['startHour'] > 23) {
      throw new Error('startHour must be an integer between 0 and 23');
    }
    result.startHour = obj['startHour'];
  }

  if (typeof obj['endHour'] === 'number') {
    if (!Number.isInteger(obj['endHour']) || obj['endHour'] < 0 || obj['endHour'] > 23) {
      throw new Error('endHour must be an integer between 0 and 23');
    }
    result.endHour = obj['endHour'];
  }

  if (typeof obj['timezone'] === 'string') {
    if (obj['timezone'].length > 64) {
      throw new Error('timezone is too long');
    }
    result.timezone = obj['timezone'];
  }

  return result;
});

/**
 * Notification type preference
 */
export interface NotificationTypePreference {
  enabled?: boolean;
  channels?: NotificationChannel[];
}

export const notificationTypePreferenceSchema: Schema<NotificationTypePreference> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      return {};
    }
    const obj = data as Record<string, unknown>;

    const result: NotificationTypePreference = {};

    if (typeof obj['enabled'] === 'boolean') {
      result.enabled = obj['enabled'];
    }

    if (Array.isArray(obj['channels'])) {
      result.channels = obj['channels'].map((c) => notificationChannelSchema.parse(c));
    }

    return result;
  },
);

/**
 * Update preferences request
 */
export type UpdatePreferencesRequest = SharedUpdatePreferencesRequest;

export const updatePreferencesRequestSchema: Schema<UpdatePreferencesRequest> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      return {};
    }
    const obj = data as Record<string, unknown>;

    const result: UpdatePreferencesRequest = {};

    if (typeof obj['globalEnabled'] === 'boolean') {
      result.globalEnabled = obj['globalEnabled'];
    }

    if (obj['quietHours'] !== undefined) {
      result.quietHours = quietHoursSchema.parse(obj['quietHours']);
    }

    if (obj['types'] !== undefined && typeof obj['types'] === 'object') {
      const types = obj['types'] as Record<string, unknown>;
      result.types = {};
      for (const type of NOTIFICATION_TYPES) {
        if (types[type] !== undefined) {
          result.types[type] = notificationTypePreferenceSchema.parse(types[type]);
        }
      }
    }

    return result;
  },
);

export type UpdatePreferencesRequestSchema = UpdatePreferencesRequest;

/**
 * Notification action
 */
export type NotificationAction = SharedNotificationAction;

export const notificationActionSchema: Schema<NotificationAction> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid notification action');
    }
    const obj = data as Record<string, unknown>;

    if (
      typeof obj['action'] !== 'string' ||
      obj['action'].length < 1 ||
      obj['action'].length > 64
    ) {
      throw new Error('action must be 1-64 characters');
    }

    if (typeof obj['title'] !== 'string' || obj['title'].length < 1 || obj['title'].length > 128) {
      throw new Error('title must be 1-128 characters');
    }

    let icon: string | undefined;
    if (obj['icon'] !== undefined) {
      icon = notificationTargetUrlSchema.parse(obj['icon']);
    }

    return { action: obj['action'], title: obj['title'], icon };
  },
);

/**
 * Notification payload
 */
export type NotificationPayload = SharedNotificationPayload;

export const notificationPayloadSchema: Schema<NotificationPayload> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid notification payload');
    }
    const obj = data as Record<string, unknown>;

    if (typeof obj['title'] !== 'string' || obj['title'].length < 1 || obj['title'].length > 128) {
      throw new Error('title must be 1-128 characters');
    }

    if (
      typeof obj['body'] !== 'string' ||
      obj['body'].length < 1 ||
      obj['body'].length > NOTIFICATION_PAYLOAD_MAX_SIZE
    ) {
      throw new Error(`body must be 1-${String(NOTIFICATION_PAYLOAD_MAX_SIZE)} characters`);
    }

    const result: NotificationPayload = {
      title: obj['title'],
      body: obj['body'],
    };

    // Optional URL fields. Root-relative is legitimate for all four (an app
    // icon at /icons/badge.png, a destination at /dashboard), and no scheme
    // other than http(s) is.
    for (const field of ['icon', 'badge', 'image', 'url'] as const) {
      if (obj[field] !== undefined) {
        result[field] = notificationTargetUrlSchema.parse(obj[field]);
      }
    }

    if (typeof obj['tag'] === 'string' && obj['tag'].length <= 64) {
      result.tag = obj['tag'];
    }

    if (obj['data'] !== undefined && obj['data'] !== null && typeof obj['data'] === 'object') {
      result.data = obj['data'] as Record<string, unknown>;
    }

    if (Array.isArray(obj['actions'])) {
      if (obj['actions'].length > 3) {
        throw new Error('Maximum 3 actions allowed');
      }
      result.actions = obj['actions'].map((a) => notificationActionSchema.parse(a));
    }

    for (const field of ['requireInteraction', 'renotify', 'silent'] as const) {
      if (typeof obj[field] === 'boolean') {
        result[field] = obj[field];
      }
    }

    if (Array.isArray(obj['vibrate'])) {
      if (obj['vibrate'].length > 10) {
        throw new Error('Maximum 10 vibration patterns allowed');
      }
      result.vibrate = obj['vibrate'].map((v) => {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10000) {
          throw new Error('Vibration values must be integers between 0 and 10000');
        }
        return v;
      });
    }

    if (
      typeof obj['timestamp'] === 'number' &&
      Number.isInteger(obj['timestamp']) &&
      obj['timestamp'] > 0
    ) {
      result.timestamp = obj['timestamp'];
    }

    return result;
  },
);

export type NotificationPayloadSchema = NotificationPayload;

/**
 * Send notification request
 */
export type SendNotificationRequest = SharedSendNotificationRequest;

export const sendNotificationRequestSchema: Schema<SendNotificationRequest> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid send notification request');
    }
    const obj = data as Record<string, unknown>;

    const type = notificationTypeSchema.parse(obj['type']);
    const priority =
      obj['priority'] !== undefined ? notificationPrioritySchema.parse(obj['priority']) : 'normal';
    const payload = notificationPayloadSchema.parse(obj['payload']);

    const result: SendNotificationRequest = { type, priority, payload };

    if (Array.isArray(obj['userIds'])) {
      result.userIds = obj['userIds'].map((id) => {
        return uuidSchema.parse(id);
      });
    }

    if (typeof obj['topic'] === 'string' && obj['topic'].length <= 128) {
      result.topic = obj['topic'];
    }

    if (typeof obj['ttl'] === 'number') {
      if (!Number.isInteger(obj['ttl']) || obj['ttl'] < 0 || obj['ttl'] > 2419200) {
        throw new Error('ttl must be an integer between 0 and 2419200 (28 days)');
      }
      result.ttl = obj['ttl'];
    }

    return result;
  },
);

export type SendNotificationRequestSchema = SendNotificationRequest;

// ============================================================================
// Response Schemas
// ============================================================================

/**
 * Subscribe response
 */
export type SubscribeResponse = SharedSubscribeResponse;

export const subscribeResponseSchema: Schema<SubscribeResponse> = createSchema((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid subscribe response');
  }
  const obj = data as Record<string, unknown>;

  const subscriptionId = uuidSchema.parse(obj['subscriptionId']);
  if (typeof obj['message'] !== 'string') {
    throw new Error('message must be a string');
  }

  return { subscriptionId, message: obj['message'] };
});

/**
 * Unsubscribe response
 */
export type UnsubscribeResponse = SharedUnsubscribeResponse;

export const unsubscribeResponseSchema: Schema<UnsubscribeResponse> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid unsubscribe response');
    }
    const obj = data as Record<string, unknown>;

    if (typeof obj['success'] !== 'boolean') {
      throw new Error('success must be a boolean');
    }
    if (typeof obj['message'] !== 'string') {
      throw new Error('message must be a string');
    }

    return { success: obj['success'], message: obj['message'] };
  },
);

/**
 * Send result
 */
export type SendResult = SharedSendResult;

export const sendResultSchema: Schema<SendResult> = createSchema<SendResult>((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid send result');
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj['success'] !== 'boolean') {
    throw new Error('success must be a boolean');
  }
  if (typeof obj['subscriptionId'] !== 'string') {
    throw new Error('subscriptionId must be a string');
  }

  const result: SendResult = {
    success: obj['success'],
    subscriptionId: obj['subscriptionId'],
  };

  if (typeof obj['error'] === 'string') {
    result.error = obj['error'];
  }

  if (typeof obj['statusCode'] === 'number') {
    result.statusCode = obj['statusCode'];
  }

  return result;
});

/**
 * Batch send result
 */
export type BatchSendResult = SharedBatchSendResult;

export const batchSendResultSchema: Schema<BatchSendResult> = createSchema((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid batch send result');
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj['total'] !== 'number' || !Number.isInteger(obj['total']) || obj['total'] < 0) {
    throw new Error('total must be a non-negative integer');
  }
  if (
    typeof obj['successful'] !== 'number' ||
    !Number.isInteger(obj['successful']) ||
    obj['successful'] < 0
  ) {
    throw new Error('successful must be a non-negative integer');
  }
  if (typeof obj['failed'] !== 'number' || !Number.isInteger(obj['failed']) || obj['failed'] < 0) {
    throw new Error('failed must be a non-negative integer');
  }

  if (!Array.isArray(obj['results'])) {
    throw new Error('results must be an array');
  }
  if (!Array.isArray(obj['expiredSubscriptions'])) {
    throw new Error('expiredSubscriptions must be an array');
  }

  return {
    total: obj['total'],
    successful: obj['successful'],
    failed: obj['failed'],
    results: obj['results'].map((r) => sendResultSchema.parse(r)),
    expiredSubscriptions: obj['expiredSubscriptions'].map((s) => {
      if (typeof s !== 'string') {
        throw new Error('expiredSubscriptions must contain strings');
      }
      return s;
    }),
  };
});

/**
 * Send notification response
 */
export type SendNotificationResponse = SharedSendNotificationResponse;

export const sendNotificationResponseSchema: Schema<SendNotificationResponse> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid send notification response');
    }
    const obj = data as Record<string, unknown>;

    const messageId = uuidSchema.parse(obj['messageId']);

    return {
      messageId,
      result: batchSendResultSchema.parse(obj['result']),
    };
  },
);

/**
 * VAPID key response
 */
export type VapidKeyResponse = SharedVapidKeyResponse;

export const vapidKeyResponseSchema: Schema<VapidKeyResponse> = createSchema((data: unknown) => {
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new Error('Invalid VAPID key response');
  }
  const obj = data as Record<string, unknown>;
  const rawPublicKey = obj['publicKey'];

  if (rawPublicKey !== null && rawPublicKey !== undefined && typeof rawPublicKey !== 'string') {
    throw new Error('publicKey must be a string or null');
  }

  const publicKey =
    typeof rawPublicKey === 'string' && rawPublicKey.length > 0 ? rawPublicKey : null;
  const enabled = typeof obj['enabled'] === 'boolean' ? obj['enabled'] : publicKey !== null;

  if (enabled && publicKey === null) {
    throw new Error('publicKey is required when push notifications are enabled');
  }

  const response: VapidKeyResponse = {
    enabled,
    publicKey,
  };

  if (typeof obj['message'] === 'string' && obj['message'].length > 0) {
    response.message = obj['message'];
  }

  return response;
});

/**
 * Preferences response
 */
export type PreferencesResponse = SharedPreferencesResponse;

export const preferencesResponseSchema: Schema<PreferencesResponse> = createSchema(
  (data: unknown) => {
    if (data === null || data === undefined || typeof data !== 'object') {
      throw new Error('Invalid preferences response');
    }
    const obj = data as Record<string, unknown>;

    if (
      obj['preferences'] === undefined ||
      obj['preferences'] === null ||
      typeof obj['preferences'] !== 'object'
    ) {
      throw new Error('preferences is required');
    }

    const prefs = obj['preferences'] as Record<string, unknown>;

    const userId = uuidSchema.parse(prefs['userId']);

    if (typeof prefs['globalEnabled'] !== 'boolean') {
      throw new Error('globalEnabled must be a boolean');
    }

    if (
      prefs['quietHours'] === undefined ||
      prefs['quietHours'] === null ||
      typeof prefs['quietHours'] !== 'object'
    ) {
      throw new Error('quietHours is required');
    }
    const qh = prefs['quietHours'] as Record<string, unknown>;

    if (
      prefs['types'] === undefined ||
      prefs['types'] === null ||
      typeof prefs['types'] !== 'object'
    ) {
      throw new Error('types is required');
    }

    const types: Record<NotificationType, { enabled: boolean; channels: NotificationChannel[] }> =
      {} as Record<NotificationType, { enabled: boolean; channels: NotificationChannel[] }>;

    const typesObj = prefs['types'] as Record<string, unknown>;
    for (const type of NOTIFICATION_TYPES) {
      const t = typesObj[type] as Record<string, unknown> | undefined;
      if (t !== undefined && typeof t === 'object') {
        types[type] = {
          enabled: typeof t['enabled'] === 'boolean' ? t['enabled'] : false,
          channels: Array.isArray(t['channels'])
            ? t['channels'].map((c) => notificationChannelSchema.parse(c))
            : [],
        };
      } else {
        types[type] = { enabled: false, channels: [] };
      }
    }

    let updatedAt: Date;
    if (prefs['updatedAt'] instanceof Date) {
      updatedAt = prefs['updatedAt'];
    } else if (typeof prefs['updatedAt'] === 'string' || typeof prefs['updatedAt'] === 'number') {
      updatedAt = new Date(prefs['updatedAt']);
    } else {
      throw new Error('updatedAt must be a date');
    }

    return {
      preferences: {
        userId,
        globalEnabled: prefs['globalEnabled'],
        quietHours: {
          enabled: typeof qh['enabled'] === 'boolean' ? qh['enabled'] : false,
          startHour:
            typeof qh['startHour'] === 'number' && qh['startHour'] >= 0 && qh['startHour'] <= 23
              ? qh['startHour']
              : 0,
          endHour:
            typeof qh['endHour'] === 'number' && qh['endHour'] >= 0 && qh['endHour'] <= 23
              ? qh['endHour']
              : 0,
          timezone: typeof qh['timezone'] === 'string' ? qh['timezone'] : 'UTC',
        },
        types,
        updatedAt,
      },
    };
  },
);
