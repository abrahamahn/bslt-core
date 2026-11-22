// main/apps/server/src/plugin/logger.test.ts

import { describe, expect, test, vi } from 'vitest';

import { loggerPlugin } from './logger';

const mockCollector = vi.hoisted(() => ({
  incrementRequestCount: vi.fn(),
  recordRequestLatency: vi.fn(),
}));

vi.mock('@bslt/server-system/observability', () => ({
  getMetricsCollector: () => mockCollector,
}));

import type {
  HookDoneFunction,
  HttpServer,
  HttpServerReply,
  HttpServerRequest,
} from '@bslt/server-system/http';
import type { Logger } from '@bslt/server-system/logger';

function createLoggerMock() {
  const childLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    isLevelEnabled: vi.fn(() => true),
  } satisfies Partial<Logger>;

  const baseLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => childLogger),
    isLevelEnabled: vi.fn(() => true),
  } satisfies Partial<Logger>;

  return {
    baseLogger: baseLogger as Logger,
    childLogger: childLogger as Logger,
  };
}

function captureHooks(appLog?: Logger) {
  type CapturedHook = (
    request: HttpServerRequest,
    reply: HttpServerReply,
    done: HookDoneFunction,
  ) => void;

  let onRequest: CapturedHook | undefined;
  let onResponse: CapturedHook | undefined;

  const server = {
    appLog,
    addHook: vi.fn((name: string, handler: unknown) => {
      if (name === 'onRequest') {
        onRequest = handler as CapturedHook;
      }
      if (name === 'onResponse') {
        onResponse = handler as CapturedHook;
      }
    }),
  } as unknown as HttpServer;

  return {
    server,
    getOnRequest: () => {
      if (onRequest === undefined) throw new Error('Expected onRequest hook to be registered');
      const hook = onRequest;
      return (request: HttpServerRequest, reply: HttpServerReply): void => {
        hook(request, reply, vi.fn());
      };
    },
    getOnResponse: () => {
      if (onResponse === undefined) throw new Error('Expected onResponse hook to be registered');
      const hook = onResponse;
      return (request: HttpServerRequest, reply: HttpServerReply): void => {
        hook(request, reply, vi.fn());
      };
    },
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    method: 'GET',
    url: '/test',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
    routeOptions: { url: '/test' },
    log: {},
    ...overrides,
  } as unknown as HttpServerRequest;
}

function makeReply(overrides: Partial<HttpServerReply> = {}) {
  return {
    header: vi.fn(),
    statusCode: 200,
    elapsedTime: 25,
    ...overrides,
  } as unknown as HttpServerReply;
}

