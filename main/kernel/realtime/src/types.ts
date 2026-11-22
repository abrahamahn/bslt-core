// main/kernel/realtime/src/types.ts
/**
 * Realtime Module Types
 *
 * Dependency interfaces, internal types, and configuration for the realtime module.
 */

import type { ChannelRegistry } from './channels';
import type { RealtimeHub } from './hub';
import type { RecordMap } from './operations';
import type { SubscriptionManager } from './subscription-manager';
import type { WsTicketStore } from './tickets';
import type { BaseContext, RequestContext } from '@bslt/contract';
import type { DbClient } from '@bslt/db';
import type { Logger } from '@bslt/server-system/logger';

export interface RealtimeModuleDeps extends Omit<BaseContext, 'repos' | 'log'> {
  readonly db: DbClient;
  readonly pubsub: SubscriptionManager;
  readonly log: Logger;
  readonly config: {
    readonly env: string;
    readonly auth: {
      readonly cookie: {
        readonly secret: string;
      };
      readonly jwt: {
        readonly secret: string;
      };
    };
  };
  readonly ticketStore?: WsTicketStore;
  readonly channelRegistry?: ChannelRegistry;
  readonly hub?: RealtimeHub;
}

export type RealtimeRequest = RequestContext;

export interface RealtimeTablePolicy {
  readonly tableName: string;
  readonly readableColumns: readonly string[];
  readonly writableFields: readonly string[];
  readonly ownerColumn: string;
}

export interface WriteResult {
  recordMap: RecordMap;
}

export interface GetRecordsResult {
  recordMap: RecordMap;
}

export interface ConflictResult {
  message: string;
  conflictingRecords?: ReadonlyArray<{ table: string; id: string }> | undefined;
}

export interface RealtimeRouteResult<T> {
  status: number;
  body: T;
}
