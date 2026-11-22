// main/apps/server/src/bootstrap/runtime.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerRuntime } from './runtime';

import type { AppConfig } from '@bslt/server-system/config';

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), fatal: vi.fn() }));

vi.mock('./build-app', () => ({
  buildApp: vi.fn(() =>
    Promise.resolve({
      context: { log },
      start: vi.fn(() => Promise.resolve(0)),
      stop: vi.fn(() => Promise.resolve()),
    }),
  ),
}));

const EVENTS = ['SIGTERM', 'SIGINT', 'uncaughtExceptionMonitor'] as const;
const before = new Map(EVENTS.map((event) => [event, process.listeners(event)]));
const uncaughtHandlers = process.listenerCount('uncaughtException');

afterEach(() => {
  // Remove only what the runtime added; the test runner has listeners of its own.
  for (const event of EVENTS) {
    const kept = before.get(event) ?? [];
    for (const listener of process.listeners(event)) {
      if (!kept.includes(listener)) process.removeListener(event, listener);
    }
  }
  vi.clearAllMocks();
});

describe('ServerRuntime.setupGracefulShutdown', () => {
  it('logs an uncaught exception as a fatal event, without handling it', async () => {
    const runtime = new ServerRuntime({} as AppConfig);
    runtime.setupGracefulShutdown();
    await runtime.start();
    const crash = new Error('boom');

    process.emit('uncaughtExceptionMonitor', crash, 'uncaughtException');

    expect(log.fatal).toHaveBeenCalledTimes(1);
    expect(log.fatal).toHaveBeenCalledWith(crash, 'Uncaught exception', {
      origin: 'uncaughtException',
    });
    // A monitor observes; with no `uncaughtException` handler added, Node still
    // prints the error and exits.
    expect(process.listenerCount('uncaughtException')).toBe(uncaughtHandlers);
  });

  it('leaves an unhandled rejection fatal: logged by the monitor, then Node exits', async () => {
    const rejectionHandlers = process.listenerCount('unhandledRejection');
    const runtime = new ServerRuntime({} as AppConfig);
    runtime.setupGracefulShutdown();
    await runtime.start();
    const reason = new Error('lost promise');

    process.emit('uncaughtExceptionMonitor', reason, 'unhandledRejection');

    expect(log.fatal).toHaveBeenCalledWith(reason, 'Uncaught exception', {
      origin: 'unhandledRejection',
    });
    // Any `unhandledRejection` listener would turn the crash into a warning,
    // as the Sentry SDK's did; Node's default throw mode needs there to be none.
    expect(process.listenerCount('unhandledRejection')).toBe(rejectionHandlers);
  });

  it('registers its handlers once', () => {
    const runtime = new ServerRuntime({} as AppConfig);

    runtime.setupGracefulShutdown();
    runtime.setupGracefulShutdown();

    const added = (event: (typeof EVENTS)[number]): number =>
      process.listenerCount(event) - (before.get(event)?.length ?? 0);
    expect(EVENTS.map(added)).toEqual([1, 1, 1]);
  });
});
