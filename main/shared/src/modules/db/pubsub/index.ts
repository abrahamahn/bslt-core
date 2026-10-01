// main/shared/src/modules/db/pubsub/index.ts
/**
 * Real-time Pub/Sub System
 *
 * Adopted from Chet-stack's WebSocket subscription pattern.
 * Enables optimistic UI by notifying clients when data changes.
 *
 * NOTE: PostgresPubSub (server-only) is exported separately from './postgres.pubsub'
 * to avoid bundling Node.js dependencies in browser code.
 */

// Types (browser-safe)
export { SubKeys, parseRecordKey } from './types';
export type {
  ClientMessage,
  ListKey,
  ParsedRecordKey,
  RecordKey,
  ServerMessage,
  SubscriptionKey,
  WebSocket,
} from './types';

// Subscription key authorization (browser-safe)
export {
  NOTIFICATIONS_CHANNEL_TABLE,
  PER_USER_RECORD_TABLES,
  canSubscribeToKey,
  notificationsChannel,
} from './authorize';

// Subscription manager (browser-safe - only uses type import from postgres-pubsub)
export { SubscriptionManager } from './subscription.manager';
export type { MessageHistoryEntry, SubscriptionManagerOptions } from './subscription.manager';

// Helpers (browser-safe)
export { publishAfterWrite } from './helpers';

// Re-export types from postgres-pubsub (type-only, no runtime code)
export type { PostgresPubSub, PostgresPubSubOptions, PubSubMessage } from './postgres.pubsub';
