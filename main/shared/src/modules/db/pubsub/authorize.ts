// main/shared/src/modules/db/pubsub/authorize.ts
/**
 * Subscription key authorization.
 *
 * The pub/sub bus lets a connected socket name the keys it wants. That is fine
 * while every key is public — a task board, an online count, a status feed —
 * because the frame carries no payload, only `{key, version}`, and the client
 * refetches over an authenticated HTTP route afterwards.
 *
 * It stops being fine the moment a key is *per user*. `record:notifications:{userId}`
 * is guessable from any other user's id, and while subscribing to it would leak
 * no notification text, it would leak the timing and rate of another person's
 * notifications — and it would wake their bell on someone else's screen. So the
 * server, which is the only party that knows who a socket belongs to, decides.
 *
 * Everything not in `PER_USER_RECORD_TABLES` stays open; this is a deny-list for
 * the namespaces that are private by construction, not a new permission system.
 */

import { SubKeys, parseRecordKey } from './types';

import type { RecordKey } from './types';

/** Record table whose id component IS a user id. */
export const NOTIFICATIONS_CHANNEL_TABLE = 'notifications';

/**
 * Tables addressed as `record:{table}:{userId}`. Only the owning user may
 * subscribe to, or receive delta-sync history for, one of these keys.
 */
export const PER_USER_RECORD_TABLES: ReadonlySet<string> = new Set([NOTIFICATIONS_CHANNEL_TABLE]);

/**
 * The realtime key carrying a single user's notification-feed invalidations.
 * Server publishes here on create; the browser subscribes here and refetches.
 *
 * @param userId - Owner of the feed
 * @complexity O(1)
 */
export function notificationsChannel(userId: string): RecordKey {
  return SubKeys.record(NOTIFICATIONS_CHANNEL_TABLE, userId);
}

/**
 * Whether `userId` may subscribe to `key`.
 *
 * Unparseable and non-record keys are allowed — they are the public channels the
 * bus already carried, and this function is not the place to start rejecting
 * them. A key in a per-user namespace is allowed only to its owner.
 *
 * @param key - Subscription key requested by the client
 * @param userId - Authenticated user behind the socket
 * @returns Whether the subscription is permitted
 * @complexity O(1)
 */
export function canSubscribeToKey(key: string, userId: string): boolean {
  const parsed = parseRecordKey(key);
  if (parsed === undefined) return true;
  if (!PER_USER_RECORD_TABLES.has(parsed.table)) return true;
  return parsed.id === userId && userId !== '';
}
