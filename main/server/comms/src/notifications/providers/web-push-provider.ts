// main/server/comms/src/notifications/providers/web-push-provider.ts
/**
 * Web Push (VAPID) notification provider.
 *
 * Delivers browser push notifications via the standard Web Push protocol
 * using VAPID-signed requests. The `web-push` library handles payload
 * encryption and VAPID headers; this adapter maps the app's shared
 * `PushSubscription`/`NotificationPayload` shapes onto it and translates
 * push-service responses back into `SendResult`/`BatchSendResult`.
 *
 * A 404 or 410 from the push service means the subscription is dead; those
 * IDs are surfaced in `BatchSendResult.expiredSubscriptions` so the caller
 * can prune them.
 *
 * @module notifications/providers/web-push-provider
 */

import {
  type BatchSendResult,
  type NotificationPayload,
  type PushSubscription,
  type SendResult,
} from '@bslt/shared/comms/notifications';
import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from 'web-push';

import type {
  PushNotificationProvider,
  SendOptions,
  SubscriptionWithId,
  VapidConfig,
} from './types';

/** Push-service status codes meaning the subscription is gone and should be pruned. */
const EXPIRED_STATUS_CODES = new Set([404, 410]);

function isValidVapid(config: VapidConfig | undefined): config is VapidConfig {
  return (
    config !== undefined &&
    config.publicKey !== '' &&
    config.privateKey !== '' &&
    config.subject !== ''
  );
}

/** Map the app's shared subscription onto the `web-push` subscription shape. */
function toWebPushSubscription(subscription: PushSubscription): WebPushSubscription {
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  };
}

/** The JSON payload the service worker receives in its `push` event. */
function toPushPayload(payload: NotificationPayload): string {
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    image: payload.image,
    tag: payload.tag,
    data: { ...payload.data, url: payload.url },
    requireInteraction: payload.requireInteraction,
    silent: payload.silent,
  });
}

function toRequestOptions(options: SendOptions | undefined): webpush.RequestOptions | undefined {
  if (options === undefined) {
    return undefined;
  }
  const requestOptions: webpush.RequestOptions = {};
  if (options.ttl !== undefined) {
    requestOptions.TTL = options.ttl;
  }
  if (options.urgency !== undefined) {
    requestOptions.urgency = options.urgency;
  }
  if (options.topic !== undefined) {
    requestOptions.topic = options.topic;
  }
  return requestOptions;
}

export class WebPushProvider implements PushNotificationProvider {
  readonly name = 'web-push';
  private readonly config: VapidConfig | undefined;

  constructor(config?: VapidConfig) {
    this.config = isValidVapid(config) ? config : undefined;
    if (this.config !== undefined) {
      webpush.setVapidDetails(this.config.subject, this.config.publicKey, this.config.privateKey);
    }
  }

  isConfigured(): boolean {
    return this.config !== undefined;
  }

  /** The VAPID public key clients need to create a subscription. */
  getPublicKey(): string | undefined {
    return this.config?.publicKey;
  }

  async send(
    subscription: PushSubscription,
    payload: NotificationPayload,
    options?: SendOptions,
  ): Promise<SendResult> {
    return this.deliver(subscription.endpoint, subscription, payload, options);
  }

  async sendBatch(
    subscriptions: SubscriptionWithId[],
    payload: NotificationPayload,
    options?: SendOptions,
  ): Promise<BatchSendResult> {
    const results: SendResult[] = [];
    const expiredSubscriptions: string[] = [];

    for (const { id, subscription } of subscriptions) {
      const result = await this.deliver(id, subscription, payload, options);
      results.push(result);
      if (result.statusCode !== undefined && EXPIRED_STATUS_CODES.has(result.statusCode)) {
        expiredSubscriptions.push(id);
      }
    }

    return {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
      expiredSubscriptions,
    };
  }

  /** Send to one subscription, reporting the result under `subscriptionId`. */
  private async deliver(
    subscriptionId: string,
    subscription: PushSubscription,
    payload: NotificationPayload,
    options?: SendOptions,
  ): Promise<SendResult> {
    if (this.config === undefined) {
      return { success: false, subscriptionId, error: 'Web Push is not configured' };
    }

    try {
      const response = await webpush.sendNotification(
        toWebPushSubscription(subscription),
        toPushPayload(payload),
        toRequestOptions(options),
      );
      return { success: true, subscriptionId, statusCode: response.statusCode };
    } catch (error) {
      if (error instanceof WebPushError) {
        return {
          success: false,
          subscriptionId,
          error: error.message,
          statusCode: error.statusCode,
        };
      }
      return {
        success: false,
        subscriptionId,
        error: error instanceof Error ? error.message : 'Web Push send failed',
      };
    }
  }
}

/** Create a Web Push provider; unconfigured (no-op `isConfigured`) without valid VAPID keys. */
export function createWebPushProvider(config?: VapidConfig): WebPushProvider {
  return new WebPushProvider(config);
}
