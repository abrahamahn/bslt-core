// main/apps/server/src/bootstrap/phases/workers.ts

import { createQueueServer, queuesForRole, REQUIRED_TABLES, validateSchema } from '@bslt/db';
import { verifyToken } from '@bslt/identity/server';
import {
  createPostgresPubSubAdapter,
  createRespPubSubAdapter,
  getWebSocketStats,
  registerWebSocket,
  resolveTableName,
  type PubSubAdapter,
  type PubSubEnvelope,
} from '@bslt/realtime';
import { buildListenConnectionString } from '@bslt/server-system/config';
import { createCronScheduler, createKernelCrons } from '@bslt/server-system/cron';
import {
  collectModuleJobs,
  collectModuleSubscribers,
  createKernelJobsService,
  createOutboxDispatcher,
  registerModuleCrons,
} from '@bslt/server-system/module';
import { logStartupSummary } from '@bslt/server-system/runtime';

import { createWebSocketSessionVerifier } from './websocket-session';

import type { App } from '../app';
import type { InfraContext } from '../context';
import type { SubscriptionKey } from '@bslt/contract';
import type { AppConfig } from '@bslt/server-system/config';
import type { DetailedHealthOptions } from '@bslt/server-system/runtime';

export interface WorkersPhaseState {
  logStartupSummary: (
    config: AppConfig,
    context: InfraContext,
    app: App,
    port: number,
  ) => Promise<void>;
  stop?: (() => void | Promise<void>) | undefined;
}

interface WebSocketGatewayHandle {
  drain?: ((timeoutMs?: number) => Promise<void>) | undefined;
  revokeUserSessions?: ((userId: string, sessionId?: string) => number) | undefined;
}

/**
 * The workers phase, composed but not running: when the role enables realtime
 * (`realtime` or `all`), the WebSocket gateway is registered on the server
 * before the server is ready, and nothing is scheduled yet.
 */
export interface ComposedWorkersPhase {
  /** Start QueueServer, outbox dispatcher, and leader-elected CronScheduler. */
  start(): Promise<WorkersPhaseState>;
}

type WorkersProcessRole = 'api' | 'realtime' | 'worker' | 'media-worker' | 'all';

export function composeWorkersPhase(
  config: AppConfig,
  context: InfraContext,
  app: App,
  role: WorkersProcessRole = 'all',
): Promise<ComposedWorkersPhase> {
  const shouldEnableWebSocket = role === 'realtime' || role === 'all';
  let wsGateway: WebSocketGatewayHandle | undefined;

  if (shouldEnableWebSocket) {
    const webSocketDeps = {
      db: context.db,
      pubsub: app.pubsub,
      log: app.log,
      config,
      resolveTableName,
    };
    // verifySession is the HTTP live check, re-run per socket so logout
    // everywhere, a password change or an account lock also ends the socket.
    const webSocketOptions = {
      verifyToken,
      verifySession: createWebSocketSessionVerifier(app.repos.users),
    };

    const registered: unknown = registerWebSocket(app.server, webSocketDeps, webSocketOptions);
    if (registered !== null && typeof registered === 'object' && 'drain' in registered) {
      wsGateway = registered as WebSocketGatewayHandle;
    }
  }

  return Promise.resolve({
    start: () => startComposedWorkers(config, app, role, shouldEnableWebSocket, wsGateway),
  });
}

