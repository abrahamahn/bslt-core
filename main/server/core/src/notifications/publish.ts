// main/server/core/src/notifications/publish.ts
/**
 * The realtime half of a notification.
 *
 * Nothing published when a notification was created, so the bell had no honest
 * option but to poll. This is the missing publish, and it follows the bus's
 * existing contract exactly: the frame carries `{key, version}` and no payload
 * at all. The browser reads it as "your feed changed" and refetches over the
 * authenticated list route.
 *
 * That is deliberate, and it is what makes the feature both safe and
 * idempotent:
 *
 *  - No notification text ever crosses the socket, so a subscription mistake
 *    could leak timing at worst, never content — and `canSubscribeToKey` on the
 *    server closes that too.
 *  - The unread count and the list always come from one authoritative HTTP
 *    response keyed by notification id, so a push followed by the next poll
 *    cannot double-count. There is nothing to merge and nothing to add up.
 *
 * Delivery is best-effort. Publishing must never fail the write that caused it:
 * the notification is already in the database, and the client's fallback poll
 * finds it within one interval regardless. A realtime channel that can fail a
 * write is worse than no realtime channel.
 *
 * @module notifications/publish
 */

import { notificationsChannel } from '@bslt/shared/db';

/** The slice of the pub/sub bus this module needs. */
export interface NotificationPubSub {
  publish(key: `record:${string}:${string}`, version: number): void;
}

/** Whether an unknown context value can act as the bus. */
function isPubSub(value: unknown): value is NotificationPubSub {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { publish?: unknown }).publish === 'function'
  );
}

/**
 * Announce that `userId`'s notification feed changed.
 *
 * `version` is a timestamp rather than a row version because the channel stands
 * for a whole FEED, not one record — it only has to differ from the last value
 * to be a valid invalidation.
 *
 * @param pubsub - The context's pub/sub bus, or undefined when none is wired
 * @param userId - Owner of the feed that changed
 * @complexity O(n) where n is that user's connected sockets
 */
export function publishNotificationCreated(pubsub: unknown, userId: string): void {
  if (!isPubSub(pubsub) || userId === '') return;
  try {
    pubsub.publish(notificationsChannel(userId), Date.now());
  } catch {
    // Realtime is best-effort; the client's fallback poll covers the gap.
  }
}