describe('loggerPlugin', () => {
  // ── fail-fast ────────────────────────────────────────────────────────────────

  test('throws when appLog is not decorated on server', () => {
    const { server } = captureHooks();
    expect(() => loggerPlugin(server)).toThrow(
      'loggerPlugin requires server.appLog to be set (Logger).',
    );
  });

  // ── correlationId resolution ──────────────────────────────────────────────

  test('reuses existing correlationId set by earlier hook', () => {
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ correlationId: 'pre-existing-id' });
    const reply = makeReply();

    getOnRequest()(request, reply);

    expect(request.correlationId).toBe('pre-existing-id');
    expect(request.requestContext.correlationId).toBe('pre-existing-id');
    expect(reply.header).toHaveBeenCalledWith('x-correlation-id', 'pre-existing-id');
    expect(baseLogger.child).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'pre-existing-id' }),
    );
    expect(request.log).toBe(childLogger);
  });

  test('derives correlationId from x-correlation-id header when not pre-set', () => {
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ headers: { 'x-correlation-id': 'from-header' } });
    const reply = makeReply();

    getOnRequest()(request, reply);

    expect(request.correlationId).toBe('from-header');
    expect(reply.header).toHaveBeenCalledWith('x-correlation-id', 'from-header');
  });

  test('extracts traceId from traceparent header and binds it to child logger', () => {
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const request = makeRequest({
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    });
    const reply = makeReply();

    getOnRequest()(request, reply);

    // correlationId falls back to traceId when no x-correlation-id
    expect(request.correlationId).toBe(traceId);
    expect(request.requestContext.traceId).toBe(traceId);
    expect(baseLogger.child).toHaveBeenCalledWith(expect.objectContaining({ traceId }));
  });

  test('generates a new correlationId when no headers provide one', () => {
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ headers: {} });
    const reply = makeReply();

    getOnRequest()(request, reply);

    expect(typeof request.correlationId).toBe('string');
    expect((request.correlationId as string).length).toBeGreaterThan(0);
  });

  // ── requestContext population ─────────────────────────────────────────────

  test('populates requestContext with method, path, ip, requestId', () => {
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({
      id: 'req-42',
      method: 'POST',
      url: '/submit',
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const reply = makeReply();

    getOnRequest()(request, reply);

    expect(request.requestContext).toMatchObject({
      requestId: 'req-42',
      method: 'POST',
      path: '/submit',
      ip: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
    });
  });

  test('does not crash when headers are empty', () => {
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ headers: {} });
    const reply = makeReply();

    expect(() => getOnRequest()(request, reply)).not.toThrow();
  });

  // ── x-correlation-id reply header ────────────────────────────────────────

  test('always sets x-correlation-id on the reply', () => {
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ headers: {} });
    const reply = makeReply();

    getOnRequest()(request, reply);

    expect(reply.header).toHaveBeenCalledWith('x-correlation-id', expect.any(String));
  });

  // ── onResponse logging ────────────────────────────────────────────────────

  test('onResponse logs structured fields: statusCode, durationMs, ip, userAgent', () => {
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ headers: { 'user-agent': 'curl/7.84' } });
    const reply = makeReply({ statusCode: 201, elapsedTime: 42.7 });

    getOnRequest()(request, reply);
    getOnResponse()(request, reply);

    expect(childLogger.info).toHaveBeenCalledWith('Request completed', {
      statusCode: 201,
      durationMs: 43,
      ip: '127.0.0.1',
      userAgent: 'curl/7.84',
    });
  });

  // ── request metrics ───────────────────────────────────────────────────────

  test('onResponse records request metrics by route pattern, status, and latency', () => {
    mockCollector.incrementRequestCount.mockClear();
    mockCollector.recordRequestLatency.mockClear();
    const { baseLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server);

    const request = makeRequest({ routeOptions: { url: '/api/tasks/:id' } });
    const reply = makeReply({ statusCode: 200, elapsedTime: 12.4 });

    getOnRequest()(request, reply);
    getOnResponse()(request, reply);

    expect(mockCollector.incrementRequestCount).toHaveBeenCalledWith('/api/tasks/:id', 200);
    expect(mockCollector.recordRequestLatency).toHaveBeenCalledWith('/api/tasks/:id', 12);
  });

  test('metrics are recorded even when log sampling suppresses the log line', () => {
    mockCollector.incrementRequestCount.mockClear();
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server, { sampleRate: 0 });

    const request = makeRequest();
    const reply = makeReply();

    getOnRequest()(request, reply);
    getOnResponse()(request, reply);

    expect(mockCollector.incrementRequestCount).toHaveBeenCalledTimes(1);
    expect(childLogger.info).not.toHaveBeenCalled();
  });

  test('excluded paths record no metrics and no log', () => {
    mockCollector.incrementRequestCount.mockClear();
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server, { excludePaths: ['/health'] });

    const request = makeRequest({ url: '/health' });
    const reply = makeReply();

    getOnRequest()(request, reply);
    getOnResponse()(request, reply);

    expect(mockCollector.incrementRequestCount).not.toHaveBeenCalled();
    expect(childLogger.info).not.toHaveBeenCalled();
  });

  test('skips onResponse logging for excludePaths', () => {
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server, { excludePaths: ['/health'] });

    const request = makeRequest({ url: '/health' });
    const reply = makeReply();

    getOnRequest()(request, reply);
    getOnResponse()(request, reply);

    expect(childLogger.info).not.toHaveBeenCalled();
  });

  // ── log sampling ─────────────────────────────────────────────────────────

  test('sampleRate: 0 suppresses all onResponse logging', () => {
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server, { sampleRate: 0 });

    const request = makeRequest();
    const reply = makeReply();

    getOnRequest()(request, reply);
    // Run 20 requests — none should log
    for (let i = 0; i < 20; i++) {
      getOnResponse()(request, reply);
    }

    expect(childLogger.info).not.toHaveBeenCalled();
  });

  test('sampleRate: 1 logs all onResponse requests', () => {
    const { baseLogger, childLogger } = createLoggerMock();
    const { server, getOnRequest, getOnResponse } = captureHooks(baseLogger);
    loggerPlugin(server, { sampleRate: 1 });

    const request = makeRequest();
    const reply = makeReply();

    getOnRequest()(request, reply);
    for (let i = 0; i < 5; i++) {
      getOnResponse()(request, reply);
    }

    expect(childLogger.info).toHaveBeenCalledTimes(5);
  });
});
