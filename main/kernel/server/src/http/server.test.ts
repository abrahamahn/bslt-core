// main/kernel/server/src/http/server.test.ts
import http from 'node:http';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../logger';

import { createHttpServer, httpErrorCodes, type HttpServer } from './server';

describe('createHttpServer (owned node:http router & lifecycle)', () => {
  let server: HttpServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
  });

  it('returns 404 for unmatched paths and unregistered methods on matched paths', async () => {
    server = createHttpServer();
    server.get('/items', () => ({ items: [] }));
    await server.ready();

    const missing = await server.inject({ method: 'GET', url: '/unknown' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });

    const wrongMethod = await server.inject({ method: 'DELETE', url: '/items' });
    expect(wrongMethod.statusCode).toBe(404);
  });

  it('rejects malformed percent-encoding in route parameters with 400 HTTP_ERR_BAD_URL', async () => {
    server = createHttpServer();
    let seenError: unknown;
    server.setErrorHandler((err, _req, reply) => {
      seenError = err;
      reply.status(400).send({ code: (err as { code?: string }).code, message: err.message });
    });
    server.get('/users/:id', (req) => ({ id: (req.params as { id: string }).id }));
    await server.ready();

    const res = await server.inject({ method: 'GET', url: '/users/%E0%A4%A' });
    expect(res.statusCode).toBe(400);
    expect(seenError).toBeInstanceOf(httpErrorCodes.BAD_URL);
    expect(res.json()).toMatchObject({ code: 'HTTP_ERR_BAD_URL' });
  });

  it('enforces server and per-route bodyLimit with 413 HTTP_ERR_BODY_TOO_LARGE and stops reading streams', async () => {
    server = createHttpServer({ bodyLimit: 64 });
    server.post('/default-limit', (req) => ({ body: req.body }));
    server.post('/tiny-limit', { bodyLimit: 16 }, (req) => ({ body: req.body }));
    await server.ready();

    const overDefault = await server.inject({
      method: 'POST',
      url: '/default-limit',
      payload: { text: 'x'.repeat(200) },
    });
    expect(overDefault.statusCode).toBe(413);

    let pulledChunks = 0;
    const hugeStream = Readable.from(
      (function* chunks() {
        while (pulledChunks < 100) {
          pulledChunks += 1;
          yield Buffer.from('0123456789');
        }
      })(),
      { objectMode: false },
    );

    const overRoute = await server.inject({
      method: 'POST',
      url: '/tiny-limit',
      headers: { 'content-type': 'text/plain' },
      payload: hugeStream,
    });
    expect(overRoute.statusCode).toBe(413);
    expect(pulledChunks).toBeLessThan(20);
  });

  it('rejects malformed or empty JSON bodies with 400 HTTP_ERR_INVALID_JSON_BODY', async () => {
    server = createHttpServer();
    server.post('/echo', (req) => ({ body: req.body }));
    await server.ready();

    const malformed = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(malformed.statusCode).toBe(400);

    const emptyJson = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(emptyJson.statusCode).toBe(400);
  });

  it('rejects unsupported Content-Type headers with 415 HTTP_ERR_INVALID_MEDIA_TYPE', async () => {
    server = createHttpServer();
    server.post('/echo', (req) => ({ body: req.body }));
    await server.ready();

    const unsupported = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-proprietary-binary' },
      payload: 'abc',
    });
    expect(unsupported.statusCode).toBe(415);
  });

  it('validates route JSON schemas and attaches structured validation issues on failure', async () => {
    server = createHttpServer();
    let validationIssues: unknown[] | undefined;
    server.setErrorHandler((err, _req, reply) => {
      const candidate = (err as { validation?: unknown[] }).validation;
      if (Array.isArray(candidate)) {
        validationIssues = candidate;
        reply.status(422).send({ issues: candidate });
        return;
      }
      reply.status(500).send({ error: err.message });
    });

    server.post(
      '/typed',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 2 },
              count: { type: 'number', minimum: 1 },
            },
          },
        },
      },
      (req) => ({ ok: true, body: req.body }),
    );
    await server.ready();

    const missingField = await server.inject({
      method: 'POST',
      url: '/typed',
      payload: {},
    });
    expect(missingField.statusCode).toBe(422);
    expect(validationIssues).toBeDefined();
    expect(validationIssues?.length).toBeGreaterThanOrEqual(1);

    const valid = await server.inject({
      method: 'POST',
      url: '/typed',
      payload: { name: 'Ada', count: 3 },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ ok: true, body: { name: 'Ada', count: 3 } });
  });

  it('short-circuits lifecycle when onRequest or preHandler sends a reply', async () => {
    server = createHttpServer();
    const handlerSpy = vi.fn(() => ({ reached: true }));

    server.addHook('onRequest', (req, reply, done) => {
      if (req.headers['x-deny'] === '1') {
        void reply.status(403).send({ denied: 'onRequest' });
        return;
      }
      done();
    });

    server.post(
      '/guarded',
      {
        preHandler: async (req, reply) => {
          if (req.headers['x-deny'] === '2') {
            await reply.status(401).send({ denied: 'preHandler' });
          }
        },
      },
      handlerSpy,
    );
    await server.ready();

    const deniedEarly = await server.inject({
      method: 'POST',
      url: '/guarded',
      headers: { 'x-deny': '1' },
      payload: {},
    });
    expect(deniedEarly.statusCode).toBe(403);
    expect(deniedEarly.json()).toEqual({ denied: 'onRequest' });

    const deniedPreHandler = await server.inject({
      method: 'POST',
      url: '/guarded',
      headers: { 'x-deny': '2' },
      payload: {},
    });
    expect(deniedPreHandler.statusCode).toBe(401);
    expect(deniedPreHandler.json()).toEqual({ denied: 'preHandler' });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('catches failing Readable streams before headers flush and routes once through error handler', async () => {
    server = createHttpServer();
    const errorSpy = vi.spyOn(server.log, 'error');

    server.get('/broken-stream', (_req, reply) =>
      reply.type('text/plain').send(
        Readable.from(
          (async function* broken() {
            yield Buffer.from('partial');
            await Promise.resolve();
            throw new Error('stream exploded');
          })(),
        ),
      ),
    );
    await server.ready();

    const res = await server.inject({ method: 'GET', url: '/broken-stream' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ message: 'stream exploded' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts stalled sockets when requestTimeout expires over real HTTP', async () => {
    server = createHttpServer({ requestTimeout: 80 });
    server.post('/slow', async (req) => ({ body: req.body }));
    await server.ready();
    await server.listen({ port: 0, host: '127.0.0.1' });

    const addr = server.server.address();
    if (addr === null || typeof addr === 'string') throw new Error('Expected TCP address');

    const outcome = await new Promise<'timeout-status' | 'socket-closed'>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: addr.port,
          method: 'POST',
          path: '/slow',
          headers: {
            'content-type': 'application/json',
            'content-length': '100',
          },
        },
        (res) => {
          res.resume();
          if (res.statusCode === 408) {
            resolve('timeout-status');
          } else {
            reject(new Error(`Unexpected status ${String(res.statusCode)}`));
          }
        },
      );
      req.on('error', () => {
        resolve('socket-closed');
      });
      // Write only partial body and stall past requestTimeout.
      req.write('{"partial":');
    });

    expect(['timeout-status', 'socket-closed']).toContain(outcome);
  });

  it('matches radix static > :param > * routes, auto-serves HEAD for GET, and parses repeated query params', async () => {
    server = createHttpServer({ trustProxy: true });
    server.get('/files/special', (req) => ({ matched: 'static', ip: req.ip, query: req.query }));
    server.get('/files/:id', (req) => ({ matched: 'param', params: req.params }));
    server.get('/files/*', (req) => ({ matched: 'wildcard', params: req.params }));
    await server.ready();

    expect(server.hasRoute({ method: 'GET', url: '/files/special' })).toBe(true);
    expect(server.hasRoute({ method: 'HEAD', url: '/files/special' })).toBe(true);
    expect(server.hasRoute({ method: 'POST', url: '/files/special' })).toBe(false);
    expect(server.printRoutes()).toContain('files');

    const staticRes = await server.inject({
      method: 'GET',
      url: '/files/special?tag=a&tag=b&single=1',
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(staticRes.statusCode).toBe(200);
    expect(staticRes.json()).toEqual({
      matched: 'static',
      ip: '203.0.113.9',
      query: { tag: ['a', 'b'], single: '1' },
    });

    const headRes = await server.inject({ method: 'HEAD', url: '/files/special?single=1' });
    expect(headRes.statusCode).toBe(200);
    expect(headRes.body).toBe('');
    expect(Number(headRes.headers['content-length'])).toBeGreaterThan(0);

    const paramRes = await server.inject({ method: 'GET', url: '/files/hello%20world' });
    expect(paramRes.json()).toEqual({ matched: 'param', params: { id: 'hello world' } });

    const wildRes = await server.inject({ method: 'GET', url: '/files/a/b/c.txt' });
    expect(wildRes.json()).toEqual({ matched: 'wildcard', params: { '*': 'a/b/c.txt' } });
  });

  it('runs server and route hooks in order, supports plugins/decorators, and drains cleanly on close', async () => {
    const order: string[] = [];
    const log = createLogger('silent', { service: 'test' });
    server = createHttpServer({ loggerInstance: log, disableRequestLogging: true });

    server.decorate('tag', 'v1');
    server.decorateRequest('customReq', '');
    server.decorateReply(
      'customSend',
      function (this: { send: (v: unknown) => unknown }, v: string) {
        return this.send({ wrapped: v });
      },
    );

    server.addHook('onRoute', (route) => {
      const prevOnSend = route.onSend;
      const rest =
        prevOnSend === undefined ? [] : Array.isArray(prevOnSend) ? prevOnSend : [prevOnSend];
      route.onSend = [
        ...rest,
        async (_req, _reply, payload) => {
          order.push('route:onSend');
          return payload;
        },
      ];
    });

    server.addHook('onRequest', async () => {
      order.push('server:onRequest');
    });
    server.addHook('preParsing', (_req, _reply, payload, done) => {
      order.push('server:preParsing');
      done(null, payload);
    });
    server.addHook('preHandler', async () => {
      order.push('server:preHandler');
    });
    server.addHook('onSend', async (_req, _reply, payload) => {
      order.push('server:onSend');
      return payload;
    });
    server.addHook('onResponse', async () => {
      order.push('server:onResponse');
    });
    server.addHook('onClose', (_instance, done) => {
      order.push('server:onClose');
      done();
    });

    void server.register((instance, _opts, done) => {
      instance.post('/plug', (req, reply) => {
        order.push('handler');
        const customReply = reply as unknown as { customSend: (v: string) => unknown };
        return customReply.customSend(String((req.body as { x: string }).x));
      });
      done();
    });

    await server.after();
    await server.ready();

    const res = await server.inject({
      method: 'POST',
      url: '/plug',
      payload: { x: 'hi' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ wrapped: 'hi' });
    expect(order).toEqual([
      'server:onRequest',
      'server:preParsing',
      'server:preHandler',
      'handler',
      'server:onSend',
      'route:onSend',
      'server:onResponse',
    ]);

    await server.close();
    expect(order).toContain('server:onClose');
    server = undefined;
  });

  it('supports synchronous 2-arg route preHandlers, global preHandlers before 404, and prefix-tree printRoutes()', async () => {
    server = createHttpServer();
    server.addHook('preHandler', (req, reply) => {
      if (req.method === 'DELETE') {
        reply.status(403).send({ error: 'Forbidden' });
      }
    });
    server.get(
      '/api/files/uploads/create',
      {
        preHandler: (_req, _reply) => {
          // Synchronous 2-arg preHandler must not hang waiting for done()
        },
      },
      () => ({ ok: true }),
    );
    await server.ready();

    const okRes = await server.inject({ method: 'GET', url: '/api/files/uploads/create' });
    expect(okRes.statusCode).toBe(200);

    const blocked404 = await server.inject({ method: 'DELETE', url: '/nonexistent' });
    expect(blocked404.statusCode).toBe(403);

    const tree = server.printRoutes();
    expect(tree).toContain('/api');
    expect(tree).toContain('uploads');
    expect(tree).not.toContain('/uploads');
  });

  it('binds per-route :param names across shared prefixes and evicts keep-alive sockets before close() resolves', async () => {
    server = createHttpServer();
    server.get('/api/admin/tenants/:tenantId', (req) => ({ params: req.params }));
    server.post('/api/admin/tenants/:orgId/entitlements', (req) => ({ params: req.params }));
    server.put('/api/admin/tenants/:tenantId/feature-overrides/:key', (req) => ({
      params: req.params,
    }));

    const baseUrl = await server.listen({ port: 0, host: '127.0.0.1' });
    const port = Number(new URL(baseUrl).port);

    const r1 = await server.inject({ method: 'GET', url: '/api/admin/tenants/t-1' });
    expect(r1.json()).toEqual({ params: { tenantId: 't-1' } });

    const r2 = await server.inject({
      method: 'POST',
      url: '/api/admin/tenants/org-99/entitlements',
    });
    expect(r2.json()).toEqual({ params: { orgId: 'org-99' } });

    const r3 = await server.inject({
      method: 'PUT',
      url: '/api/admin/tenants/t-2/feature-overrides/flags.beta',
    });
    expect(r3.json()).toEqual({ params: { tenantId: 't-2', key: 'flags.beta' } });

    // Exercise real keep-alive http.globalAgent socket, close, and assert ECONNREFUSED immediately
    const httpMod = await import('node:http');
    await new Promise<void>((resolve, reject) => {
      const req = httpMod.get(
        { host: '127.0.0.1', port, path: '/api/admin/tenants/t-1' },
        (res) => {
          res.resume();
          res.once('end', () => resolve());
        },
      );
      req.once('error', reject);
    });

    await server.close();
    server = undefined;

    await expect(
      new Promise<number>((resolve, reject) => {
        const req = httpMod.get(
          { host: '127.0.0.1', port, path: '/api/admin/tenants/t-1' },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.once('error', reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/u);
  });
});
