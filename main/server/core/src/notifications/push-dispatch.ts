// main/server/core/src/notifications/push-dispatch.ts
/**
 * Browser Web Push delivery.
 *
 * Sends a notification to a user's registered push subscriptions via the
 * injected push provider (the comms `WebPushProvider`, reached through the
 * `ctx.notifications` contract). Subscriptions the push service reports as
 * gone (404/410) are pruned. Best-effort: failures are logged, never thrown,
 * so push problems can't break the in-app notification path.
 *
 * @module notifications/push-dispatch
 */

import type { NotificationModuleDeps } from './types';
import type {
  BatchSendResult,
  NotificationPayload,
  PushSubscription,
} from '@bslt/shared/comms/notifications';

/** The subset of the push provider this dispatcher needs. */
interface PushProvider {
  isConfigured(): boolean;
  sendBatch(
    subscriptions: Array<{ id: string; subscription: PushSubscription }>,
    payload: NotificationPayload,
  ): Promise<BatchSendResult>;
}

/** Narrow the contract's `unknown` provider to the shape we use, or undefined. */
function asPushProvider(value: unknown): PushProvider | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PushProvider).isConfigured === 'function' &&
    typeof (value as PushProvider).sendBatch === 'function'
  ) {
    return value as PushProvider;
  }
  return undefined;
}

interface PushRequest {
  payload: { title: string; body: string; url?: string; data?: Record<string, unknown> };
}

/**
 * Deliver a Web Push notification to every active subscription of a user.
 *
 * No-op when no provider is configured or the user has no subscriptions.
 * Prunes subscriptions reported expired by the push service.
 */
export async function deliverWebPush(
  ctx: NotificationModuleDeps,
  userId: string,
  request: PushRequest,
): Promise<void> {
  const provider = asPushProvider(ctx.notifications?.getWebPushProvider?.());
  if (provider === undefined || !provider.isConfigured()) {
    return;
  }

  try {
    const stored = await ctx.repos.pushSubscriptions.findByUserId(userId);
    if (stored.length === 0) {
      return;
    }

    const payload: NotificationPayload = {
      title: request.payload.title,
      body: request.payload.body,
      ...(request.payload.url !== undefined ? { url: request.payload.url } : {}),
      ...(request.payload.data !== undefined ? { data: request.payload.data } : {}),
    };

    // Use the endpoint as the batch id so an expired endpoint can be pruned
    // directly via deleteByEndpoint.
    const batch = stored.map((sub) => ({
      id: sub.endpoint,
      subscription: {
        endpoint: sub.endpoint,
        expirationTime: null,
        keys: { p256dh: sub.keysP256dh, auth: sub.keysAuth },
      },
    }));

    const result = await provider.sendBatch(batch, payload);

    for (const endpoint of result.expiredSubscriptions) {
      await ctx.repos.pushSubscriptions.deleteByEndpoint(endpoint).catch((err: unknown) => {
        ctx.log.warn({ err, endpoint }, 'Failed to prune expired push subscription');
      });
    }
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'deliverWebPush', userId },
      'Web push delivery failed',
    );
  }
}
