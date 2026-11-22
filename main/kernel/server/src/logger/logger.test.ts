// main/kernel/server/src/logger/logger.test.ts

import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createHttpServer } from '../http/server';

import {
  createJobLogger,
  createLogger,
  createRequestLogger,
  developmentFormatter,
  serializeError,
} from './logger';
import {
  SENSITIVE_KEYS,
  type LogEvent,
  type LogLevel,
  type LogMeta,
  type LogRequestContext,
  type Logger,
} from './types';

// ── serializeError ──────────────────────────────────────────────────────────

describe('serializeError', () => {
  test('captures name, message, stack, code, and cause', () => {
    const cause = new Error('root cause');
    const err = Object.assign(new Error('something broke'), { code: 'ERR_BROKEN', cause });
    const result = serializeError(err);

    expect(result.name).toBe('Error');
    expect(result.message).toBe('something broke');
    expect(typeof result.stack).toBe('string');
    expect(result.code).toBe('ERR_BROKEN');
    expect(result.cause).toBe(cause);
  });

  test('returns undefined for code and cause when not present', () => {
    const result = serializeError(new Error('plain'));
    expect(result.code).toBeUndefined();
    expect(result.cause).toBeUndefined();
  });
});

// ── createLogger ────────────────────────────────────────────────────────────

describe('createLogger', () => {
  test('log.info(string, meta) emits with merged meta', () => {
    const lines: string[] = [];
    const log = createLogger('info', {}, (event) => {
      lines.push(JSON.stringify(event));
      return '';
    });
    log.info('with meta', { key: 'value' });
    // formatter receives the event; verify meta reached formatter
    expect(lines.length).toBeGreaterThan(0);
  });

  test('log.info(meta, string) emits with meta first', () => {
    const events: LogEvent[] = [];
    const log = createLogger('info', {}, (event) => {
      events.push(event);
      return '';
    });
    log.info({ requestId: 'abc' }, 'hello meta-first');
    expect(events[0]?.msg).toBe('hello meta-first');
  });

  test('log.error(Error, message, meta) serializes error and merges meta', () => {
    const events: LogEvent[] = [];
    const log = createLogger('error', {}, (event) => {
      events.push(event);
      return '';
    });
    const err = new Error('boom');
    log.error(err, 'it broke', { requestId: 'r1' });
    const event = events[0] as LogEvent & { err?: unknown; requestId?: string };
    expect(event?.err).toBeDefined();
    expect(event?.requestId).toBe('r1');
  });

  test('log.error(string, meta) passes through without error serialization', () => {
    const events: LogEvent[] = [];
    const log = createLogger('error', {}, (event) => {
      events.push(event);
      return '';
    });
    log.error('plain error message', { detail: 'x' });
    const event = events[0] as LogEvent & { err?: unknown };
    expect(event?.msg).toBe('plain error message');
    expect(event?.err).toBeUndefined();
  });

  test('log.child(bindings) returns a new logger instance', () => {
    const log = createLogger('info');
    const child = log.child({ service: 'worker' });
    expect(child).not.toBe(log);
    expect(typeof child.info).toBe('function');
  });

  test('isLevelEnabled returns true for enabled levels', () => {
    const log = createLogger('info');
    expect(log.isLevelEnabled?.('info')).toBe(true);
    expect(log.isLevelEnabled?.('warn')).toBe(true);
    expect(log.isLevelEnabled?.('error')).toBe(true);
  });

  test('isLevelEnabled returns false for levels below configured level', () => {
    const log = createLogger('warn');
    expect(log.isLevelEnabled?.('debug')).toBe(false);
    expect(log.isLevelEnabled?.('trace')).toBe(false);
  });

  test('redacts sensitive keys at top level', () => {
    const lines: string[] = [];
    const log = createLogger('info', {}, (event) => {
      lines.push(JSON.stringify(event));
      return '';
    });
    log.info({ password: 'secret123', username: 'alice' }, 'login');
    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).not.toContain('secret123');
  });
});

// ── createRequestLogger ──────────────────────────────────────────────────────

describe('createRequestLogger', () => {
  const baseContext: LogRequestContext = {
    correlationId: 'corr-1',
    requestId: 'req-1',
    method: 'GET',
    path: '/api/test',
    ip: '10.0.0.1',
  };

  test('creates a child logger bound with the four core fields', () => {
    const childSpy = vi
      .fn()
      .mockReturnValue({ info: vi.fn(), child: vi.fn(), isLevelEnabled: vi.fn() });
    const baseLogger = { child: childSpy, info: vi.fn(), isLevelEnabled: vi.fn() };

    createRequestLogger(baseLogger as never, baseContext);

    expect(childSpy).toHaveBeenCalledWith({
      correlationId: 'corr-1',
      requestId: 'req-1',
      method: 'GET',
      path: '/api/test',
    });
  });

  test('includes traceId binding when present in context', () => {
    const childSpy = vi
      .fn()
      .mockReturnValue({ info: vi.fn(), child: vi.fn(), isLevelEnabled: vi.fn() });
    const baseLogger = { child: childSpy, info: vi.fn(), isLevelEnabled: vi.fn() };

    createRequestLogger(baseLogger as never, {
      ...baseContext,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });

    expect(childSpy).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }),
    );
  });

  test('omits traceId binding when not present in context', () => {
    const childSpy = vi
      .fn()
      .mockReturnValue({ info: vi.fn(), child: vi.fn(), isLevelEnabled: vi.fn() });
    const baseLogger = { child: childSpy, info: vi.fn(), isLevelEnabled: vi.fn() };

    createRequestLogger(baseLogger as never, baseContext);

    const bindings = childSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(bindings).not.toHaveProperty('traceId');
  });
});

// ── createJobLogger ──────────────────────────────────────────────────────────

describe('createJobLogger', () => {
  test('generates a correlationId with job:name:uuid pattern when no id provided', () => {
    const childSpy = vi
      .fn()
      .mockReturnValue({ info: vi.fn(), child: vi.fn(), isLevelEnabled: vi.fn() });
    const baseLogger = { child: childSpy, info: vi.fn(), isLevelEnabled: vi.fn() };

    createJobLogger(baseLogger as never, 'send-emails');

    const bindings = childSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof bindings['correlationId']).toBe('string');
    expect((bindings['correlationId'] as string).startsWith('job:send-emails:')).toBe(true);
    expect(bindings['method']).toBe('JOB');
    expect(bindings['path']).toBe('send-emails');
  });

  test('uses explicit jobId when provided', () => {
    const childSpy = vi
      .fn()
      .mockReturnValue({ info: vi.fn(), child: vi.fn(), isLevelEnabled: vi.fn() });
    const baseLogger = { child: childSpy, info: vi.fn(), isLevelEnabled: vi.fn() };

    createJobLogger(baseLogger as never, 'cleanup', 'fixed-id-123');

    const bindings = childSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(bindings['correlationId']).toBe('fixed-id-123');
  });
});

