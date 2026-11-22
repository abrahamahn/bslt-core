// main/kernel/server/src/module/outbox.ts
/**
 * Transactional Outbox Dispatcher (`sys.outbox.dispatch`, Plan §8.3).
 *
 * Wakes on `NOTIFY bslt_outbox` (`LISTEN_DATABASE_URL`) with a 1s poll fallback,
 * claims undispatched `sys_outbox` rows via `FOR UPDATE SKIP LOCKED`, enqueues
 * one durable `sys_jobs` row per matching subscriber with idempotency key
 * `${eventId}:${moduleId}.${subscriberId}`, marks `dispatched_at`, and emits
 * ephemeral `realtime` projections once the claim transaction commits.
 */
import {
  claimUndispatchedOutboxRows,
  createPostgresChannelListener,
  markOutboxDispatched,
  PostgresQueueStore,
  pruneDispatchedOutbox,
  type DbClient,
  type PostgresChannelListener,
  type QueueServerJobSpec,
  type TaskHandlers,
} from '@bslt/db';

import { unsealEventPayload } from './sealed';

import type { Logger } from '../logger/types';
import type { DeliveredEvent, InstantiatedServerModule } from './server-module';
import type { EventDef } from '@bslt/contract';

export const SUBSCRIBER_JOB_PREFIX = 'sys.outbox.sub:';
const OUTBOX_NOTIFY_CHANNEL = 'bslt_outbox';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SUBSCRIBER_MAX_ATTEMPTS = 5;
const DEFAULT_SUBSCRIBER_TIMEOUT_MS = 30_000;

interface RegisteredSubscriber {
  readonly moduleId: string;
  readonly subscriberId: string;
  readonly jobName: string;
  readonly kind: 'direct' | 'flagged';
  readonly eventName?: string | undefined;
  readonly flag?: 'webhook' | 'audit' | 'activity' | 'notify' | 'analytics' | undefined;
}

interface SubscriberJobArgs {
  readonly eventId: string;
  readonly name: string;
  readonly version: number;
  readonly payload: unknown;
  readonly sealed?: string | undefined;
  readonly actorUserId: string | null;
  readonly orgId: string | null;
  readonly occurredAt: string;
}

interface RealtimeProjection {
  readonly channel: string;
  readonly invalidate?: readonly string[];
}

function parseRowPayload(raw: Record<string, unknown> | string): unknown {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as unknown;
  }
  return raw;
}

function normalizeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function eventHasFlag(
  def: EventDef | undefined,
  flag: 'webhook' | 'audit' | 'activity' | 'notify' | 'analytics',
): boolean {
  if (def === undefined) return false;
  switch (flag) {
    case 'webhook':
      return def.webhook === true;
    case 'audit':
      return def.audit !== undefined;
    case 'activity':
      return def.activity === true;
    case 'notify':
      return def.notify !== undefined;
    case 'analytics':
      return def.analytics !== undefined;
  }
}

