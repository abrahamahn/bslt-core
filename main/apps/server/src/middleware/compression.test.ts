// main/apps/server/src/middleware/compression.test.ts
/**
 * Content coding on node:zlib.
 *
 * Risk assessment — how this could break a response or the server:
 * 1. Negotiation: sending a coding the client refused (q=0, a malformed q), or
 *    none when it accepted one.
 * 2. Encoding twice, or encoding what must stay byte-exact (ranges, pre-encoded
 *    bodies, HEAD, 304), or answering without `Vary`, so a cache serves the
 *    encoded body to a client that cannot read it.
 * 3. A failing source stream answered twice or logged twice.
 * 4. A compressed request body escaping the body limit (a zip bomb, or encoded
 *    bytes that inflate to nothing), the decoder working on after the answer,
 *    or a corrupt or unknown coding surfacing as a server error or an
 *    unhandled stream error.
 */

import { Readable } from 'node:stream';
import {
  brotliDecompressSync,
  constants,
  deflateRawSync,
  Gunzip,
  gunzipSync,
  gzipSync,
} from 'node:zlib';

import { createHttpServer, type HttpServer, type InjectResponse } from '@bslt/server-system/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { negotiateEncoding, registerCompression } from './compression';

const BODY = 'c'.repeat(4096);

describe('negotiateEncoding', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['   ', undefined],
    ['identity', undefined],
    ['gzip;q=abc', undefined],
    ['gzip;q=', undefined],
    ['gzip;q=1.5', undefined],
    ['gzip;q=0.0001', undefined],
    ['br;q=0, gzip;q=0', undefined],
    ['*;q=0', undefined],
    ['gzip;q=0, *', undefined],
    ['zstd', undefined],
    ['deflate', undefined],
    ['zstd, deflate, compress', undefined],
    ['  GZip  ', 'gzip'],
    ['BR;Q=0.5', 'br'],
    ['x-gzip', 'gzip'],
    ['*', 'gzip'],
    ['br;q=0, *', 'gzip'],
    ['gzip, br', 'br'],
    ['br;q=0.5, gzip;q=0.5', 'br'],
    ['br;q=0.1, gzip;q=0.2', 'gzip'],
    ['br;q=0.001', 'br'],
    ['gzip;q=0, gzip;q=0.8', 'gzip'],
    ['gzip;level=9', 'gzip'],
  ])('reads %j as %s', (header, expected) => {
    expect(negotiateEncoding(header)).toBe(expected);
  });
});

