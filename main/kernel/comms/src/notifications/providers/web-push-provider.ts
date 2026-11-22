// main/kernel/comms/src/notifications/providers/web-push-provider.ts
/**
 * Web Push (VAPID) notification provider.
 *
 * Delivers browser push notifications via the owned Web Push protocol
 * implementation (`@bslt/protocols/webpush`: RFC 8291 `aes128gcm` encryption +
 * RFC 8292 VAPID ES256 headers).
 *
 * A 404 or 410 from the push service means the subscription is dead; those
 * IDs are surfaced in `BatchSendResult.expiredSubscriptions` so the caller
 * can prune them.
 *
 * @module notifications/providers/web-push-provider
 */

import {
  sendWebPushNotification,
  WebPushProtocolError,
  type SendWebPushOptions,
  type WebPushSubscription,
} from '@bslt/protocols/webpush';

import type {
  BatchSendResult,
  NotificationPayload,
  PushNotificationProvider,
  PushSubscription,
  SendOptions,
  SendResult,
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

/** Map the app's shared subscription onto `@bslt/protocols/webpush` subscription shape. */
function toProtocolSubscription(subscription: PushSubscription): WebPushSubscription {
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

function toProtocolOptions(options: SendOptions | undefined): SendWebPushOptions | undefined {
  if (options === undefined) {
    return undefined;
  }
  return {
    ...(options.ttl !== undefined ? { ttl: options.ttl } : {}),
    ...(options.urgency !== undefined ? { urgency: options.urgency } : {}),
    ...(options.topic !== undefined ? { topic: options.topic } : {}),
  };
}

export class WebPushProvider implements PushNotificationProvider {
  readonly name = 'web-push';
  private readonly config: VapidConfig | undefined;

  constructor(config?: VapidConfig) {
    this.config = isValidVapid(config) ? config : undefined;
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
      const response = await sendWebPushNotification(
        toProtocolSubscription(subscription),
        toPushPayload(payload),
        this.config,
        toProtocolOptions(options),
      );
      return { success: true, subscriptionId, statusCode: response.statusCode };
    } catch (error) {
      if (error instanceof WebPushProtocolError) {
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