// ── developmentFormatter ────────────────────────────────────────────────────

describe('developmentFormatter', () => {
  const baseEvent: LogEvent = {
    time: '2026-01-15T10:30:00.000Z',
    level: 'info',
    msg: 'Hello world',
  };

  test('renders a header line containing the timestamp, level, and message', () => {
    const output = developmentFormatter(baseEvent);
    expect(output).toContain('2026-01-15T10:30:00.000Z');
    expect(output).toContain('INFO');
    expect(output).toContain('Hello world');
  });

  test('omits the payload block when no extra fields are present', () => {
    const output = developmentFormatter(baseEvent);
    // No JSON block when only time/level/msg are present
    expect(output).not.toContain('{');
  });

  test('includes correlationId in the payload block when present', () => {
    const output = developmentFormatter({ ...baseEvent, correlationId: 'trace-abc' });
    expect(output).toContain('correlationId');
    expect(output).toContain('trace-abc');
  });

  test('includes err in the payload block when present', () => {
    const output = developmentFormatter({
      ...baseEvent,
      err: { name: 'Error', message: 'oops', stack: 'Error: oops\n  at fn' },
    });
    expect(output).toContain('err');
    expect(output).toContain('oops');
  });

  test('handles warn and error levels without throwing', () => {
    expect(() =>
      developmentFormatter({ ...baseEvent, level: 'warn', msg: 'watch out' }),
    ).not.toThrow();
    expect(() =>
      developmentFormatter({ ...baseEvent, level: 'error', msg: 'crashed' }),
    ).not.toThrow();
  });
});

// ── adversarial ──────────────────────────────────────────────────────────────

