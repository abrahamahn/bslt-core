// main/kernel/realtime/src/websocket/index.ts
/**
 * WebSocket Module
 *
 * WebSocket lifecycle management, statistics, and connection handling.
 */

export {
  defaultGatewayTicketStore,
  registerWebSocket,
  type TokenClaims,
  type WebSocketDeps,
} from './lifecycle';

export {
  decrementConnections,
  getWebSocketStats,
  incrementConnections,
  markPluginRegistered,
  resetStats,
} from './stats';

export type { PubSubWebSocket } from '../subscription-manager';
export type { SubscriptionKey } from '@bslt/contract';
export type { WebSocketStats } from '@bslt/server-system/runtime';
