// main/kernel/realtime/src/index.ts
/**
 * Realtime Package (`@bslt/realtime`, restructure plan §8.6).
 */

// Channel registry (deny-by-default)
export {
  createChannelRegistry,
  defaultChannelRegistry,
  defineChannel,
  type ChannelRegistry,
  type ChannelViewer,
} from './channels';

// Single-use WS tickets & server-signed channel grants
export {
  createTicketStore,
  signChannelGrant,
  verifyChannelGrant,
  type WsTicketStore,
} from './tickets';

// Hub (sequenced frames, invalidation, presence, slow-consumer & rate limits)
export { createRealtimeHub, type HubSocket, type RealtimeHub } from './hub';

// PubSub adapters (Postgres default, RESP optional)
export {
  createPostgresPubSubAdapter,
  createRespPubSubAdapter,
  type PubSubAdapter,
  type PubSubEnvelope,
} from './pubsub-adapter';

// Routes
export { buildRealtimeTicketRouteMap, realtimeRoutes } from './routes';

// Record handlers & table allowlist
export {
  handleGetRecords,
  handleWrite,
  RecordNotFoundError,
  VersionConflictError,
} from './handlers';

export {
  isFieldWritable,
  isTableAllowed,
  loadRecords,
  registerRealtimeTable,
  resolveTableName,
  saveRecords,
} from './service';

export {
  applyOperation,
  applyOperations,
  checkVersionConflicts,
  getOperationPointers,
  isFieldMutable,
  PROTECTED_FIELDS,
  REALTIME_ERRORS,
  type ApplyOperationsResult,
  type RealtimeTransaction,
  type VersionConflict,
} from './operations';

export { SubscriptionManager } from './subscription-manager';

// WebSocket gateway
export {
  decrementConnections,
  defaultGatewayTicketStore,
  getWebSocketStats,
  incrementConnections,
  markPluginRegistered,
  registerWebSocket,
  resetStats,
  type PubSubWebSocket,
  type SubscriptionKey,
  type TokenClaims,
  type WebSocketDeps,
  type WebSocketStats,
} from './websocket';

// Types
export type {
  ConflictResult,
  GetRecordsResult,
  RealtimeModuleDeps,
  RealtimeRequest,
  RealtimeTablePolicy,
  WriteResult,
} from './types';