describe('adversarial', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('does not crash when meta contains circular references passed to child logger', () => {
    const log = createLogger('info');
    const child = log.child({ service: 'test' });
    expect(() => child.info('test')).not.toThrow();
  });

  test('fatal level reaches the output', () => {
    const events: LogEvent[] = [];
    const log = createLogger('fatal', {}, (event) => {
      events.push(event);
      return '';
    });
    log.fatal(new Error('system failure'), 'fatal hit');
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── log shape, pinned from pino 10.4.0 ──────────────────────────────────────
//
// Every row is a call and the lines it wrote on pino 10.4.0 (b70cc4d52). Lines are compared parsed
// and re-serialized: pino wrote duplicate keys, which every JSON reader collapses to the first
// position and the last value.
//
// Redaction is wider than pino's (owner decision, 2026-11-16): a name in the shared SENSITIVE_KEYS
// is censored in any case, with or without `-` and `_`, at any depth and inside arrays. The rows on
// redaction show that rule; every other line is pino's.

type MakeLogger = (level: LogLevel, bindings?: LogMeta) => Logger;

interface ShapeCase {
  readonly name: string;
  readonly log: (make: MakeLogger) => void;
  readonly lines: readonly string[];
}

const NOW = '2026-01-15T10:30:00.000Z';
const STACK = '    at fixture (logger.test.ts:1:1)';

function fixed<E extends Error>(err: E): E {
  err.stack = `${err.name}: ${err.message}\n${STACK}`;
  return err;
}

function fixedError(message: string, extra: LogMeta = {}, options?: ErrorOptions): Error {
  return Object.assign(fixed(new Error(message, options)), extra);
}

// Fastify hands raw errors to every level; the shared Logger type admits them only for error and fatal.
const isMeta = (value: unknown): value is LogMeta => typeof value === 'object' && value !== null;

const SHAPE_CASES: readonly ShapeCase[] = [
  {
    name: 'info(msg)',
    log: (make) => make('info').info('hello'),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":"hello"}'],
  },
  {
    name: 'info(msg, meta)',
    log: (make) => make('info').info('hello', { userId: 'u1', count: 2 }),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","userId":"u1","count":2,"msg":"hello"}',
    ],
  },
  {
    name: 'info(msg, msg) drops the second string',
    log: (make) => make('info').info('first', 'second'),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":"first"}'],
  },
  {
    name: 'info(meta, msg)',
    log: (make) => make('info').info({ userId: 'u1' }, 'hello'),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","userId":"u1","msg":"hello"}'],
  },
  {
    name: 'info(meta) with no message',
    log: (make) => make('info').info({ userId: 'u1' }),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","userId":"u1"}'],
  },
  {
    name: 'info({ msg })',
    log: (make) => make('info').info({ msg: 'from meta', a: 1 }),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":"from meta","a":1}'],
  },
  {
    name: 'a msg in meta and a msg argument',
    log: (make) => make('info').info({ msg: 'from meta', a: 1 }, 'from argument'),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":"from argument","a":1}'],
  },
  {
    name: 'an empty message',
    log: (make) => make('info').info(''),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":""}'],
  },
  {
    name: 'string escaping',
    log: (make) => make('info').info('quote " backslash \\ newline \n tab \t é \u2028'),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":"quote \\" backslash \\\\ newline \\n tab \\t é \u2028"}',
    ],
  },
  {
    name: 'every level',
    log: (make) => {
      const log = make('trace');
      log.trace('t');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
      log.fatal('f');
    },
    lines: [
      '{"level":"trace","time":"2026-01-15T10:30:00.000Z","msg":"t"}',
      '{"level":"debug","time":"2026-01-15T10:30:00.000Z","msg":"d"}',
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","msg":"i"}',
      '{"level":"warn","time":"2026-01-15T10:30:00.000Z","msg":"w"}',
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","msg":"e"}',
      '{"level":"fatal","time":"2026-01-15T10:30:00.000Z","msg":"f"}',
    ],
  },
  {
    name: 'levels below the configured one',
    log: (make) => {
      const log = make('warn');
      log.trace('t');
      log.debug('d');
      log.info('i');
      log.warn('w');
      log.error('e');
    },
    lines: [
      '{"level":"warn","time":"2026-01-15T10:30:00.000Z","msg":"w"}',
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","msg":"e"}',
    ],
  },
  {
    name: 'the silent level',
    log: (make) => {
      const log = make('silent');
      log.info('i');
      log.fatal('f');
    },
    lines: [],
  },
  {
    name: 'error(Error) with a code and a cause',
    log: (make) =>
      make('info').error(fixedError('boom', { code: 'E_BOOM' }, { cause: fixedError('root') })),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Object","message":"boom: root","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)\\ncaused by: Error: root\\n    at fixture (logger.test.ts:1:1)","name":"Error","code":"E_BOOM"},"msg":"boom"}',
    ],
  },
  {
    name: 'error(Error, msg, meta)',
    log: (make) => make('info').error(fixedError('boom'), 'it broke', { requestId: 'r1' }),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Object","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","name":"Error"},"requestId":"r1","msg":"it broke"}',
    ],
  },
  {
    name: 'error(Error, meta)',
    log: (make) => make('info').error(fixedError('boom'), { requestId: 'r1' }),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Object","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","name":"Error"},"requestId":"r1","msg":"boom"}',
    ],
  },
  {
    name: 'error(msg, meta)',
    log: (make) => make('info').error('plain', { detail: 'x' }),
    lines: ['{"level":"error","time":"2026-01-15T10:30:00.000Z","detail":"x","msg":"plain"}'],
  },
  {
    name: 'error(meta, msg, meta)',
    log: (make) => make('info').error({ a: 1, b: 1 }, 'm', { b: 2, c: 3 }),
    lines: ['{"level":"error","time":"2026-01-15T10:30:00.000Z","a":1,"b":2,"c":3,"msg":"m"}'],
  },
  {
    name: 'fatal(Error, msg)',
    log: (make) => make('info').fatal(fixedError('dead'), 'fatal hit'),
    lines: [
      '{"level":"fatal","time":"2026-01-15T10:30:00.000Z","err":{"type":"Object","message":"dead","stack":"Error: dead\\n    at fixture (logger.test.ts:1:1)","name":"Error"},"msg":"fatal hit"}',
    ],
  },
  {
    name: 'error({ err }) takes its message and redacts err.token',
    log: (make) => make('info').error({ err: fixedError('raw', { token: 't', code: 'E_RAW' }) }),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"raw","stack":"Error: raw\\n    at fixture (logger.test.ts:1:1)","token":"[REDACTED]","code":"E_RAW"},"msg":"raw"}',
    ],
  },
  {
    name: 'error({ err: AggregateError }, msg)',
    log: (make) =>
      make('info').error(
        { err: fixed(new AggregateError([fixedError('a1'), fixedError('a2')], 'agg')) },
        'many failed',
      ),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"AggregateError","message":"agg","stack":"AggregateError: agg\\n    at fixture (logger.test.ts:1:1)","aggregateErrors":[{"type":"Error","message":"a1","stack":"Error: a1\\n    at fixture (logger.test.ts:1:1)"},{"type":"Error","message":"a2","stack":"Error: a2\\n    at fixture (logger.test.ts:1:1)"}]},"msg":"many failed"}',
    ],
  },
  {
    name: 'an Error under another key keeps only its own enumerable fields',
    log: (make) => make('info').warn({ error: fixedError('hidden', { code: 'E1' }) }, 'w'),
    lines: ['{"level":"warn","time":"2026-01-15T10:30:00.000Z","error":{"code":"E1"},"msg":"w"}'],
  },
  {
    name: 'warn(Error, msg)',
    log: (make) => {
      const err = fixedError('w-err', { code: 'E2' });
      if (isMeta(err)) make('info').warn(err, 'm');
    },
    lines: [
      '{"level":"warn","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"w-err","stack":"Error: w-err\\n    at fixture (logger.test.ts:1:1)","code":"E2"},"msg":"m"}',
    ],
  },
  {
    name: 'debug(Error)',
    log: (make) => {
      const err = fixedError('d-err');
      if (isMeta(err)) make('debug').debug(err);
    },
    lines: [
      '{"level":"debug","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"d-err","stack":"Error: d-err\\n    at fixture (logger.test.ts:1:1)"},"msg":"d-err"}',
    ],
  },
  {
    name: '(msg, Error) puts the error under err at every level',
    log: (make) => {
      const log = make('trace');
      const err = fixedError('boom', { code: 'E1' });
      if (!isMeta(err)) return;
      log.trace('t', err);
      log.debug('d', err);
      log.info('i', err);
      log.warn('w', err);
    },
    lines: [
      '{"level":"trace","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"t"}',
      '{"level":"debug","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"d"}',
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"i"}',
      '{"level":"warn","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"w"}',
    ],
  },
  {
    name: 'error and fatal (msg, Error), and the meta after it dropped',
    log: (make) => {
      const log = make('info');
      const err = fixedError('boom', { code: 'E1' });
      if (!isMeta(err)) return;
      log.error('failed', err);
      log.error('failed', err, { a: 1 });
      log.error('failed', undefined, err);
      log.fatal('dead', err);
    },
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"failed"}',
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"failed"}',
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"failed"}',
      '{"level":"fatal","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"boom","stack":"Error: boom\\n    at fixture (logger.test.ts:1:1)","code":"E1"},"msg":"dead"}',
    ],
  },
  {
    name: 'warn({ err }) with no message',
    log: (make) => make('info').warn({ err: fixedError('already sent') }),
    lines: [
      '{"level":"warn","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"already sent","stack":"Error: already sent\\n    at fixture (logger.test.ts:1:1)"},"msg":"already sent"}',
    ],
  },
  {
    name: 'trace({ err }, msg)',
    log: (make) => make('trace').trace({ err: fixedError('reset') }, 'client error'),
    lines: [
      '{"level":"trace","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"reset","stack":"Error: reset\\n    at fixture (logger.test.ts:1:1)"},"msg":"client error"}',
    ],
  },
  {
    name: 'an err that is not error-like',
    log: (make) => {
      const log = make('info');
      log.error({ err: { message: 5 } });
      log.error({ err: 'just a string' });
    },
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"message":5},"msg":5}',
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":"just a string"}',
    ],
  },
  {
    name: 'an err with its own msg in meta',
    log: (make) => make('info').info({ err: fixedError('e'), msg: 'meta msg' }),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"e","stack":"Error: e\\n    at fixture (logger.test.ts:1:1)"},"msg":"meta msg"}',
    ],
  },
  {
    name: 'a nested error-like value inside err',
    log: (make) =>
      make('info').error({
        err: fixedError('outer', { details: { message: 'inner', token: 't' } }),
      }),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"outer","stack":"Error: outer\\n    at fixture (logger.test.ts:1:1)","details":{"type":"Object","message":"inner","stack":"","token":"[REDACTED]"}},"msg":"outer"}',
    ],
  },
  {
    name: 'fields of an err, censored in any case and at any depth',
    log: (make) =>
      make('info').error({
        err: fixedError('raw', { Token: 't', response: { data: { access_token: 'at' } } }),
      }),
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"raw","stack":"Error: raw\\n    at fixture (logger.test.ts:1:1)","Token":"[REDACTED]","response":{"data":{"access_token":"[REDACTED]"}}},"msg":"raw"}',
    ],
  },
  {
    name: 'a cause that is not an Error stays a field',
    log: (make) => {
      const log = make('info');
      log.error({ err: fixedError('c1', { cause: 'string-cause' }) });
      log.error({ err: fixedError('c2', { cause: { code: 1 } }) });
    },
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"c1","stack":"Error: c1\\n    at fixture (logger.test.ts:1:1)","cause":"string-cause"},"msg":"c1"}',
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"c2","stack":"Error: c2\\n    at fixture (logger.test.ts:1:1)","cause":{"code":1}},"msg":"c2"}',
    ],
  },
  {
    name: 'inherited enumerable fields of an err',
    log: (make) => {
      class TaggedError extends Error {}
      Object.defineProperty(TaggedError.prototype, 'tag', { value: 'inherited', enumerable: true });
      make('info').error({ err: fixed(new TaggedError('tagged')) });
    },
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"TaggedError","message":"tagged","stack":"Error: tagged\\n    at fixture (logger.test.ts:1:1)","tag":"inherited"},"msg":"tagged"}',
    ],
  },
  {
    name: 'causes that loop',
    log: (make) => {
      const first = fixedError('first');
      const second = fixedError('second', {}, { cause: first });
      Object.defineProperty(first, 'cause', { value: second });
      make('info').error({ err: first });
    },
    lines: [
      '{"level":"error","time":"2026-01-15T10:30:00.000Z","err":{"type":"Error","message":"first: second: first: ...","stack":"Error: first\\n    at fixture (logger.test.ts:1:1)\\ncaused by: Error: second\\n    at fixture (logger.test.ts:1:1)\\ncaused by: Error: first\\n    at fixture (logger.test.ts:1:1)\\ncauses have become circular..."},"msg":"first"}',
    ],
  },
  {
    name: 'base bindings, overridden by meta',
    log: (make) => make('info', { service: 'api', env: 'test' }).info('hi', { env: 'override' }),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","service":"api","env":"override","msg":"hi"}',
    ],
  },
  {
    name: 'base bindings that pino reserves',
    log: (make) =>
      make('info', {
        level: 'dbg',
        name: 'n',
        serializers: {},
        formatters: {},
        customLevels: {},
        undef: undefined,
      }).info('x'),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","name":"n","msg":"x"}'],
  },
  {
    name: 'child bindings, overriding parent bindings',
    log: (make) =>
      make('info', { service: 'api' })
        .child({ service: 'worker', jobId: 'j1' })
        .child({ step: 2 })
        .info('child'),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","service":"worker","jobId":"j1","step":2,"msg":"child"}',
    ],
  },
  {
    name: 'child bindings that pino reserves, and redacted ones',
    log: (make) => {
      const child = make('info').child({
        level: 'debug',
        serializers: {},
        formatters: {},
        customLevels: {},
        undef: undefined,
        token: 't',
        nested: { password: 'p' },
      });
      child.debug('hidden');
      child.info('x');
    },
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","token":"[REDACTED]","nested":{"password":"[REDACTED]"},"msg":"x"}',
    ],
  },
  {
    name: 'base and child bindings, censored in any case and at any depth',
    log: (make) =>
      make('info', { Authorization: 'A', db: { credentials: { password: 'p' } } })
        .child({ oauth: [{ refresh_token: 'r' }] })
        .info('b'),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","Authorization":"[REDACTED]","db":{"credentials":{"password":"[REDACTED]"}},"oauth":[{"refresh_token":"[REDACTED]"}],"msg":"b"}',
    ],
  },
  {
    name: 'createRequestLogger',
    log: (make) =>
      createRequestLogger(make('info', { service: 'api' }), {
        correlationId: 'c1',
        requestId: 'r1',
        method: 'GET',
        path: '/x',
        ip: '10.0.0.1',
        traceId: 'trace-1',
      }).info('req'),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","service":"api","correlationId":"c1","requestId":"r1","method":"GET","path":"/x","traceId":"trace-1","msg":"req"}',
    ],
  },
  {
    name: 'createJobLogger',
    log: (make) => createJobLogger(make('info'), 'job', 'id1').info('job ran'),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","correlationId":"id1","requestId":"id1","method":"JOB","path":"job","msg":"job ran"}',
    ],
  },
  {
    name: 'redacted keys at the top level, in any case',
    log: (make) =>
      make('info').info(
        {
          authorization: 'a',
          cookie: 'c',
          'set-cookie': 's',
          password: 'p',
          token: 't',
          secret: 's',
          key: 'k',
          apiKey: 'ak',
          keyId: 'kid',
          Authorization: 'A',
          accessToken: 'at',
        },
        'top',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","authorization":"[REDACTED]","cookie":"[REDACTED]","set-cookie":"[REDACTED]","password":"[REDACTED]","token":"[REDACTED]","secret":"[REDACTED]","key":"[REDACTED]","apiKey":"[REDACTED]","keyId":"kid","Authorization":"[REDACTED]","accessToken":"[REDACTED]","msg":"top"}',
    ],
  },
  {
    name: 'the shared sensitive keys pino left in clear',
    log: (make) =>
      make('info').info(
        {
          'proxy-authorization': 'pa',
          cookies: { sid: 'c' },
          'x-csrf-token': 'xc',
          'x-sudo-token': 'xs',
          currentPassword: 'cp',
          newPassword: 'np',
          passwordHash: '$argon2id$h',
          refreshToken: 'rt',
          idToken: 'it',
          csrfToken: 'ct',
          sudoToken: 'st',
          challengeToken: 'ch',
          clientSecret: 'cs',
          totpSecret: 'ts',
          privateKey: 'pk',
          creditCard: '4242',
          cvv: '123',
          cardDetails: { last4: '4242' },
        },
        'shared',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","proxy-authorization":"[REDACTED]","cookies":"[REDACTED]","x-csrf-token":"[REDACTED]","x-sudo-token":"[REDACTED]","currentPassword":"[REDACTED]","newPassword":"[REDACTED]","passwordHash":"[REDACTED]","refreshToken":"[REDACTED]","idToken":"[REDACTED]","csrfToken":"[REDACTED]","sudoToken":"[REDACTED]","challengeToken":"[REDACTED]","clientSecret":"[REDACTED]","totpSecret":"[REDACTED]","privateKey":"[REDACTED]","creditCard":"[REDACTED]","cvv":"[REDACTED]","cardDetails":"[REDACTED]","msg":"shared"}',
    ],
  },
  {
    name: 'redacted keys in any case, with or without - and _',
    log: (make) =>
      make('info').info(
        {
          AUTHORIZATION: 'A',
          Cookie: 'C',
          'Set-Cookie': 'S',
          Password: 'P',
          TOKEN: 'T',
          Secret: 'S',
          KEY: 'K',
          ApiKey: 'AK',
          api_key: 'ak',
          'api-key': 'ak',
          access_token: 'at',
          ACCESS_TOKEN: 'AT',
          'refresh-token': 'rt',
          id_token: 'it',
          client_secret: 'cs',
          private_key: 'pk',
          password_hash: 'ph',
          totp_secret: 'ts',
          'X-CSRF-Token': 'xc',
          'X-Sudo-Token': 'xs',
        },
        'case',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","AUTHORIZATION":"[REDACTED]","Cookie":"[REDACTED]","Set-Cookie":"[REDACTED]","Password":"[REDACTED]","TOKEN":"[REDACTED]","Secret":"[REDACTED]","KEY":"[REDACTED]","ApiKey":"[REDACTED]","api_key":"[REDACTED]","api-key":"[REDACTED]","access_token":"[REDACTED]","ACCESS_TOKEN":"[REDACTED]","refresh-token":"[REDACTED]","id_token":"[REDACTED]","client_secret":"[REDACTED]","private_key":"[REDACTED]","password_hash":"[REDACTED]","totp_secret":"[REDACTED]","X-CSRF-Token":"[REDACTED]","X-Sudo-Token":"[REDACTED]","msg":"case"}',
    ],
  },
  {
    name: 'hashed one-time codes and the credentials of auth flows',
    log: (make) =>
      make('info').info(
        {
          tokenHash: 'sha256(email:123456)',
          codeHash: 'sha256(123456)',
          backupCodes: ['a1b2c3d4'],
          totpCode: '123456',
          captchaToken: 'cap',
          verificationToken: 'vt',
          cookieToken: 'ck',
          requestToken: 'rq',
          'x-api-key': 'xk',
        },
        'auth',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","tokenHash":"[REDACTED]","codeHash":"[REDACTED]","backupCodes":"[REDACTED]","totpCode":"[REDACTED]","captchaToken":"[REDACTED]","verificationToken":"[REDACTED]","cookieToken":"[REDACTED]","requestToken":"[REDACTED]","x-api-key":"[REDACTED]","msg":"auth"}',
    ],
  },
  {
    name: 'the secrets that services and config carry',
    log: (make) =>
      make('info').info(
        {
          deps: { encryptionKey: 'ek', sealSecret: 'ss', jwtSecret: 'js' },
          config: {
            auth: { previousSecret: 'ps', oauthTokenEncryptionKey: 'oek' },
            billing: { secretKey: 'sk', webhookSecret: 'ws' },
            storage: { signingSecret: 'sg', secretAccessKey: 'sak' },
            push: { restApiKey: 'rak', userAuthKey: 'uak' },
            sms: { authToken: 'at' },
          },
        },
        'config',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","deps":{"encryptionKey":"[REDACTED]","sealSecret":"[REDACTED]","jwtSecret":"[REDACTED]"},"config":{"auth":{"previousSecret":"[REDACTED]","oauthTokenEncryptionKey":"[REDACTED]"},"billing":{"secretKey":"[REDACTED]","webhookSecret":"[REDACTED]"},"storage":{"signingSecret":"[REDACTED]","secretAccessKey":"[REDACTED]"},"push":{"restApiKey":"[REDACTED]","userAuthKey":"[REDACTED]"},"sms":{"authToken":"[REDACTED]"}},"msg":"config"}',
    ],
  },
  {
    name: 'raw header arrays, which no name inside can censor',
    log: (make) =>
      make('info').info(
        {
          ctx: {
            raw: {
              headers: { authorization: 'Bearer A', host: 'h' },
              rawHeaders: ['Authorization', 'Bearer A', 'Host', 'h'],
              rawTrailers: ['X-Signature', 'sig'],
            },
          },
        },
        'raw',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","ctx":{"raw":{"headers":{"authorization":"[REDACTED]","host":"h"},"rawHeaders":"[REDACTED]","rawTrailers":"[REDACTED]"}},"msg":"raw"}',
    ],
  },
  {
    name: 'names that only contain a sensitive word are kept',
    log: (make) =>
      make('info').info(
        {
          monkey: 'm',
          keyId: 'kid',
          keys: ['k'],
          apiKeyId: 'ak1',
          publicKey: 'pub',
          idempotencyKey: 'ik',
          archiveKey: 'audit/2026.jsonl',
          tokenVersion: 3,
          tokenType: 'Bearer',
          hasToken: true,
          hasRefreshToken: false,
          passwordless: true,
          secretary: 's',
          authorizationUrl: 'https://example.test/authorize',
          cookieConsent: true,
          sessionId: 's1',
        },
        'kept',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","monkey":"m","keyId":"kid","keys":["k"],"apiKeyId":"ak1","publicKey":"pub","idempotencyKey":"ik","archiveKey":"audit/2026.jsonl","tokenVersion":3,"tokenType":"Bearer","hasToken":true,"hasRefreshToken":false,"passwordless":true,"secretary":"s","authorizationUrl":"https://example.test/authorize","cookieConsent":true,"sessionId":"s1","msg":"kept"}',
    ],
  },
  {
    name: 'redacted keys nested at any depth and inside arrays, in any case',
    log: (make) =>
      make('info').info(
        {
          headers: { Authorization: 'Bearer A', Cookie: 'sid=C', host: 'h' },
          oauth: {
            response: { access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' },
          },
          users: [{ id: 'u1', passwordHash: 'h', TotpSecret: 's' }, [{ apiKey: 'k' }]],
          deep: { a: { b: { c: { d: { e: { f: { clientSecret: 'cs', g: 1 } } } } } } },
        },
        'deep',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","headers":{"Authorization":"[REDACTED]","Cookie":"[REDACTED]","host":"h"},"oauth":{"response":{"access_token":"[REDACTED]","refresh_token":"[REDACTED]","token_type":"Bearer"}},"users":[{"id":"u1","passwordHash":"[REDACTED]","TotpSecret":"[REDACTED]"},[{"apiKey":"[REDACTED]"}]],"deep":{"a":{"b":{"c":{"d":{"e":{"f":{"clientSecret":"[REDACTED]","g":1}}}}}}},"msg":"deep"}',
    ],
  },
  {
    name: 'redacted keys at any depth, inside arrays too',
    log: (make) =>
      make('info').info(
        {
          user: { password: 'p', name: 'n', token: undefined },
          deep: { inner: { password: 'p' } },
          list: [{ password: 'p' }],
        },
        'nested',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","user":{"password":"[REDACTED]","name":"n","token":"[REDACTED]"},"deep":{"inner":{"password":"[REDACTED]"}},"list":[{"password":"[REDACTED]"}],"msg":"nested"}',
    ],
  },
  {
    name: 'what a toJSON returns is censored at any depth',
    log: (make) => {
      class Connection {
        readonly #token = 'live-token';
        readonly provider = 'github';
        toJSON(): LogMeta {
          return { provider: this.provider, tokens: { accessToken: this.#token } };
        }
      }
      make('info').info({ conn: new Connection() }, 'c');
    },
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","conn":{"provider":"github","tokens":{"accessToken":"[REDACTED]"}},"msg":"c"}',
    ],
  },
  {
    name: 'a toJSON that renames or concatenates a listed field, at any depth',
    log: (make) => {
      class Copier {
        readonly password = 'p';
        toJSON(): LogMeta {
          return { pw: this.password };
        }
      }
      class Bearer {
        readonly token = 't';
        toJSON(): string {
          return `Bearer ${this.token}`;
        }
      }
      make('info').info(
        { copier: new Copier(), nested: { auth: new Bearer() }, list: [new Copier()] },
        'renamed',
      );
    },
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","copier":{"pw":"[REDACTED]"},"nested":{"auth":"Bearer [REDACTED]"},"list":[{"pw":"[REDACTED]"}],"msg":"renamed"}',
    ],
  },
  {
    name: 'a value with toJSON is censored before its toJSON runs',
    log: (make) => {
      class Session {
        readonly token = 't0k';
        readonly refreshHash = 'HASH';
        readonly id = 's1';
        toJSON(): LogMeta {
          return { id: this.id };
        }
      }
      class Echo {
        readonly password = 'p';
        readonly id = 'e1';
        toJSON(): LogMeta {
          return { id: this.id, password: this.password };
        }
      }
      make('info').info({ session: new Session(), echo: new Echo() }, 's');
    },
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","session":{"id":"s1"},"echo":{"id":"e1","password":"[REDACTED]"},"msg":"s"}',
    ],
  },
  {
    name: 'redaction of empty values',
    log: (make) =>
      make('info').info(
        { password: null, token: '', secret: 0, key: false, user: { password: null } },
        'empty',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","password":"[REDACTED]","token":"[REDACTED]","secret":"[REDACTED]","key":"[REDACTED]","user":{"password":"[REDACTED]"},"msg":"empty"}',
    ],
  },
  {
    name: 'undefined fields are dropped',
    log: (make) => make('info').info({ password: undefined, a: undefined, b: 1 }, 'undef'),
    lines: ['{"level":"info","time":"2026-01-15T10:30:00.000Z","b":1,"msg":"undef"}'],
  },
  {
    name: 'request header paths',
    log: (make) =>
      make('info').info(
        {
          req: {
            headers: { authorization: 'a', cookie: 'c', 'set-cookie': 's', host: 'h' },
            password: 'p',
          },
          request: { headers: { authorization: 'a', cookie: 'c', 'set-cookie': 's' } },
        },
        'headers',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","req":{"headers":{"authorization":"[REDACTED]","cookie":"[REDACTED]","set-cookie":"[REDACTED]","host":"h"},"password":"[REDACTED]"},"request":{"headers":{"authorization":"[REDACTED]","cookie":"[REDACTED]","set-cookie":"[REDACTED]"}},"msg":"headers"}',
    ],
  },
  {
    name: 'request headers that are not enumerable stay out',
    log: (make) => {
      const req = Object.defineProperty({ method: 'GET' }, 'headers', {
        value: { authorization: 'a', host: 'h' },
        enumerable: false,
      });
      make('info').info({ req }, 'hidden');
    },
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","req":{"method":"GET"},"msg":"hidden"}',
    ],
  },
  {
    name: 'a __proto__ key from parsed JSON',
    log: (make) => {
      const meta: unknown = JSON.parse('{"__proto__":{"password":"p","x":1},"a":1}');
      if (isMeta(meta)) make('info').info(meta, 'proto');
    },
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","__proto__":{"password":"[REDACTED]","x":1},"a":1,"msg":"proto"}',
    ],
  },
  {
    name: 'value types',
    log: (make) =>
      make('info').info(
        {
          date: new Date(NOW),
          nan: NaN,
          inf: Infinity,
          undef: undefined,
          fn: () => 1,
          sym: Symbol('s'),
          map: new Map([['a', 1]]),
          big: 10n,
          nested: { nan: NaN, fn: () => 1, undef: undefined, date: new Date(NOW) },
          deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
        },
        'types',
      ),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","date":"2026-01-15T10:30:00.000Z","nan":null,"inf":null,"map":{},"big":10,"nested":{"nan":null,"date":"2026-01-15T10:30:00.000Z"},"deep":{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}},"msg":"types"}',
    ],
  },
  {
    name: 'a Buffer is opaque at the top level and printed when nested',
    log: (make) =>
      make('info').info({ buf: Buffer.from('ab'), wrap: { buf: Buffer.from('ab') } }, 'bytes'),
    lines: [
      '{"level":"info","time":"2026-01-15T10:30:00.000Z","buf":"[unable to serialize, circular reference is too complex to analyze]","wrap":{"buf":{"type":"Buffer","data":[97,98]}},"msg":"bytes"}',
    ],
  },
  {
    name: 'meta level and time',
    log: (make) => make('info').info({ time: 'meta-time', level: 'meta-level' }, 'override'),
    lines: ['{"level":"meta-level","time":"meta-time","msg":"override"}'],
  },
  {
    name: 'integer-like keys',
    log: (make) => make('info').info({ a: 1, '123': 'n' }, 'ints'),
    lines: ['{"123":"n","level":"info","time":"2026-01-15T10:30:00.000Z","a":1,"msg":"ints"}'],
  },
];

