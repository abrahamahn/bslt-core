// main/apps/server/src/bootstrap/build-app.test.ts
/**
 * Unit tests for `buildApp`, the one composition function:
 * - composing runs the phases in order and starts nothing;
 * - `start()` starts the background runtimes, then listens;
 * - `stop()` stops whatever was started, in reverse;
 * - the kernel background runtimes (QueueServer, outbox dispatcher, cron) are
 *   always composed and started on `start()` / `startWorkers()`;
 * - the process role is `all` or the server refuses to boot;
 * - a caller's ports reach the phases that would otherwise compose them.
 *
 * The phases are mocked: what each one composes is covered by its own tests, and
 * the whole composition by `tests/integration/api/composition.real-db.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp, parseProcessRole, PROCESS_ROLES } from './build-app';
import { bootstrapCommsPhase, stopCommsPhase } from './phases/comms';
import { bootstrapDataPhase, stopDataPhase } from './phases/data';
import { initHttpPhase, startHttpPhase, stopHttpPhase } from './phases/http';
import { bootstrapInfraPhase, stopInfraPhase } from './phases/infra';
import { composeWorkersPhase, stopWorkersPhase } from './phases/workers';

import type { AppPorts } from './build-app';
import type { InfraContext } from './context';
import type { AppConfig } from '@bslt/server-system/config';

vi.mock('./phases/infra', () => ({
  bootstrapInfraPhase: vi.fn(),
  stopInfraPhase: vi.fn(),
}));

vi.mock('./phases/data', () => ({
  bootstrapDataPhase: vi.fn(),
  stopDataPhase: vi.fn(),
}));

const commsContext = {
  db: { kind: 'db' },
  repos: { kind: 'repos' },
  log: { kind: 'log' },
};

vi.mock('./phases/comms', () => ({
  bootstrapCommsPhase: vi.fn(),
  stopCommsPhase: vi.fn(),
}));

vi.mock('./phases/http', () => ({
  initHttpPhase: vi.fn(),
  startHttpPhase: vi.fn(),
  stopHttpPhase: vi.fn(),
}));

vi.mock('./phases/workers', () => ({
  composeWorkersPhase: vi.fn(),
  stopWorkersPhase: vi.fn(),
}));

const composeWorkers = vi.mocked(composeWorkersPhase);
const stopWorkers = vi.mocked(stopWorkersPhase);
const startWorkers = vi.fn();
const logStartupSummary = vi.fn();

const config = {} as AppConfig;
const routes = [{ method: 'GET', url: '/health' }];
const server = { ready: vi.fn().mockResolvedValue(undefined) };
const app = { server, context: { kind: 'boot context' }, routes: () => routes };

/** Each mock was called, and they were first called in the order given. */
function expectInOrder(...mocks: readonly ReturnType<typeof vi.fn>[]): void {
  const order = mocks.map((mock) => mock.mock.invocationCallOrder[0] ?? Number.NaN);
  expect(order.every((position) => !Number.isNaN(position))).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bootstrapInfraPhase).mockResolvedValue({ platform: {} } as never);
  vi.mocked(bootstrapDataPhase).mockResolvedValue({ context: {} } as never);
  vi.mocked(bootstrapCommsPhase).mockResolvedValue({
    context: commsContext,
  } as never);
  vi.mocked(initHttpPhase).mockResolvedValue({ app, port: 0 } as never);
  vi.mocked(startHttpPhase).mockResolvedValue(8080);
  startWorkers.mockResolvedValue({ logStartupSummary, stop: vi.fn() });
  composeWorkers.mockResolvedValue({ start: startWorkers });
});

describe('parseProcessRole', () => {
  it('supports api, realtime, worker, media-worker, and all', () => {
    expect(PROCESS_ROLES).toEqual(['api', 'realtime', 'worker', 'media-worker', 'all']);
  });

  it('defaults to all when PROCESS_ROLE is unset or blank', () => {
    expect(parseProcessRole(undefined)).toBe('all');
    expect(parseProcessRole('')).toBe('all');
    expect(parseProcessRole('  ')).toBe('all');
  });

  it('accepts every supported role', () => {
    for (const role of PROCESS_ROLES) {
      expect(parseProcessRole(role)).toBe(role);
    }
  });

  it('refuses a role this server cannot run, naming the supported ones', () => {
    expect(() => parseProcessRole('web')).toThrow(
      /PROCESS_ROLE "web".*supports: api, realtime, worker, media-worker, all/u,
    );
    expect(() => parseProcessRole('bogus')).toThrow(/PROCESS_ROLE "bogus"/u);
  });
});

