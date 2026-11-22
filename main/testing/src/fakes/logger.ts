// main/testing/src/fakes/logger.ts
/**
 * The one mock logger. Every level is a spy, and `child()` returns the same
 * logger, so a test asserts on one object whichever child a module logged
 * through. It satisfies the server's `Logger` and Fastify's `loggerInstance`.
 */

import { vi, type Mock } from 'vitest';

export interface MockLogger {
  readonly trace: Mock;
  readonly debug: Mock;
  readonly info: Mock;
  readonly warn: Mock;
  readonly error: Mock;
  readonly fatal: Mock;
  readonly child: Mock;
  /** Fastify reads the level of the logger it is given. */
  level: string;
}

/**
 * With `TEST_LOG=1` the warn, error and fatal calls are also written to stderr:
 * a 500 in a suite is then visible without editing the suite.
 */
function loud(level: string): Mock {
  if (process.env['TEST_LOG'] !== '1') return vi.fn();
  return vi.fn((...args: unknown[]) => {
    const text = args
      .map((arg) =>
        arg instanceof Error ? (arg.stack ?? arg.message) : JSON.stringify(arg, errorReplacer),
      )
      .join(' ');
    process.stderr.write(`[test-log ${level}] ${text}\n`);
  });
}

function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { message: value.message, stack: value.stack } : value;
}

export function createMockLogger(): MockLogger {
  const logger: MockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: loud('warn'),
    error: loud('error'),
    fatal: loud('fatal'),
    child: vi.fn(),
    level: 'silent',
  };
  logger.child.mockReturnValue(logger);
  return logger;
}
