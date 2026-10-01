// main/shared/src/modules/db/pubsub/types.ts
/**
 * Pub/Sub Types
 *
 * Subscription Key Format:
 * - `record:{table}:{id}` - Single record updates
 * - `list:{userId}:{listType}` - List/collection updates
 */

/** Minimal WebSocket interface for our pub/sub needs. */
export interface WebSocket {
  /** The current state of the connection (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED) */
  readyState: number;
  /** Send data to the client */
  send(data: string): void;
}

/** Subscription key for a single record. */
export type RecordKey = `record:${string}:${string}`;
/** Subscription key for a list/collection. */
export type ListKey = `list:${string}:${string}`;
/** Unified subscription key type. */
export type SubscriptionKey = RecordKey | ListKey;

/** Messages sent from client to server. */
export type ClientMessage =
  | { type: 'subscribe'; key: SubscriptionKey }
  | { type: 'unsubscribe'; key: SubscriptionKey }
  | { type: 'sync_request'; lastTimestamp: number; keys: SubscriptionKey[] };

/** Messages sent from server to client. */
export type ServerMessage =
  | { type: 'update'; key: SubscriptionKey; version: number; timestamp?: number }
  | {
      type: 'sync_response';
      messages: Array<{ key: SubscriptionKey; version: number; timestamp: number }>;
    };

/** Result of parsing a record subscription key. */
export interface ParsedRecordKey {
  /** Table name */
  table: string;
  /** Record identifier */
  id: string;
}

/**
 * Parse a record subscription key into table and id.
 * Returns undefined if the key is not a valid record key format.
 *
 * Valid format: `record:{table}:{id}`
 * - table: alphanumeric and underscores, starts with letter or underscore
 * - id: alphanumeric, hyphens, and underscores (UUID-safe)
 */
export function parseRecordKey(key: string): ParsedRecordKey | undefined {
  const parts = key.split(':');
  if (parts.length !== 3 || parts[0] !== 'record') return undefined;

  const [, table, id] = parts;
  if (table == null || table === '' || id == null || id === '') return undefined;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return undefined;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return undefined;

  return { table, id };
}

/** Helper to create standardized subscription keys. */
export const SubKeys = {
  /** Create a key for a single record update. */
  record: (table: string, id: string): RecordKey => `record:${table}:${id}`,
  /** Create a key for a list/collection update. */
  list: (userId: string, listType: string): ListKey => `list:${userId}:${listType}`,
} as const;