function captureLines(
  log: (make: MakeLogger) => void,
  formatter?: (event: LogEvent) => string,
): string[] {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    log((level, bindings) => createLogger(level, bindings, formatter));
    return write.mock.calls.map(([chunk]) => String(chunk));
  } finally {
    write.mockRestore();
  }
}

const normalize = (chunk: string): string => JSON.stringify(JSON.parse(chunk));

describe('log shape, pinned from pino 10.4.0', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test.each(SHAPE_CASES)('$name', ({ log, lines }) => {
    expect(captureLines(log, (event) => JSON.stringify(event)).map(normalize)).toEqual(lines);
  });

  test.each(SHAPE_CASES)('$name, as stdout lines without duplicate keys', ({ log, lines }) => {
    const chunks = captureLines(log);
    expect(chunks.map(normalize)).toEqual(lines);
    for (const chunk of chunks) {
      expect(chunk.startsWith('{"level":')).toBe(true);
      expect(chunk.endsWith('}\n')).toBe(true);
      // A duplicate key adds bytes that parsing drops.
      expect(chunk.length).toBe(normalize(chunk).length + 1);
    }
  });

  test('leaves the logged object as it was', () => {
    const err = fixedError('e', { token: 't' });
    const user = { token: 't' };
    const meta = { password: 'p', user, err };
    captureLines((make) => make('info').info(meta, 'm'));
    expect(meta).toEqual({ password: 'p', user: { token: 't' }, err });
    expect(meta.user).toBe(user);
    expect(Object.getOwnPropertySymbols(err)).toEqual([]);
  });
});

