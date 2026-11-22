// main/apps/server/src/bootstrap/phases/workers.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateQueueServer,
  mockQueueStart,
  mockQueueStop,
  mockCreateOutboxDispatcher,
  mockOutboxStart,
  mockOutboxStop,
  mockCreateCronScheduler,
  mockCronStart,
  mockCronStop,
  mockCronRegister,
  mockRegisterWebSocket,
  mockWsDrain,
  mockWsRevokeUserSessions,
  mockCreatePostgresPubSubAdapter,
  mockCreateRespPubSubAdapter,
  mockBusStart,
  mockBusStop,
  mockBusPublish,
} = vi.hoisted(() => ({
  mockCreateQueueServer: vi.fn(),
  mockQueueStart: vi.fn(),
  mockQueueStop: vi.fn().mockResolvedValue(undefined),
  mockCreateOutboxDispatcher: vi.fn(),
  mockOutboxStart: vi.fn().mockResolvedValue(undefined),
  mockOutboxStop: vi.fn().mockResolvedValue(undefined),
  mockCreateCronScheduler: vi.fn(),
  mockCronStart: vi.fn().mockResolvedValue(undefined),
  mockCronStop: vi.fn(),
  mockCronRegister: vi.fn(),
  mockRegisterWebSocket: vi.fn(),
  mockWsDrain: vi.fn().mockResolvedValue(undefined),
  mockWsRevokeUserSessions: vi.fn().mockReturnValue(1),
  mockCreatePostgresPubSubAdapter: vi.fn(),
  mockCreateRespPubSubAdapter: vi.fn(),
  mockBusStart: vi.fn().mockResolvedValue(undefined),
  mockBusStop: vi.fn().mockResolvedValue(undefined),
  mockBusPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@bslt/realtime', () => ({
  createPostgresPubSubAdapter: mockCreatePostgresPubSubAdapter,
  createRespPubSubAdapter: mockCreateRespPubSubAdapter,
  getWebSocketStats: () => ({ activeConnections: 0, pluginRegistered: true }),
  registerWebSocket: mockRegisterWebSocket,
  resolveTableName: () => undefined,
}));

vi.mock('@bslt/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/db')>();
  return {
    ...actual,
    createQueueServer: mockCreateQueueServer,
    validateSchema: vi.fn().mockResolvedValue({ valid: true, missingTables: [] }),
  };
});

vi.mock('@bslt/server-system/cron', () => ({
  createCronScheduler: mockCreateCronScheduler,
  createKernelCrons: vi.fn(() => ({
    handlers: {},
    jobSpecs: {},
    registerSchedules: vi.fn(),
  })),
}));

vi.mock('@bslt/server-system/module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bslt/server-system/module')>();
  return {
    ...actual,
    collectModuleJobs: vi.fn(() => ({ handlers: {}, jobSpecs: {} })),
    collectModuleSubscribers: vi.fn(() => ({
      handlers: {},
      jobSpecs: {},
      subscribers: [],
      eventsByName: new Map(),
    })),
    createKernelJobsService: vi.fn(() => ({ enqueue: vi.fn() })),
    createOutboxDispatcher: mockCreateOutboxDispatcher,
    registerModuleCrons: vi.fn(),
  };
});

vi.mock('@bslt/server-system/runtime', () => ({
  logStartupSummary: vi.fn().mockResolvedValue(undefined),
}));

import { composeWorkersPhase, stopWorkersPhase } from './workers';

import type { App } from '../app';
import type { InfraContext } from '../context';
import type { AppConfig } from '@bslt/server-system/config';

function makeAppAndContext(): { config: AppConfig; context: InfraContext; app: App } {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const config = {
    env: 'test',
    server: { host: '127.0.0.1' },
    database: {
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'test',
      password: 'pw',
      ssl: false,
    },
    auth: {
      jwt: { secret: 'test-secret-32-chars-minimum-00000' },
      cookie: { secret: 'cookie-secret-32-chars-minimum-000' },
    },
    cache: {
      ttl: 1000,
      maxSize: 100,
      useExternalProvider: false,
    },
  } as unknown as AppConfig;
  const context = { db: {}, log } as unknown as InfraContext;
  const app = {
    db: {},
    repos: { users: {} },
    pubsub: { publish: vi.fn() },
    queueStore: {},
    storage: undefined,
    log,
    server: { server: { on: vi.fn() } },
    moduleInstances: new Map(),
    countRegisteredRoutes: () => 5,
  } as unknown as App;
  return { config, context, app };
}

