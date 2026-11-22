// main/kernel/server/src/observability/error-tracker.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createLogErrorTracker } from './error-tracker';

function mockLogger() {
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

describe('createLogErrorTracker', () => {
  it('logs a captured error as one error event with its context', () => {
    const log = mockLogger();
    const error = new Error('x');
    const context = { statusCode: 500, correlationId: 'c' };

    createLogErrorTracker(log).captureError(error, context);

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(error, 'Captured server error', context);
  });

  it('wraps a thrown non-error value, even one that cannot be turned into a string', () => {
    const log = mockLogger();
    const tracker = createLogErrorTracker(log);
    const hostile = {
      [Symbol.toPrimitive]: (): never => {
        throw new Error('no primitive');
      },
    };

    expect(() => {
      tracker.captureError('plain text');
      tracker.captureError(Object.create(null));
      tracker.captureError(hostile);
    }).not.toThrow();

    const messages = log.error.mock.calls.map(([error]) => (error as Error).message);
    expect(messages).toEqual(['plain text', 'Non-error value thrown', 'Non-error value thrown']);
  });

  it('logs breadcrumbs at debug only', () => {
    const log = mockLogger();

    createLogErrorTracker(log).addBreadcrumb('Login attempt', { category: 'auth' });

    expect(log.debug).toHaveBeenCalledWith({ category: 'auth' }, 'Login attempt');
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('never logs the user context, so no email reaches the logs', () => {
    const log = mockLogger();

    createLogErrorTracker(log).setUserContext('u1', 'a@b.c');

    for (const level of [log.debug, log.info, log.warn, log.error]) {
      expect(level).not.toHaveBeenCalled();
    }
  });
});