const UNSERIALIZABLE = '[unable to serialize, circular reference is too complex to analyze]';
const AT = { level: 'info', time: expect.any(String) };

function lineOf(log: (logger: Logger) => void): unknown {
  const chunks = captureLines((make) => log(make('info')));
  expect(chunks).toHaveLength(1);
  return JSON.parse(chunks[0] ?? '');
}

// ── redaction ───────────────────────────────────────────────────────────────

describe('redaction', () => {
  test.each(SENSITIVE_KEYS)('censors %s as written, upper-cased, nested and in arrays', (name) => {
    const upper = name.toUpperCase();
    expect(
      lineOf((log) => log.info({ [name]: 'x', [upper]: 'x', a: { b: [{ [name]: 'x' }] } }, 'k')),
    ).toEqual({
      ...AT,
      [name]: '[REDACTED]',
      [upper]: '[REDACTED]',
      a: { b: [{ [name]: '[REDACTED]' }] },
      msg: 'k',
    });
  });

  test('leaves nested, array and frozen values as they were', () => {
    const frozen = Object.freeze({ Authorization: 'A', inner: Object.freeze({ token: 't' }) });
    const list = [{ refreshToken: 'r' }, frozen];
    const deep = { a: { accessToken: 'at' } };
    const meta = { deep, list };
    expect(lineOf((log) => log.info(meta, 'm'))).toEqual({
      ...AT,
      deep: { a: { accessToken: '[REDACTED]' } },
      list: [
        { refreshToken: '[REDACTED]' },
        { Authorization: '[REDACTED]', inner: { token: '[REDACTED]' } },
      ],
      msg: 'm',
    });
    expect(meta).toEqual({
      deep: { a: { accessToken: 'at' } },
      list: [{ refreshToken: 'r' }, { Authorization: 'A', inner: { token: 't' } }],
    });
    expect(meta.deep).toBe(deep);
    expect(meta.list).toBe(list);
    expect(list[1]).toBe(frozen);
  });

  test('a circular value is censored at any depth, and cut at its first repeat', () => {
    const self: LogMeta = { Token: 't', list: [{ secret: 's' }] };
    self['self'] = self;
    expect(lineOf((log) => log.info({ c: self }, 'cyc'))).toEqual({
      ...AT,
      c: { Token: '[REDACTED]', list: [{ secret: '[REDACTED]' }], self: '[Circular]' },
      msg: 'cyc',
    });
  });

  test('a value cut below five levels is censored above the cut', () => {
    const cut = { a: { b: { accessToken: 'at', c: { d: { e: { f: 1 } } } } }, big: 1n };
    expect(lineOf((log) => log.info({ cut }, 'deep'))).toEqual({
      ...AT,
      cut: { a: { b: { accessToken: '[REDACTED]', c: { d: { e: '[Object]' } } } }, big: 1 },
      msg: 'deep',
    });
  });

  test('a live request under any other key, or nested, keeps its raw headers out', () => {
    const incoming = new IncomingMessage(new Socket());
    incoming.rawHeaders = ['Authorization', 'Bearer SECRET', 'Cookie', 'sid=SID'];
    const chunks = captureLines((make) =>
      make('info').info({ incoming, ctx: { raw: incoming } }, 'live'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).not.toContain('SECRET');
    expect(chunks[0]).not.toContain('sid=SID');
    expect(JSON.parse(chunks[0] ?? '')).toMatchObject({
      incoming: { rawHeaders: '[REDACTED]' },
      ctx: { raw: { rawHeaders: '[REDACTED]' } },
    });
  });

  test('a toJSON runs on a censored copy that keeps its prototype; the logged value keeps its fields', () => {
    class Masked {
      readonly secret = 's3cr3t';
      readonly id = 'm1';
      label(): string {
        return `${this.id}:${this.secret}`;
      }
      toJSON(key: string): LogMeta {
        return { under: key, label: this.label() };
      }
    }
    const masked = new Masked();
    expect(lineOf((log) => log.info({ wrap: { masked }, list: [masked] }, 'm'))).toEqual({
      ...AT,
      wrap: { masked: { under: 'masked', label: 'm1:[REDACTED]' } },
      list: [{ under: '0', label: 'm1:[REDACTED]' }],
      msg: 'm',
    });
    expect(masked.secret).toBe('s3cr3t');
    expect(masked.label()).toBe('m1:s3cr3t');
  });

  test('a toJSON reads listed fields as censored on the cycle fallback too', () => {
    class Copier {
      readonly password = 'p';
      toJSON(): LogMeta {
        return { pw: this.password };
      }
    }
    const self: LogMeta = { copier: new Copier() };
    self['self'] = self;
    expect(lineOf((log) => log.info({ c: self }, 'cyc'))).toEqual({
      ...AT,
      c: { copier: { pw: '[REDACTED]' }, self: '[Circular]' },
      msg: 'cyc',
    });
  });

  test('a toJSON that cannot run on the censored copy leaves its field out, never in clear', () => {
    class Sealed {
      readonly #inner = 'inner';
      readonly token = 't0k';
      toJSON(): LogMeta {
        return { inner: this.#inner, bearer: this.token };
      }
    }
    expect(lineOf((log) => log.info({ sealed: new Sealed(), ok: 1 }, 's'))).toEqual({
      ...AT,
      sealed: UNSERIALIZABLE,
      ok: 1,
      msg: 's',
    });
  });
});

// ── values pino could not log ───────────────────────────────────────────────

describe('values pino could not log', () => {
  test('a circular value is cut at its first repeat', () => {
    const self: LogMeta = { a: 1 };
    self['self'] = self;
    expect(lineOf((log) => log.info({ c: self }, 'cyc'))).toEqual({
      ...AT,
      c: { a: 1, self: '[Circular]' },
      msg: 'cyc',
    });
  });

  test('a value that needs the fallback is cut below five levels; its neighbours print in full', () => {
    const cut = { a: { b: { c: { d: { e: { f: 1 } } } } }, big: 1n };
    const full = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(lineOf((log) => log.info({ cut, full }, 'deep'))).toEqual({
      ...AT,
      cut: { a: { b: { c: { d: { e: '[Object]' } } } }, big: 1 },
      full,
      msg: 'deep',
    });
  });

  test('a top-level URL logs its href', () => {
    expect(lineOf((log) => log.info({ url: new URL('https://example.test/a?b=1') }, 'u'))).toEqual({
      ...AT,
      url: 'https://example.test/a?b=1',
      msg: 'u',
    });
  });

  test('a value whose toJSON throws is replaced, and the other fields stay', () => {
    const broken = {
      toJSON(): never {
        throw new Error('no');
      },
    };
    expect(lineOf((log) => log.info({ broken, ok: 1 }, 'x'))).toEqual({
      ...AT,
      broken: UNSERIALIZABLE,
      ok: 1,
      msg: 'x',
    });
  });

  test('a frozen Error under err is serialized without being tagged', () => {
    const err = Object.freeze(fixedError('frozen'));
    expect(lineOf((log) => log.error({ err }))).toEqual({
      level: 'error',
      time: expect.any(String),
      err: { type: 'Error', message: 'frozen', stack: `Error: frozen\n${STACK}` },
      msg: 'frozen',
    });
  });

  test('a field whose getter throws is replaced, and the call does not throw', () => {
    const meta = {
      get bad(): never {
        throw new Error('getter');
      },
      ok: 1,
    };
    expect(lineOf((log) => log.warn(meta, 'kept'))).toEqual({
      level: 'warn',
      time: expect.any(String),
      bad: UNSERIALIZABLE,
      ok: 1,
      msg: 'kept',
    });
  });

  test('arguments that cannot be read leave a marker line', () => {
    const meta = {
      get err(): never {
        throw new Error('getter');
      },
    };
    expect(lineOf((log) => log.child({ service: 's' }).error(meta))).toEqual({
      level: 'error',
      time: expect.any(String),
      service: 's',
      msg: UNSERIALIZABLE,
    });
  });

  test('a formatter that throws leaves the raw line', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      createLogger('info', {}, () => {
        throw new Error('format');
      }).info('raw');
      expect(write.mock.calls.map(([chunk]) => JSON.parse(String(chunk)))).toEqual([
        { level: 'info', time: expect.any(String), msg: 'raw' },
      ]);
    } finally {
      write.mockRestore();
    }
  });
});

