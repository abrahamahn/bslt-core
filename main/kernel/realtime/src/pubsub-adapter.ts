// main/kernel/realtime/src/pubsub-adapter.ts
/**
 * Cross-instance Realtime `PubSubAdapter` (restructure plan §8.6):
 * - PostgreSQL `LISTEN`/`NOTIFY` default (`createPostgresPubSubAdapter`)
 * - Optional Redis/Valkey RESP adapter over `@bslt/protocols/resp` (`createRespPubSubAdapter`)
 */
import { randomBytes } from 'node:crypto';

import {
  createPostgresChannelListener,
  type DbClient,
  type PostgresChannelListener,
} from '@bslt/db';
import { createRespClient, type RespClient } from '@bslt/protocols/resp';

export type PubSubEnvelope =
  | {
      readonly kind: 'invalidation';
      readonly key: string;
      readonly version: number;
    }
  | {
      readonly kind: 'frame';
      readonly channel: string;
      readonly seq: number;
      readonly payload: unknown;
      readonly timestamp: number;
    }
  | {
      readonly kind: 'session_revoked';
      readonly userId: string;
      readonly sessionId?: string | undefined;
    };

interface WireEnvelope {
  readonly instanceId: string;
  readonly envelope: PubSubEnvelope;
}

export interface PubSubAdapter {
  readonly instanceId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(envelope: PubSubEnvelope): Promise<void>;
}

const DEFAULT_BUS_CHANNEL = 'bslt_realtime_bus';

function makeInstanceId(): string {
  return `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

function decodeEnvelope(
  raw: string,
  selfInstanceId: string,
  onError?: (error: Error) => void,
): PubSubEnvelope | null {
  try {
    const rawDecoded: unknown = JSON.parse(raw);
    if (rawDecoded === null || typeof rawDecoded !== 'object' || Array.isArray(rawDecoded)) {
      return null;
    }
    const parsed = rawDecoded as Partial<WireEnvelope>;
    if (typeof parsed.instanceId !== 'string' || parsed.envelope === undefined) {
      return null;
    }
    if (parsed.instanceId === selfInstanceId) {
      return null;
    }
    return parsed.envelope;
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

export function createPostgresPubSubAdapter(options: {
  readonly db: DbClient;
  readonly listenConnectionString: string;
  readonly ssl?: boolean | 'require' | 'prefer' | undefined;
  readonly channel?: string;
  readonly onEnvelope: (envelope: PubSubEnvelope) => void;
  readonly onError?: (error: Error) => void;
}): PubSubAdapter {
  const instanceId = makeInstanceId();
  const busChannel = options.channel ?? DEFAULT_BUS_CHANNEL;
  let listener: PostgresChannelListener | null = null;

  return {
    instanceId,
    async start(): Promise<void> {
      if (listener !== null) return;
      listener = createPostgresChannelListener({
        connectionString: options.listenConnectionString,
        channel: busChannel,
        ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
        onNotify: (payload: string) => {
          const decoded = decodeEnvelope(payload, instanceId, options.onError);
          if (decoded !== null) {
            options.onEnvelope(decoded);
          }
        },
        onError: (err: Error) => {
          options.onError?.(err);
        },
      });
      await listener.start();
    },

    async stop(): Promise<void> {
      if (listener === null) return;
      const current = listener;
      listener = null;
      await current.stop();
    },

    async publish(envelope: PubSubEnvelope): Promise<void> {
      const wire: WireEnvelope = { instanceId, envelope };
      await options.db.execute({
        text: 'SELECT pg_notify($1, $2)',
        values: [busChannel, JSON.stringify(wire)],
      });
    },
  };
}

export function createRespPubSubAdapter(options: {
  readonly host: string;
  readonly port: number;
  readonly password?: string;
  readonly tls?: boolean;
  readonly channel?: string;
  readonly onEnvelope: (envelope: PubSubEnvelope) => void;
  readonly onError?: (error: Error) => void;
}): PubSubAdapter {
  const instanceId = makeInstanceId();
  const busChannel = options.channel ?? DEFAULT_BUS_CHANNEL;
  let pubClient: RespClient | null = null;
  let subClient: RespClient | null = null;

  return {
    instanceId,
    async start(): Promise<void> {
      if (pubClient !== null || subClient !== null) return;
      const common = {
        host: options.host,
        port: options.port,
        ...(options.password !== undefined ? { password: options.password } : {}),
        ...(options.tls === true ? { tls: true } : {}),
      };
      pubClient = createRespClient(common);
      subClient = createRespClient(common);

      if (options.onError !== undefined) {
        pubClient.on('error', options.onError);
        subClient.on('error', options.onError);
      }

      await pubClient.connect();
      await subClient.subscribe(busChannel, (message) => {
        const decoded = decodeEnvelope(message, instanceId, options.onError);
        if (decoded !== null) {
          options.onEnvelope(decoded);
        }
      });
    },

    async stop(): Promise<void> {
      const p = pubClient;
      const s = subClient;
      pubClient = null;
      subClient = null;
      await Promise.all([p?.close(), s?.close()]);
    },

    async publish(envelope: PubSubEnvelope): Promise<void> {
      if (pubClient === null) {
        throw new Error('RespPubSubAdapter is not started');
      }
      const wire: WireEnvelope = { instanceId, envelope };
      await pubClient.publish(busChannel, JSON.stringify(wire));
    },
  };
}