describe('composeWorkersPhase per PROCESS_ROLE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateQueueServer.mockReturnValue({ start: mockQueueStart, stop: mockQueueStop });
    mockCreateOutboxDispatcher.mockReturnValue({ start: mockOutboxStart, stop: mockOutboxStop });
    mockCreateCronScheduler.mockReturnValue({
      register: mockCronRegister,
      start: mockCronStart,
      stop: mockCronStop,
    });
    mockRegisterWebSocket.mockReturnValue({
      drain: mockWsDrain,
      revokeUserSessions: mockWsRevokeUserSessions,
    });
    const fakeBus = {
      instanceId: 'test-instance',
      start: mockBusStart,
      stop: mockBusStop,
      publish: mockBusPublish,
    };
    mockCreatePostgresPubSubAdapter.mockReturnValue(fakeBus);
    mockCreateRespPubSubAdapter.mockReturnValue(fakeBus);
  });

  it('role=api starts neither WebSocket gateway nor QueueServer, outbox, or cron', async () => {
    const { config, context, app } = makeAppAndContext();
    const composed = await composeWorkersPhase(config, context, app, 'api');
    const state = await composed.start();
    await stopWorkersPhase(state);

    expect(mockRegisterWebSocket).not.toHaveBeenCalled();
    expect(mockCreateQueueServer).not.toHaveBeenCalled();
    expect(mockCreateOutboxDispatcher).not.toHaveBeenCalled();
    expect(mockCreateCronScheduler).not.toHaveBeenCalled();
    expect(mockCreatePostgresPubSubAdapter).not.toHaveBeenCalled();
    expect(mockCreateRespPubSubAdapter).not.toHaveBeenCalled();
  });

  it('role=realtime registers WebSocket gateway and drains it on stop without starting workers or cron', async () => {
    const { config, context, app } = makeAppAndContext();
    const composed = await composeWorkersPhase(config, context, app, 'realtime');
    expect(mockRegisterWebSocket).toHaveBeenCalledTimes(1);

    const state = await composed.start();
    expect(mockCreateQueueServer).not.toHaveBeenCalled();
    expect(mockCreateOutboxDispatcher).not.toHaveBeenCalled();
    expect(mockCreateCronScheduler).not.toHaveBeenCalled();

    await stopWorkersPhase(state);
    expect(mockWsDrain).toHaveBeenCalledTimes(1);
  });

  it('role=worker starts default QueueServer, outbox dispatcher, and leader cron without WebSockets or media queue', async () => {
    const { config, context, app } = makeAppAndContext();
    const composed = await composeWorkersPhase(config, context, app, 'worker');
    expect(mockRegisterWebSocket).not.toHaveBeenCalled();

    const state = await composed.start();
    expect(mockCreateQueueServer).toHaveBeenCalledWith(
      expect.objectContaining({
        queues: { default: { concurrency: 4 } },
      }),
    );
    expect(mockQueueStart).toHaveBeenCalledTimes(1);
    expect(mockOutboxStart).toHaveBeenCalledTimes(1);
    expect(mockCronStart).toHaveBeenCalledTimes(1);

    await stopWorkersPhase(state);
    expect(mockCronStop).toHaveBeenCalledTimes(1);
    expect(mockOutboxStop).toHaveBeenCalledTimes(1);
    expect(mockQueueStop).toHaveBeenCalledTimes(1);
  });

  it('role=media-worker starts only the media QueueServer without WebSockets, outbox, or cron', async () => {
    const { config, context, app } = makeAppAndContext();
    const composed = await composeWorkersPhase(config, context, app, 'media-worker');
    expect(mockRegisterWebSocket).not.toHaveBeenCalled();

    const state = await composed.start();
    expect(mockCreateQueueServer).toHaveBeenCalledWith(
      expect.objectContaining({
        queues: { media: { concurrency: 2 } },
      }),
    );
    expect(mockQueueStart).toHaveBeenCalledTimes(1);
    expect(mockCreateOutboxDispatcher).not.toHaveBeenCalled();
    expect(mockCreateCronScheduler).not.toHaveBeenCalled();

    await stopWorkersPhase(state);
    expect(mockQueueStop).toHaveBeenCalledTimes(1);
  });

  it('role=all starts WebSocket gateway, default+media QueueServer, outbox dispatcher, and cron, draining all on stop', async () => {
    const { config, context, app } = makeAppAndContext();
    const composed = await composeWorkersPhase(config, context, app, 'all');
    expect(mockRegisterWebSocket).toHaveBeenCalledTimes(1);

    const state = await composed.start();
    expect(mockCreateQueueServer).toHaveBeenCalledWith(
      expect.objectContaining({
        queues: { default: { concurrency: 4 }, media: { concurrency: 2 } },
      }),
    );
    expect(mockQueueStart).toHaveBeenCalledTimes(1);
    expect(mockOutboxStart).toHaveBeenCalledTimes(1);
    expect(mockCronStart).toHaveBeenCalledTimes(1);

    await stopWorkersPhase(state);
    expect(mockWsDrain).toHaveBeenCalledTimes(1);
    expect(mockCronStop).toHaveBeenCalledTimes(1);
    expect(mockOutboxStop).toHaveBeenCalledTimes(1);
    expect(mockQueueStop).toHaveBeenCalledTimes(1);
    expect(mockBusStop).toHaveBeenCalledTimes(1);
  });

  it('selects RespPubSubAdapter when cache.useExternalProvider is true, forwards session_revoked + invalidations, and survives bus start/publish errors', async () => {
    const { config, context, app } = makeAppAndContext();
    const redisConfig: AppConfig = {
      ...config,
      cache: {
        ttl: 1000,
        maxSize: 100,
        useExternalProvider: true,
        externalConfig: { host: '127.0.0.1', port: 6379, password: 'pw', tls: true },
      },
    };

    // Failure case 1: bus start rejection logs warning and does not crash worker boot
    mockBusStart.mockRejectedValueOnce(new Error('redis down'));
    const composedDown = await composeWorkersPhase(redisConfig, context, app, 'realtime');
    const stateDown = await composedDown.start();
    expect(mockCreateRespPubSubAdapter).toHaveBeenCalledTimes(1);
    expect(app.log.warn).toHaveBeenCalled();
    await stopWorkersPhase(stateDown);

    // Failure case 2 + happy path: outbox session revocation revokes local sockets & publishes to bus; bus publish rejection is warned & swallowed
    vi.clearAllMocks();
    mockRegisterWebSocket.mockReturnValue({
      drain: mockWsDrain,
      revokeUserSessions: mockWsRevokeUserSessions,
    });
    mockCreateOutboxDispatcher.mockReturnValue({ start: mockOutboxStart, stop: mockOutboxStop });
    mockCreateQueueServer.mockReturnValue({ start: mockQueueStart, stop: mockQueueStop });
    mockCreateCronScheduler.mockReturnValue({
      register: mockCronRegister,
      start: mockCronStart,
      stop: mockCronStop,
    });
    let capturedOnEnvelope: ((env: unknown) => void) | undefined;
    mockCreateRespPubSubAdapter.mockImplementation(
      (opts: { onEnvelope: (env: unknown) => void }) => {
        capturedOnEnvelope = opts.onEnvelope;
        return {
          instanceId: 'test-instance',
          start: mockBusStart,
          stop: mockBusStop,
          publish: mockBusPublish,
        };
      },
    );

    const composedAll = await composeWorkersPhase(redisConfig, context, app, 'all');
    const stateAll = await composedAll.start();

    const outboxCall = mockCreateOutboxDispatcher.mock.calls[0]?.[0] as {
      onSessionRevoked?: (rev: { userId: string; sessionId?: string }) => Promise<void>;
      onRealtime?: (proj: { channel: string; invalidate?: readonly string[] }) => Promise<void>;
    };
    expect(outboxCall.onSessionRevoked).toBeTypeOf('function');

    mockBusPublish.mockRejectedValueOnce(new Error('publish failed'));
    await expect(
      outboxCall.onSessionRevoked!({ userId: 'u-revoked', sessionId: 's-9' }),
    ).resolves.toBeUndefined();
    expect(mockWsRevokeUserSessions).toHaveBeenCalledWith('u-revoked', 's-9');
    expect(app.log.warn).toHaveBeenCalled();

    // Incoming envelope from peer node revokes local sockets and publishes invalidations
    capturedOnEnvelope?.({ kind: 'session_revoked', userId: 'u-peer', sessionId: 's-peer' });
    expect(mockWsRevokeUserSessions).toHaveBeenCalledWith('u-peer', 's-peer');
    capturedOnEnvelope?.({ kind: 'invalidation', key: 'public:status', version: 42 });
    expect(app.pubsub.publish).toHaveBeenCalledWith('public:status', 42);

    await stopWorkersPhase(stateAll);
  });
});