// ── HTTP Server loggerInstance ──────────────────────────────────────────────

describe('as an HTTP server loggerInstance', () => {
  test('exposes level and silent() writes nothing', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const log = createLogger('warn');
      expect(log.level).toBe('warn');
      log.silent('nothing');
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  test('a route log carries the request id and the base bindings', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const app = createHttpServer({
        loggerInstance: createLogger('info', { service: 's' }),
        disableRequestLogging: true,
        genReqId: () => 'req-1',
      });
      app.get('/', (request) => {
        request.log.info('in route');
        return 'ok';
      });
      await app.inject({ method: 'GET', url: '/' });
      await app.close();
      expect(write.mock.calls.map(([chunk]) => JSON.parse(String(chunk)))).toEqual([
        { level: 'info', time: expect.any(String), service: 's', reqId: 'req-1', msg: 'in route' },
      ]);
    } finally {
      write.mockRestore();
    }
  });

  test('request logging summarizes the live request and reply, and leaves their headers out', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const app = createHttpServer({
        loggerInstance: createLogger('info'),
        genReqId: () => 'req-1',
      });
      app.get('/', () => 'ok');
      await app.inject({
        method: 'GET',
        url: '/',
        headers: { authorization: 'Bearer SECRET-TOKEN', cookie: 'sid=SECRET-COOKIE' },
      });
      await app.close();
      const chunks = write.mock.calls.map(([chunk]) => String(chunk));
      expect(chunks.join('')).not.toContain('SECRET');
      expect(chunks.map((chunk) => JSON.parse(chunk))).toEqual([
        {
          level: 'info',
          time: expect.any(String),
          reqId: 'req-1',
          req: { method: 'GET', url: '/', host: 'localhost:80', remoteAddress: '127.0.0.1' },
          msg: 'incoming request',
        },
        {
          level: 'info',
          time: expect.any(String),
          reqId: 'req-1',
          res: { statusCode: 200 },
          responseTime: expect.any(Number),
          msg: 'request completed',
        },
      ]);
    } finally {
      write.mockRestore();
    }
  });
});