export function collectModuleSubscribers(
  instances: ReadonlyMap<string, InstantiatedServerModule> | readonly InstantiatedServerModule[],
  options: { readonly sealSecret: string },
): {
  readonly subscribers: readonly RegisteredSubscriber[];
  readonly eventsByName: ReadonlyMap<string, EventDef>;
  readonly handlers: TaskHandlers;
  readonly jobSpecs: Readonly<Record<string, QueueServerJobSpec>>;
} {
  const list: readonly InstantiatedServerModule[] = Array.isArray(instances)
    ? instances
    : [...(instances as ReadonlyMap<string, InstantiatedServerModule>).values()];

  const eventsByName = new Map<string, EventDef>();
  for (const inst of list) {
    for (const evDef of Object.values(inst.module.events)) {
      eventsByName.set(evDef.name, evDef);
    }
  }

  const subscribers: RegisteredSubscriber[] = [];
  const handlers: TaskHandlers = {};
  const jobSpecs: Record<string, QueueServerJobSpec> = {};

  for (const inst of list) {
    for (const sub of inst.subscribers) {
      const jobName = `${SUBSCRIBER_JOB_PREFIX}${inst.module.id}.${sub.id}`;
      const reg: RegisteredSubscriber =
        sub.kind === 'direct'
          ? {
              moduleId: inst.module.id,
              subscriberId: sub.id,
              jobName,
              kind: 'direct',
              eventName: sub.event.name,
            }
          : {
              moduleId: inst.module.id,
              subscriberId: sub.id,
              jobName,
              kind: 'flagged',
              flag: sub.flag,
            };
      subscribers.push(reg);

      jobSpecs[jobName] = {
        queue: 'default',
        maxAttempts: DEFAULT_SUBSCRIBER_MAX_ATTEMPTS,
        timeoutMs: DEFAULT_SUBSCRIBER_TIMEOUT_MS,
      };

      handlers[jobName] = async (rawArgs: unknown): Promise<void> => {
        const args = rawArgs as SubscriberJobArgs;
        const knownEventDef = sub.kind === 'direct' ? sub.event : eventsByName.get(args.name);
        const sealedBuf =
          typeof args.sealed === 'string' && args.sealed.length > 0
            ? Buffer.from(args.sealed, 'base64')
            : null;
        const aad = `${args.name}:v${String(args.version)}`;

        const hydratedPayload =
          knownEventDef !== undefined
            ? unsealEventPayload(
                knownEventDef.payload,
                args.payload,
                sealedBuf,
                options.sealSecret,
                aad,
              )
            : args.payload;

        const delivered: DeliveredEvent = {
          eventId: args.eventId,
          name: args.name,
          version: args.version,
          payload: hydratedPayload,
          actorUserId: args.actorUserId,
          orgId: args.orgId,
          occurredAt: args.occurredAt,
          ...(knownEventDef !== undefined ? { def: knownEventDef } : {}),
        };

        await inst.invokeSubscriber(sub.id, delivered);
      };
    }
  }

  return { subscribers, eventsByName, handlers, jobSpecs };
}

interface OutboxDispatcherOptions {
  readonly db: DbClient;
  readonly subscribers: readonly RegisteredSubscriber[];
  readonly eventsByName: ReadonlyMap<string, EventDef>;
  readonly log: Logger;
  readonly listenConnectionString?: string | undefined;
  readonly ssl?: boolean | 'require' | 'prefer' | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly batchSize?: number | undefined;
  readonly onRealtime?: ((projection: RealtimeProjection) => void | Promise<void>) | undefined;
  readonly onSessionRevoked?:
    | ((revocation: {
        readonly userId: string;
        readonly sessionId?: string | undefined;
      }) => void | Promise<void>)
    | undefined;
  readonly listenerFactory?:
    | ((opts: {
        readonly onNotify: (payload: string) => void;
        readonly onError: (error: Error) => void;
      }) => PostgresChannelListener)
    | undefined;
}