describe('registerCompression', () => {
  let server: HttpServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    server = undefined;
  });

  async function compose(
    routes: (app: HttpServer) => void,
    options: { bodyLimit?: number } = {},
  ): Promise<HttpServer> {
    server = createHttpServer(options);
    registerCompression(server);
    routes(server);
    await server.ready();
    return server;
  }

  it('sets an exact Content-Length on an encoded buffer', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) => reply.type('text/plain').send(BODY)),
    );
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'br' } });
    expect(response.headers['content-encoding']).toBe('br');
    expect(response.headers['content-length']).toBe(String(response.rawPayload.length));
    expect(brotliDecompressSync(response.rawPayload).toString('utf8')).toBe(BODY);
  });

  it('runs after every other onSend hook, which sees the identity payload', async () => {
    const seen: unknown[] = [];
    const app = await compose((a) => {
      a.addHook('onSend', async (_req, _reply, payload) => {
        seen.push(payload);
        return payload;
      });
      a.get('/', (_req, reply) => reply.type('text/plain').send(BODY));
    });
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(seen).toEqual([BODY]);
  });

  it('never encodes twice', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) =>
        reply.type('text/plain').header('content-encoding', 'gzip').send(gzipSync(BODY)),
      ),
    );
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip, br' } });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(response.rawPayload).toString('utf8')).toBe(BODY);
  });

  it('encodes a body whose Content-Encoding is identity', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) =>
        reply.type('text/plain').header('content-encoding', 'identity').send(BODY),
      ),
    );
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('leaves a response that serves byte ranges alone', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) =>
        reply.type('text/plain').header('accept-ranges', 'bytes').send(BODY),
      ),
    );
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body).toBe(BODY);
  });

  it('leaves a body without a Content-Type alone', async () => {
    const app = await compose((a) => a.get('/', () => Readable.from([Buffer.from(BODY)])));
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['content-type']).toBeUndefined();
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body).toBe(BODY);
  });

  it('leaves a Vary of * alone', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) => reply.type('text/plain').header('vary', '*').send(BODY)),
    );
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers['vary']).toBe('*');
  });

  it('does not add Accept-Encoding to Vary twice', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) =>
        reply.type('text/plain').header('vary', 'accept-encoding').send(BODY),
      ),
    );
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.headers['vary']).toBe('accept-encoding');
  });

  it('leaves HEAD and 304 alone', async () => {
    const app = await compose((a) => {
      a.get('/', (_req, reply) => reply.type('text/plain').send(BODY));
      a.get('/not-modified', (_req, reply) => reply.code(304).type('text/plain').send(BODY));
    });
    const head = await app.inject({
      method: 'HEAD',
      url: '/',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(head.headers['content-encoding']).toBeUndefined();
    expect(head.headers['content-length']).toBe('4096');

    const notModified = await app.inject({
      url: '/not-modified',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers['content-encoding']).toBeUndefined();
  });

  // The encoder buffers, so the source fails before a byte was written: the
  // error handler answers instead, and that answer is not labelled gzip.
  it('answers a source stream that fails before the first byte once, as identity', async () => {
    const app = await compose((a) =>
      a.get('/', (_req, reply) =>
        reply.type('text/plain').send(
          Readable.from(
            (async function* failing() {
              yield Buffer.from(BODY);
              await Promise.resolve();
              throw new Error('source failed');
            })(),
          ),
        ),
      ),
    );
    const errors = vi.spyOn(app.log, 'error');
    const response = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.json()).toMatchObject({ message: 'source failed' });
    expect(errors).toHaveBeenCalledTimes(1);
  });

  describe('request bodies', () => {
    const echo = (a: HttpServer): void => {
      a.post('/', (request) => request.body);
    };

    it('passes an identity body through', async () => {
      const app = await compose(echo);
      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'application/json', 'content-encoding': 'identity' },
        payload: '{"a":1}',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ a: 1 });
    });

    it('refuses an unknown coding with a 415', async () => {
      const app = await compose(echo);
      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip, br' },
        payload: '{"a":1}',
      });
      expect(response.statusCode).toBe(415);
    });

    it('refuses a corrupt body with a 400', async () => {
      const app = await compose(echo);
      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
        payload: 'not brotli',
      });
      expect(response.statusCode).toBe(400);
    });

    it('treats an empty Content-Encoding as identity', async () => {
      const app = await compose(echo);
      const response = await app.inject({
        method: 'POST',
        url: '/',
        headers: { 'content-type': 'application/json', 'content-encoding': '' },
        payload: '{"a":1}',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ a: 1 });
    });

    describe('the body limit', () => {
      const LIMIT = 64 * 1024;
      const GZIP_HEADER = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]);
      /** A non-final stored block of no bytes: encoded bytes that inflate to nothing. */
      const EMPTY_BLOCK = Buffer.from([0, 0, 0, 0xff, 0xff]);

      function post(app: HttpServer, payload: Buffer | Readable): Promise<InjectResponse> {
        return app.inject({
          method: 'POST',
          url: '/',
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
          payload,
        });
      }

      it('counts the inflated bytes, and the decoder stops at the limit', async () => {
        const inflated = vi.spyOn(Gunzip.prototype, 'push');
        const app = await compose(echo, { bodyLimit: LIMIT });
        const bomb = gzipSync(Buffer.from(`{"a":"${'0'.repeat(1024 * 1024)}"}`));
        expect(bomb.length).toBeLessThan(LIMIT);
        const response = await post(app, bomb);
        expect(response.statusCode).toBe(413);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const produced = inflated.mock.calls.reduce(
          (bytes, [chunk]) => bytes + (Buffer.isBuffer(chunk) ? chunk.length : 0),
          0,
        );
        // The limit and what the decoder had buffered, not the megabyte.
        expect(produced).toBeLessThan(2 * LIMIT);
      });

      it('counts the encoded bytes of a chunked body that inflates to nothing', async () => {
        const answered: boolean[] = [];
        const app = await compose(
          (a) => {
            // The refusal leaves the request whole: its hooks still read it.
            a.addHook('onResponse', async (request) => {
              answered.push(request.raw.destroyed);
            });
            echo(a);
          },
          { bodyLimit: LIMIT },
        );
        const blocks = Buffer.concat(Array.from({ length: 1024 }, () => EMPTY_BLOCK));
        let pulled = 0;
        const body = Readable.from(
          (function* megabyte() {
            yield GZIP_HEADER;
            while (pulled < 200) {
              pulled += 1;
              yield blocks;
            }
          })(),
          { objectMode: false },
        );
        const response = await post(app, body);
        expect(response.statusCode).toBe(413);
        // 64 KiB is 13 of the 5 KiB chunks; stream buffers read a few more, not the megabyte.
        expect(pulled).toBeLessThan(40);
        expect(answered).toEqual([false]);
      });

      // This crashed the process: Fastify stopped listening at its own limit
      // check while the decoder ran on into the corrupt bytes, and their error
      // was an unhandled 'error' event (which fails the Vitest run).
      it('answers a corrupt tail past the limit with a 413 and no unhandled error', async () => {
        const app = await compose(echo, { bodyLimit: LIMIT });
        const inflatesPastTheLimit = deflateRawSync(Buffer.alloc(4 * LIMIT, 0x61), {
          finishFlush: constants.Z_SYNC_FLUSH,
        });
        const response = await post(
          app,
          Buffer.concat([GZIP_HEADER, inflatesPastTheLimit, Buffer.alloc(64, 0xff)]),
        );
        expect(response.statusCode).toBe(413);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
  });
});
