// main/apps/server/src/bootstrap/phases/infra.test.ts
import { load } from '@bslt/server-system/config';
import { describe, expect, it, vi } from 'vitest';

import { bootstrapInfraPhase, stopInfraPhase } from './infra';

function config() {
  return load({
    NODE_ENV: 'test',
    JWT_SECRET: 'infra-test-secret-at-least-32-characters',
    LOG_LEVEL: 'error',
  });
}

function mockLog() {
  const log = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return log;
}

describe('error tracking', () => {
  it('reports a captured server error as one error event on the platform logger', async () => {
    const log = mockLog();
    const state = await bootstrapInfraPhase(config(), { log: log as never });
    try {
      const error = new Error('test capture');
      const context = { statusCode: 500, correlationId: 'c-1' };

      state.platform.errorTracker.captureError(error, context);

      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith(error, 'Captured server error', context);
    } finally {
      await stopInfraPhase(state);
    }
  });
});

describe('caller-supplied ports', () => {
  it('uses the given logger, cache and error tracker and composes none of its own', async () => {
    const log = mockLog();
    const cache = { getStats: vi.fn() };
    const errorTracker = {
      captureError: vi.fn(),
      addBreadcrumb: vi.fn(),
      setUserContext: vi.fn(),
    };

    const state = await bootstrapInfraPhase(config(), {
      log: log as never,
      cache: cache as never,
      errorTracker,
    });
    try {
      expect(state.platform.log).toBe(log);
      expect(state.platform.cache).toBe(cache);
      expect(state.platform.errorTracker).toBe(errorTracker);
      expect(log.info).toHaveBeenCalledWith('Infra phase bootstrapped');
    } finally {
      await stopInfraPhase(state);
    }
  });
});