interface OutboxDispatcher {
  dispatchBatch(batchSize?: number): Promise<number>;
  pruneDispatched(retentionMs: number): Promise<number>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createOutboxDispatcher(options: OutboxDispatcherOptions): OutboxDispatcher {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const defaultBatchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const state = { running: false };
  let loopPromise: Promise<void> | null = null;
  let sleepAbort: AbortController | null = null;
  let wakeRequested = false;
  let listener: PostgresChannelListener | null = null;

  function requestWake(): void {
    wakeRequested = true;
    if (sleepAbort !== null) {
      sleepAbort.abort();
    }
  }

  async function dispatchBatch(batchSize: number = defaultBatchSize): Promise<number> {
    const realtimeQueue: RealtimeProjection[] = [];
    const sessionRevocations: Array<{
      readonly userId: string;
      readonly sessionId?: string | undefined;
    }> = [];

    const claimedCount = await options.db.transaction(async (tx) => {
      const rows = await claimUndispatchedOutboxRows(tx, batchSize);

      if (rows.length === 0) {
        return 0;
      }

      const nowIso = new Date().toISOString();
      const store = new PostgresQueueStore(tx);

      for (const row of rows) {
        const parsedPayload = parseRowPayload(row.payload);
        const eventDef = options.eventsByName.get(row.name);

        if (
          row.name === 'identity.session.revoked' &&
          parsedPayload !== null &&
          typeof parsedPayload === 'object' &&
          !Array.isArray(parsedPayload)
        ) {
          const record = parsedPayload as Record<string, unknown>;
          const userId = record['userId'];
          const sessionId = record['sessionId'];
          if (typeof userId === 'string' && userId !== '') {
            sessionRevocations.push({
              userId,
              ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
            });
          }
        }

        if (eventDef?.realtime !== undefined) {
          try {
            realtimeQueue.push(eventDef.realtime(parsedPayload));
          } catch (err) {
            options.log.warn(
              { err, eventName: row.name, eventId: row.id },
              'Failed to compute realtime projection for outbox event',
            );
          }
        }

        const occurredIso = normalizeTimestamp(row.occurred_at);
        const matching = options.subscribers.filter((sub) =>
          sub.kind === 'direct'
            ? sub.eventName === row.name
            : sub.flag !== undefined && eventHasFlag(eventDef, sub.flag),
        );

        for (const sub of matching) {
          const idempotencyKey = `${row.id}:${sub.moduleId}.${sub.subscriberId}`;
          const jobArgs: SubscriberJobArgs = {
            eventId: row.id,
            name: row.name,
            version: row.version,
            payload: parsedPayload,
            ...(row.sealed_b64 !== null && row.sealed_b64 !== '' ? { sealed: row.sealed_b64 } : {}),
            actorUserId: row.actor_user_id,
            orgId: row.org_id,
            occurredAt: occurredIso,
          };

          await store.enqueue({
            id: crypto.randomUUID(),
            name: sub.jobName,
            queue: 'default',
            priority: 0,
            args: jobArgs,
            scheduledAt: nowIso,
            attempts: 0,
            maxAttempts: DEFAULT_SUBSCRIBER_MAX_ATTEMPTS,
            createdAt: nowIso,
            idempotencyKey,
          });
        }
      }

      const ids = rows.map((r) => r.id);
      await markOutboxDispatched(tx, ids, nowIso);

      return rows.length;
    });

    if (options.onRealtime !== undefined) {
      for (const proj of realtimeQueue) {
        try {
          await options.onRealtime(proj);
        } catch (err) {
          options.log.warn({ err, channel: proj.channel }, 'Realtime projection publish failed');
        }
      }
    }

    if (options.onSessionRevoked !== undefined) {
      for (const rev of sessionRevocations) {
        try {
          await options.onSessionRevoked(rev);
        } catch (err) {
          options.log.warn(
            { err, userId: rev.userId },
            'Session revocation realtime propagation failed',
          );
        }
      }
    }

    return claimedCount;
  }

  async function pruneDispatched(retentionMs: number): Promise<number> {
    const cutoffIso = new Date(Date.now() - retentionMs).toISOString();
    return pruneDispatchedOutbox(options.db, cutoffIso);
  }

  function sleepOrWake(ms: number): Promise<void> {
    if (wakeRequested) {
      wakeRequested = false;
      return Promise.resolve();
    }
    const controller = new AbortController();
    sleepAbort = controller;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (sleepAbort === controller) {
          sleepAbort = null;
        }
        resolve();
      }, ms);
      controller.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          if (sleepAbort === controller) {
            sleepAbort = null;
          }
          wakeRequested = false;
          resolve();
        },
        { once: true },
      );
    });
  }

  const isRunning = (): boolean => state.running;

  async function runLoop(): Promise<void> {
    while (isRunning()) {
      try {
        let claimed = await dispatchBatch(defaultBatchSize);
        while (isRunning() && claimed === defaultBatchSize) {
          claimed = await dispatchBatch(defaultBatchSize);
        }
      } catch (err) {
        options.log.error(
          err instanceof Error ? err.message : String(err),
          'sys.outbox.dispatch poll error',
        );
      }
      if (!isRunning()) break;
      await sleepOrWake(pollIntervalMs);
    }
  }

  return {
    dispatchBatch,
    pruneDispatched,
    async start(): Promise<void> {
      if (state.running) return;
      state.running = true;
      wakeRequested = false;

      if (options.listenerFactory !== undefined) {
        listener = options.listenerFactory({
          onNotify: () => {
            requestWake();
          },
          onError: (err) => {
            options.log.warn({ err }, 'Outbox LISTEN session warning');
          },
        });
        await listener.start();
      } else if (
        options.listenConnectionString !== undefined &&
        options.listenConnectionString !== ''
      ) {
        listener = createPostgresChannelListener({
          connectionString: options.listenConnectionString,
          channel: OUTBOX_NOTIFY_CHANNEL,
          ssl: options.ssl,
          onNotify: () => {
            requestWake();
          },
          onError: (err) => {
            options.log.warn({ err }, 'Outbox LISTEN session warning');
          },
        });
        await listener.start();
      }

      loopPromise = runLoop();
    },
    async stop(): Promise<void> {
      if (!state.running) return;
      state.running = false;
      requestWake();
      if (loopPromise !== null) {
        await loopPromise;
        loopPromise = null;
      }
      if (listener !== null) {
        await listener.stop();
        listener = null;
      }
    },
  };
}