async function startComposedWorkers(
  config: AppConfig,
  app: App,
  role: WorkersProcessRole,
  shouldEnableWebSocket: boolean,
  wsGateway: WebSocketGatewayHandle | undefined,
): Promise<WorkersPhaseState> {
  const shouldRunQueue = role === 'worker' || role === 'media-worker' || role === 'all';
  const shouldRunOutboxAndCron = role === 'worker' || role === 'all';

  let queueServer: ReturnType<typeof createQueueServer> | undefined;
  let outboxDispatcher: ReturnType<typeof createOutboxDispatcher> | undefined;
  let cron: ReturnType<typeof createCronScheduler> | undefined;
  let realtimeBus: PubSubAdapter | undefined;

  if (shouldEnableWebSocket || shouldRunOutboxAndCron) {
    const onEnvelope = (envelope: PubSubEnvelope): void => {
      if (envelope.kind === 'session_revoked') {
        wsGateway?.revokeUserSessions?.(envelope.userId, envelope.sessionId);
      } else if (envelope.kind === 'invalidation') {
        app.pubsub.publish(envelope.key as SubscriptionKey, envelope.version);
      }
    };
    const onError = (err: Error): void => {
      app.log.warn({ err }, 'Realtime pubsub bus warning');
    };
    const extCache = config.cache.externalConfig;
    realtimeBus =
      config.cache.useExternalProvider && extCache !== undefined
        ? createRespPubSubAdapter({
            host: extCache.host,
            port: extCache.port,
            ...(extCache.password !== undefined ? { password: extCache.password } : {}),
            ...(extCache.tls === true ? { tls: true } : {}),
            onEnvelope,
            onError,
          })
        : createPostgresPubSubAdapter({
            db: app.db,
            listenConnectionString: buildListenConnectionString(config.database),
            ssl: config.database.ssl,
            onEnvelope,
            onError,
          });
    try {
      await realtimeBus.start();
    } catch (err) {
      app.log.warn(
        { err },
        'Realtime pubsub bus failed to start; continuing with local node delivery',
      );
    }
  }

  if (shouldRunQueue || shouldRunOutboxAndCron) {
    const moduleJobs = collectModuleJobs(app.moduleInstances);
    const moduleSubscribers = collectModuleSubscribers(app.moduleInstances, {
      sealSecret: config.auth.jwt.secret,
    });
    const kernelCrons = createKernelCrons({
      db: app.db,
      queueStore: app.queueStore,
    });

    if (shouldRunQueue) {
      queueServer = createQueueServer({
        store: app.queueStore,
        handlers: {
          ...moduleJobs.handlers,
          ...moduleSubscribers.handlers,
          ...kernelCrons.handlers,
        },
        jobSpecs: {
          ...moduleJobs.jobSpecs,
          ...moduleSubscribers.jobSpecs,
          ...kernelCrons.jobSpecs,
        },
        queues: queuesForRole(role),
        log: {
          debug: (msg, data) => {
            app.log.debug(data ?? {}, msg);
          },
          info: (msg, data) => {
            app.log.info(data ?? {}, msg);
          },
          warn: (msg, data) => {
            app.log.warn(data ?? {}, msg);
          },
          error: (msg, data) => {
            app.log.error(data ?? {}, typeof msg === 'string' ? msg : msg.message);
          },
        },
      });
      queueServer.start();
    }

    if (shouldRunOutboxAndCron) {
      outboxDispatcher = createOutboxDispatcher({
        db: app.db,
        subscribers: moduleSubscribers.subscribers,
        eventsByName: moduleSubscribers.eventsByName,
        log: app.log,
        listenConnectionString: buildListenConnectionString(config.database),
        ssl: config.database.ssl,
        onRealtime: async (proj) => {
          const version = Date.now();
          app.pubsub.publish(proj.channel as SubscriptionKey, version);
          if (realtimeBus !== undefined) {
            try {
              await realtimeBus.publish({ kind: 'invalidation', key: proj.channel, version });
            } catch (err) {
              app.log.warn({ err, channel: proj.channel }, 'Realtime bus publish failed');
            }
          }
          for (const key of proj.invalidate ?? []) {
            app.pubsub.publish(key as SubscriptionKey, version);
            if (realtimeBus !== undefined) {
              try {
                await realtimeBus.publish({ kind: 'invalidation', key, version });
              } catch (err) {
                app.log.warn({ err, channel: key }, 'Realtime bus publish failed');
              }
            }
          }
        },
        onSessionRevoked: async (rev) => {
          wsGateway?.revokeUserSessions?.(rev.userId, rev.sessionId);
          if (realtimeBus !== undefined) {
            try {
              await realtimeBus.publish({
                kind: 'session_revoked',
                userId: rev.userId,
                ...(rev.sessionId !== undefined ? { sessionId: rev.sessionId } : {}),
              });
            } catch (err) {
              app.log.warn(
                { err, userId: rev.userId },
                'Realtime session revocation publish failed',
              );
            }
          }
        },
      });
      await outboxDispatcher.start();

      cron = createCronScheduler({ db: app.db, log: app.log });
      kernelCrons.registerSchedules(cron);
      registerModuleCrons(cron, app.moduleInstances, {
        db: app.db,
        jobs: createKernelJobsService({ now: () => new Date() }),
      });
      await cron.start();
    }
  }

  return {
    stop: async () => {
      await wsGateway?.drain?.();
      cron?.stop();
      if (outboxDispatcher !== undefined) {
        await outboxDispatcher.stop();
      }
      if (queueServer !== undefined) {
        await queueServer.stop();
      }
      if (realtimeBus !== undefined) {
        await realtimeBus.stop();
      }
    },
    logStartupSummary: async (
      appConfig: AppConfig,
      appContext: InfraContext,
      serverApp: App,
      port: number,
    ) => {
      const healthOptions: DetailedHealthOptions = {
        schemaValidator: () => validateSchema(appContext.db),
        totalTableCount: REQUIRED_TABLES.length,
      };

      if (shouldEnableWebSocket) {
        healthOptions.websocketStats = getWebSocketStats();
      }

      await logStartupSummary(
        appContext,
        {
          host: appConfig.server.host,
          port,
          routeCount: serverApp.countRegisteredRoutes(),
        },
        healthOptions,
      );
    },
  };
}

export async function stopWorkersPhase(
  _state: Partial<WorkersPhaseState> | undefined,
): Promise<void> {
  await _state?.stop?.();
}
