// main/server/core/src/notifications/subscriptions.ts
/**
 * Notification Subscriptions
 *
 * Business logic for push subscription management (subscribe, unsubscribe,
 * counts). Uses database persistence.
 */

import { and, deleteFrom, eq, insert, select, selectCount, update } from '@bslt/db/builder';
import {
  PUSH_SUBSCRIPTIONS_TABLE,
  PUSH_SUBSCRIPTION_COLUMNS,
  type PushSubscription as DbPushSubscription,
} from '@bslt/db/schema';
import { toCamelCase } from '@bslt/db/utils';
import { SubscriptionExistsError, type PushSubscription } from '@bslt/shared/comms/notifications';

import type { DbClient } from '@bslt/db/client';

/**
 * Subscribe a user to push notifications.
 *
 * If an endpoint already exists for the same user, the subscription is
 * reactivated and updated. If the endpoint belongs to a different user,
 * a SubscriptionExistsError is thrown.
 *
 * @param db - Database client
 * @param userId - User ID
 * @param subscription - Push subscription from browser
 * @param deviceId - Device identifier
 * @param userAgent - User agent string
 * @returns Subscription ID
 * @throws {SubscriptionExistsError} If the endpoint is registered to another user
 * @throws {Error} If the subscription insert fails
 * @complexity O(1) - single query + conditional update or insert
 */
export async function subscribe(
  db: DbClient,
  userId: string,
  subscription: PushSubscription,
  deviceId: string,
  userAgent: string,
): Promise<string> {
  // Check if endpoint already exists
  const existingRow = await db.queryOne(
    select(PUSH_SUBSCRIPTIONS_TABLE).where(eq('endpoint', subscription.endpoint)).limit(1).toSql(),
  );

  if (existingRow !== null) {
    const existing = toCamelCase<DbPushSubscription>(existingRow, PUSH_SUBSCRIPTION_COLUMNS);
    if (existing.userId === userId) {
      // Update existing subscription - reactivate and update lastUsedAt
      await db.execute(
        update(PUSH_SUBSCRIPTIONS_TABLE)
          .set({
            is_active: true,
            last_used_at: new Date(),
            keys_p256dh: subscription.keys.p256dh,
            keys_auth: subscription.keys.auth,
            expiration_time:
              subscription.expirationTime !== null && subscription.expirationTime !== 0
                ? new Date(subscription.expirationTime)
                : null,
          })
          .where(eq('id', existing.id))
          .toSql(),
      );
      return existing.id;
    }
    throw new SubscriptionExistsError('Endpoint already registered to another user');
  }

  // Create new subscription
  const newSubRows = await db.query(
    insert(PUSH_SUBSCRIPTIONS_TABLE)
      .values({
        user_id: userId,
        endpoint: subscription.endpoint,
        expiration_time:
          subscription.expirationTime !== null && subscription.expirationTime !== 0
            ? new Date(subscription.expirationTime)
            : null,
        keys_p256dh: subscription.keys.p256dh,
        keys_auth: subscription.keys.auth,
        device_id: deviceId,
        user_agent: userAgent !== '' ? userAgent : null,
        is_active: true,
      })
      .returning('id')
      .toSql(),
  );

  if (newSubRows[0] === undefined) {
    throw new Error('Failed to create subscription');
  }

  return (newSubRows[0] as { id: string }).id;
}

/**
 * Unsubscribe from push notifications.
 *
 * Removes a subscription by ID or endpoint URL, scoped to the owning user so
 * one user cannot remove another user's subscription by guessing identifiers.
 * At least one identifier must be provided.
 *
 * @param db - Database client
 * @param userId - Owning user ID (subscriptions of other users are untouched)
 * @param subscriptionId - Subscription ID to remove
 * @param endpoint - Alternative: endpoint URL to remove
 * @returns true if subscription was found and removed
 * @complexity O(1) - single delete query
 */
export async function unsubscribe(
  db: DbClient,
  userId: string,
  subscriptionId?: string,
  endpoint?: string,
): Promise<boolean> {
  let result: Record<string, unknown>[];

  if (subscriptionId !== undefined && subscriptionId !== '') {
    result = await db.query(
      deleteFrom(PUSH_SUBSCRIPTIONS_TABLE)
        .where(and(eq('id', subscriptionId), eq('user_id', userId)))
        .returning('id')
        .toSql(),
    );
  } else if (endpoint !== undefined && endpoint !== '') {
    result = await db.query(
      deleteFrom(PUSH_SUBSCRIPTIONS_TABLE)
        .where(and(eq('endpoint', endpoint), eq('user_id', userId)))
        .returning('id')
        .toSql(),
    );
  } else {
    return false;
  }

  return result.length > 0;
}

/**
 * Get subscription count (for testing/monitoring).
 *
 * @param db - Database client
 * @returns Total number of subscriptions
 * @complexity O(1) - aggregate count query
 */
export async function getSubscriptionCount(db: DbClient): Promise<number> {
  const result = await db.queryOne<{ count: number }>(
    selectCount(PUSH_SUBSCRIPTIONS_TABLE).toSql(),
  );
  return result?.count ?? 0;
}
