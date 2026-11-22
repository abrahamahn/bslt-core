// main/apps/server/src/plugin/errors.test.ts

import { NotFoundError, type ErrorTracker } from '@bslt/contract';
import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { describe, expect, test, vi } from 'vitest';

import { errorHandlerPlugin } from './errors';

function buildServer(errorTracker?: ErrorTracker): HttpServer {
  const server = createHttpServer();
  void server.register(errorHandlerPlugin, {
    isProduction: false,
    ...(errorTracker !== undefined ? { errorTracker } : {}),
  });
  server.get('/boom', async () => {
    throw new Error('boom');
  });
  server.get('/missing', async () => {
    throw new NotFoundError('nope');
  });
  return server;
}

describe('errorHandlerPlugin', () => {
  test('reports 5xx errors to the error tracker with request context', async () => {
    const captureError = vi.fn();
    const server = buildServer({ captureError } as unknown as ErrorTracker);
    await server.ready();

    const res = await server.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]?.[1]).toMatchObject({
      statusCode: 500,
      method: 'GET',
      url: '/boom',
    });
    await server.close();
  });

  test('reports and logs the path without its query string, which can carry tokens', async () => {
    const captureError = vi.fn();
    const server = buildServer({ captureError } as unknown as ErrorTracker);
    const logged: unknown[] = [];
    server.addHook('onRequest', async (request) => {
      vi.spyOn(request.log, 'error').mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    });
    await server.ready();

    const res = await server.inject({ method: 'GET', url: '/boom?token=secret-reset-token' });

    expect(res.statusCode).toBe(500);
    expect(captureError.mock.calls[0]?.[1]).toMatchObject({ url: '/boom' });
    expect(JSON.stringify(logged)).not.toContain('secret-reset-token');
    await server.close();
  });

  test('does not report client (4xx) errors', async () => {
    const captureError = vi.fn();
    const server = buildServer({ captureError } as unknown as ErrorTracker);
    await server.ready();

    const res = await server.inject({ method: 'GET', url: '/missing' });

    expect(res.statusCode).toBe(404);
    expect(captureError).not.toHaveBeenCalled();
    await server.close();
  });

  test('handles a 5xx without an error tracker configured', async () => {
    const server = buildServer(undefined);
    await server.ready();

    const res = await server.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    await server.close();
  });

  // Fastify rejects some requests itself, before any handler runs, with errors
  // that carry a 4xx status. The handler treated every error that is not an
  // AppError as an internal one: an oversized upload or a malformed JSON body
  // was a 500, and was reported to the error tracker as a server fault.
  describe("HTTP framework's own request errors", () => {
    function buildParsingServer(captureError: ErrorTracker['captureError']): HttpServer {
      const server = createHttpServer({ bodyLimit: 64 });
      void server.register(errorHandlerPlugin, {
        isProduction: true,
        errorTracker: { captureError } as unknown as ErrorTracker,
      });
      server.post('/echo', async (request) => ({ body: request.body }));
      return server;
    }

    test('a body over the limit is 413, not 500, and is not reported', async () => {
      const captureError = vi.fn();
      const server = buildParsingServer(captureError);

      const res = await server.inject({
        method: 'POST',
        url: '/echo',
        payload: { text: 'x'.repeat(500) },
      });

      expect(res.statusCode).toBe(413);
      expect(res.json()).toMatchObject({ code: 'system.validation', kind: 'validation' });
      expect(captureError).not.toHaveBeenCalled();
      await server.close();
    });

    test('a malformed JSON body is 400, not 500', async () => {
      const captureError = vi.fn();
      const server = buildParsingServer(captureError);

      const res = await server.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{"broken": ',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'system.validation', kind: 'validation' });
      expect(captureError).not.toHaveBeenCalled();
      await server.close();
    });

    test('an unsupported content type is 415, not 500', async () => {
      const captureError = vi.fn();
      const server = buildParsingServer(captureError);

      const res = await server.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'content-type': 'application/x-unknown' },
        payload: 'data',
      });

      expect(res.statusCode).toBe(415);
      expect(captureError).not.toHaveBeenCalled();
      await server.close();
    });

    test('a JSON-schema failure is the typed schema error, 422 with its issues', async () => {
      const captureError = vi.fn();
      const server = buildParsingServer(captureError);
      server.post(
        '/typed',
        {
          schema: {
            body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
          },
        },
        async () => ({ ok: true }),
      );

      const res = await server.inject({ method: 'POST', url: '/typed', payload: {} });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ code: 'system.validation', kind: 'validation' });
      expect((res.json() as { details: { issues: unknown[] } }).details.issues).toHaveLength(1);
      expect(captureError).not.toHaveBeenCalled();
      await server.close();
    });

    test('a 5xx raised by the framework is still an internal error', async () => {
      const captureError = vi.fn();
      const server = buildParsingServer(captureError);
      server.get('/framework-boom', async () => {
        throw Object.assign(new Error('reply already sent'), {
          code: 'HTTP_ERR_REP_ALREADY_SENT',
          statusCode: 500,
        });
      });

      const res = await server.inject({ method: 'GET', url: '/framework-boom' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ kind: 'internal', message: 'Internal server error' });
      expect(captureError).toHaveBeenCalledTimes(1);
      await server.close();
    });

    test('an application error that merely carries a 4xx statusCode is not trusted', async () => {
      const captureError = vi.fn();
      const server = buildParsingServer(captureError);
      server.get('/lib-error', async () => {
        throw Object.assign(new Error('secret internals'), { statusCode: 404 });
      });

      const res = await server.inject({ method: 'GET', url: '/lib-error' });

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain('secret internals');
      await server.close();
    });
  });
});