describe('buildApp composition', () => {
  it('runs the phases in order and returns the composed app without starting it', async () => {
    const built = await buildApp(config);

    expectInOrder(
      vi.mocked(bootstrapInfraPhase),
      vi.mocked(bootstrapDataPhase),
      vi.mocked(bootstrapCommsPhase),
      vi.mocked(initHttpPhase),
    );
    expect(built.role).toBe('all');
    expect(built.config).toBe(config);
    expect(built.app).toBe(app);
    expect(built.server).toBe(server);
    expect(built.context).toBe(app.context);
    expect(built.routes()).toEqual(routes);

    expect(startHttpPhase).not.toHaveBeenCalled();
    expect(startWorkers).not.toHaveBeenCalled();
  });

  it('refuses a role the server does not support', async () => {
    await expect(buildApp(config, { role: 'web' as never })).rejects.toThrow(/PROCESS_ROLE/u);
    expect(bootstrapInfraPhase).not.toHaveBeenCalled();
  });

  it('composes probes-only HTTP surface for worker, media-worker, and realtime roles and full HTTP for api and all', async () => {
    for (const role of ['worker', 'media-worker', 'realtime'] as const) {
      vi.mocked(initHttpPhase).mockClear();
      composeWorkers.mockClear();
      const built = await buildApp(config, { role });
      expect(built.role).toBe(role);
      expect(initHttpPhase).toHaveBeenCalledWith(config, commsContext, {
        httpMode: 'probes-only',
      });
      expect(composeWorkers).toHaveBeenCalledWith(config, commsContext, app, role);
    }

    for (const role of ['api', 'all'] as const) {
      vi.mocked(initHttpPhase).mockClear();
      composeWorkers.mockClear();
      const built = await buildApp(config, { role });
      expect(built.role).toBe(role);
      expect(initHttpPhase).toHaveBeenCalledWith(config, commsContext);
      expect(composeWorkers).toHaveBeenCalledWith(config, commsContext, app, role);
    }
  });

  it('hands the caller ports to the phases that compose them', async () => {
    const ports: AppPorts = { email: undefined };

    await buildApp(config, { ports });

    expect(bootstrapInfraPhase).toHaveBeenCalledWith(config, ports);
    expect(vi.mocked(bootstrapCommsPhase).mock.calls[0]?.[2]).toBe(ports);
  });

  it('composes over a given context without running the infra, data and comms phases', async () => {
    const context = { kind: 'given' } as unknown as InfraContext;

    const built = await buildApp(config, { context });
    await built.stop();

    expect(bootstrapInfraPhase).not.toHaveBeenCalled();
    expect(bootstrapDataPhase).not.toHaveBeenCalled();
    expect(bootstrapCommsPhase).not.toHaveBeenCalled();
    expect(initHttpPhase).toHaveBeenCalledWith(config, context);
    // It did not open them, so it does not close them.
    expect(stopDataPhase).not.toHaveBeenCalled();
    expect(stopInfraPhase).not.toHaveBeenCalled();
    expect(stopHttpPhase).toHaveBeenCalledTimes(1);
  });

  it('runs the extension before the app is handed back', async () => {
    const extend = vi.fn();

    await buildApp(config, { extend });

    expect(extend).toHaveBeenCalledWith(app);
  });

  it('forwards explicit modules and env inputs to initHttpPhase', async () => {
    const modules = [] as const;
    const env = { FEATURE_X: '1' } as const;

    await buildApp(config, { modules, env });

    expect(initHttpPhase).toHaveBeenCalledWith(config, commsContext, {
      modules,
      env,
    });
  });

  it('stops the phases it started when a later phase fails', async () => {
    vi.mocked(initHttpPhase).mockRejectedValue(new Error('route registration failed'));

    await expect(buildApp(config)).rejects.toThrow('route registration failed');

    expect(stopCommsPhase).toHaveBeenCalledTimes(1);
    expect(stopDataPhase).toHaveBeenCalledTimes(1);
    expect(stopInfraPhase).toHaveBeenCalledTimes(1);
  });
});

describe('buildApp start and stop', () => {
  it('starts the background runtimes, then listens, then logs the summary', async () => {
    const built = await buildApp(config);

    const port = await built.start();

    expect(port).toBe(8080);
    expectInOrder(startWorkers, vi.mocked(startHttpPhase), logStartupSummary);
    expect(startHttpPhase).toHaveBeenCalledWith(config, app);
    expect(logStartupSummary).toHaveBeenCalledWith(config, commsContext, app, 8080);
  });

  it('stops in reverse order, once', async () => {
    const built = await buildApp(config);
    await built.start();

    await built.stop();
    await built.stop();

    expectInOrder(
      stopWorkers,
      vi.mocked(stopHttpPhase),
      vi.mocked(stopCommsPhase),
      vi.mocked(stopDataPhase),
      vi.mocked(stopInfraPhase),
    );
    expect(stopWorkers).toHaveBeenCalledTimes(1);
    expect(stopHttpPhase).toHaveBeenCalledTimes(1);
    expect(stopInfraPhase).toHaveBeenCalledTimes(1);
  });

  it('readies the composed server on demand', async () => {
    const built = await buildApp(config);

    await built.ready();

    expect(server.ready).toHaveBeenCalledTimes(1);
  });
});

describe('buildApp workers wiring', () => {
  it('always composes kernel background runtimes for the requested process role', async () => {
    const built = await buildApp(config);
    expect(composeWorkers).toHaveBeenCalledTimes(1);
    expect(composeWorkers).toHaveBeenCalledWith(config, commsContext, app, 'all');
    await built.start();

    expect(startWorkers).toHaveBeenCalledTimes(1);
  });

  it('stops the workers phase on shutdown', async () => {
    const built = await buildApp(config);
    await built.start();

    await built.stop();

    expect(stopWorkers).toHaveBeenCalledTimes(1);
  });

  it('tolerates a stop before any start', async () => {
    const built = await buildApp(config);

    await expect(built.stop()).resolves.toBeUndefined();
    expect(stopWorkers).not.toHaveBeenCalled();
  });

  it('starts background workers on demand via startWorkers without binding an HTTP port', async () => {
    const built = await buildApp(config);

    await built.startWorkers();
    await built.startWorkers();

    expect(startWorkers).toHaveBeenCalledTimes(1);
    expect(startHttpPhase).not.toHaveBeenCalled();

    await built.stop();
    expect(stopWorkers).toHaveBeenCalledTimes(1);
  });
});
