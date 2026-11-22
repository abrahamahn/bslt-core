// main/apps/server/src/middleware/static.test.ts
/**
 * Local-storage file serving.
 *
 * Risk assessment — how this route could leak data:
 * 1. Serving any file under the storage root to anyone who knows (or guesses)
 *    its key: the route must demand a valid, unexpired signature.
 * 2. Accepting a signature for one key/expiry on another (replay, revival).
 * 3. Escaping the storage root through encoded `..` segments, even when the
 *    attacker somehow holds a signature over the traversal key.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpServer, type HttpServer } from '@bslt/server-system/http';
import { deriveStorageUrlKey, LocalStorageProvider, signStorageUrl } from '@bslt/storage';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseRangeHeader, registerStaticServe } from './static';

type RouteHandler = (req: unknown, reply: unknown) => Promise<unknown>;

const SECRET = 'static-serve-signing-secret-0123456789abcdef';
const OTHER_SECRET = 'another-deployment-signing-secret-0123456789';
const NOW_MS = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW_S = NOW_MS / 1000;
const SIGNING_KEY = deriveStorageUrlKey(SECRET);

interface SignOptions {
  /** Key the signature covers (defaults to the requested key). */
  signedKey?: string;
  expiresAt?: number;
  signingKey?: Buffer;
  method?: 'GET' | 'PUT';
}

/** Build `/uploads/<encoded key>?expires=..&signature=..` for an arbitrary claim. */
function signedUrl(key: string, options: SignOptions = {}): string {
  const expiresAt = options.expiresAt ?? NOW_S + 3600;
  const signature = signStorageUrl(
    { method: options.method ?? 'GET', key: options.signedKey ?? key, expiresAt },
    options.signingKey ?? SIGNING_KEY,
  );
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `/uploads/${path}?expires=${String(expiresAt)}&signature=${signature}`;
}

/** Capture the route handler registered by registerStaticServe for direct invocation. */
function captureHandler(root: string, prefix: string): RouteHandler {
  const calls: unknown[][] = [];
  const mockServer = {
    get: (...args: unknown[]): void => {
      calls.push(args);
    },
    log: { info: vi.fn(), error: vi.fn() },
  };
  registerStaticServe(mockServer as never, { root, prefix, signingSecret: SECRET });
  const handler = calls[0]?.[2];
  if (typeof handler !== 'function') throw new Error('route handler was not registered');
  return handler as RouteHandler;
}

describe('Static File Serving', () => {
  describe('registerStaticServe', () => {
    let mockServer: {
      get: ReturnType<typeof vi.fn>;
      log: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockServer = { get: vi.fn(), log: { info: vi.fn(), error: vi.fn() } };
    });

    test('registers the route under the normalized prefix', () => {
      registerStaticServe(mockServer as never, {
        root: '/uploads',
        prefix: '/files',
        signingSecret: SECRET,
      });

      expect(mockServer.get).toHaveBeenCalledWith(
        '/files/*',
        expect.objectContaining({ preHandler: expect.any(Function) }),
        expect.any(Function),
      );
    });

    test('normalizes a prefix that already ends with a slash', () => {
      registerStaticServe(mockServer as never, {
        root: '/uploads',
        prefix: '/files/',
        signingSecret: SECRET,
      });

      expect(mockServer.get).toHaveBeenCalledWith(
        '/files/*',
        expect.objectContaining({ preHandler: expect.any(Function) }),
        expect.any(Function),
      );
    });

    test('logs registration info without the signing secret', () => {
      registerStaticServe(mockServer as never, {
        root: '/var/uploads',
        prefix: '/uploads',
        signingSecret: SECRET,
      });

      expect(mockServer.log.info).toHaveBeenCalledWith(
        expect.objectContaining({ root: '/var/uploads', prefix: '/uploads/' }),
        'Static file serving registered',
      );
      expect(JSON.stringify(mockServer.log.info.mock.calls)).not.toContain(SECRET);
    });

    test.each([
      ['empty', ''],
      ['too short', 'x'.repeat(31)],
    ])('refuses to register with a %s signing secret', (_label, signingSecret) => {
      expect(() =>
        registerStaticServe(mockServer as never, {
          root: '/uploads',
          prefix: '/uploads',
          signingSecret,
        }),
      ).toThrow(/at least 32/);
      expect(mockServer.get).not.toHaveBeenCalled();
    });
  });

  // Path-safety branches, invoked directly so router URL normalization can't mask them.
  describe('path validation', () => {
    test('rejects invalid percent-encoding with 400', async () => {
      const handler = captureHandler('/uploads', '/uploads');
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await handler({ url: '/uploads/%ZZ', params: { '*': '%ZZ' }, query: {} }, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid path encoding' });
    });

    test('rejects path traversal with 403', async () => {
      const handler = captureHandler('/uploads', '/uploads');
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await handler(
        {
          url: '/uploads/../../../etc/passwd',
          params: { '*': '../../../etc/passwd' },
          query: {},
        },
        reply,
      );

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    test('rejects a request that resolves to the root itself with 403', async () => {
      const handler = captureHandler('/uploads', '/uploads');
      const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await handler({ url: '/uploads/', params: { '*': '' }, query: {} }, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  // Real HTTP over a live Fastify instance with real files. This is the contract
  // that matters: the response must COMPLETE with a body whose length matches the
  // Content-Length header. The original reused-fd handler set Content-Length but
  // streamed zero bytes, leaving the browser hanging forever — a failure mode that
  // mocked stream assertions cannot detect.
  describe('serving real files', () => {
    let app: HttpServer;
    let root: string;

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW_MS);
      root = await mkdtemp(join(tmpdir(), 'static-test-'));
      app = createHttpServer();
      registerStaticServe(app, { root, prefix: '/uploads', maxAge: 3600, signingSecret: SECRET });
      await app.ready();
    });

    afterEach(async () => {
      vi.useRealTimers();
      await app.close();
      await rm(root, { recursive: true, force: true });
    });

    test('streams the full file body with a matching Content-Length', async () => {
      const body = 'hello world '.repeat(5000); // ~60 KB, spans many read chunks
      await writeFile(join(root, 'doc.txt'), body, 'utf8');

      const res = await app.inject({ method: 'GET', url: signedUrl('doc.txt') });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(body);
      expect(res.headers['content-length']).toBe(String(Buffer.byteLength(body)));
    });

    test('marks the response private and never cacheable past the URL expiry', async () => {
      await writeFile(join(root, 'doc.txt'), 'x', 'utf8');

      const long = await app.inject({ method: 'GET', url: signedUrl('doc.txt') });
      const short = await app.inject({
        method: 'GET',
        url: signedUrl('doc.txt', { expiresAt: NOW_S + 60 }),
      });

      expect(long.headers['cache-control']).toBe('private, max-age=3600');
      expect(short.headers['cache-control']).toBe('private, max-age=60');
    });

    test('serves binary content byte-for-byte', async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
      await writeFile(join(root, 'image.png'), bytes);

      const res = await app.inject({ method: 'GET', url: signedUrl('image.png') });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.rawPayload.equals(bytes)).toBe(true);
    });

    test('serves files from nested key paths', async () => {
      await mkdir(join(root, 'files', 'user-1'), { recursive: true });
      await writeFile(join(root, 'files', 'user-1', 'a.txt'), 'nested', 'utf8');

      const res = await app.inject({ method: 'GET', url: signedUrl('files/user-1/a.txt') });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('nested');
    });

    test('serves a URL issued by LocalStorageProvider (provider/route round trip)', async () => {
      const storage = new LocalStorageProvider({
        provider: 'local',
        rootPath: root,
        publicBaseUrl: '/uploads',
        signingSecret: SECRET,
        maxFileSize: 1024 * 1024,
        allowedTypes: ['*'],
      });
      const key = await storage.upload('files/user 1/report #1.txt', 'round trip', 'text/plain');

      const res = await app.inject({ method: 'GET', url: await storage.getSignedUrl(key) });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('round trip');
    });

    test('answers HEAD for a signed URL', async () => {
      await writeFile(join(root, 'doc.txt'), 'head me', 'utf8');

      const res = await app.inject({ method: 'HEAD', url: signedUrl('doc.txt') });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-length']).toBe('7');
    });

    test('returns 404 for a missing file', async () => {
      const res = await app.inject({ method: 'GET', url: signedUrl('nope.txt') });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Not found' });
    });

    test('returns 404 when the path is a directory', async () => {
      await mkdir(join(root, 'adir'));

      const res = await app.inject({ method: 'GET', url: signedUrl('adir') });

      expect(res.statusCode).toBe(404);
    });

    test('advertises Accept-Ranges on a full response', async () => {
      await writeFile(join(root, 'clip.bin'), Buffer.alloc(1000, 7));

      const res = await app.inject({ method: 'GET', url: signedUrl('clip.bin') });

      expect(res.statusCode).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('serves a byte range as 206 Partial Content (media seeking)', async () => {
      const bytes = Buffer.from(Array.from({ length: 256 }, (_v, i) => i));
      await writeFile(join(root, 'video.bin'), bytes);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl('video.bin'),
        headers: { range: 'bytes=10-19' },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 10-19/256');
      expect(res.headers['content-length']).toBe('10');
      expect(res.rawPayload.equals(bytes.subarray(10, 20))).toBe(true);
    });

    test('serves an open-ended range to the end of the file', async () => {
      const bytes = Buffer.from(Array.from({ length: 100 }, (_v, i) => i));
      await writeFile(join(root, 'audio.bin'), bytes);

      const res = await app.inject({
        method: 'GET',
        url: signedUrl('audio.bin'),
        headers: { range: 'bytes=90-' },
      });

      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 90-99/100');
      expect(res.rawPayload.equals(bytes.subarray(90))).toBe(true);
    });

    test('answers 416 for an unsatisfiable range', async () => {
      await writeFile(join(root, 'small.bin'), Buffer.alloc(50));

      const res = await app.inject({
        method: 'GET',
        url: signedUrl('small.bin'),
        headers: { range: 'bytes=100-200' },
      });

      expect(res.statusCode).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */50');
    });

    describe('signature enforcement', () => {
      const SECRET_BODY = 'private file contents';

      beforeEach(async () => {
        await mkdir(join(root, 'files', 'user-1'), { recursive: true });
        await mkdir(join(root, 'files', 'user-2'), { recursive: true });
        await writeFile(join(root, 'files', 'user-1', 'a.txt'), 'own file', 'utf8');
        await writeFile(join(root, 'files', 'user-2', 'b.txt'), SECRET_BODY, 'utf8');
      });

      async function expectForbidden(
        url: string,
        method: 'GET' | 'HEAD' = 'GET',
        headers: Record<string, string> = {},
      ): Promise<void> {
        const res = await app.inject({ method, url, headers });
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain(SECRET_BODY);
        expect(res.headers['content-range']).toBeUndefined();
      }

      const valid = (): string => signedUrl('files/user-2/b.txt');

      test('refuses a bare, unsigned URL (the old permanent public link)', async () => {
        await expectForbidden('/uploads/files/user-2/b.txt');
      });

      test('refuses HEAD and Range requests without a signature', async () => {
        await expectForbidden('/uploads/files/user-2/b.txt', 'HEAD');
        await expectForbidden('/uploads/files/user-2/b.txt', 'GET', { range: 'bytes=0-3' });
      });

      test('refuses a URL missing its signature', async () => {
        await expectForbidden(valid().replace(/&signature=[0-9a-f]+/, ''));
      });

      test('refuses a URL missing its expiry', async () => {
        await expectForbidden(valid().replace(/expires=\d+&/, ''));
      });

      test('refuses an expired URL', async () => {
        await expectForbidden(signedUrl('files/user-2/b.txt', { expiresAt: NOW_S - 1 }));
      });

      test('refuses a URL once its expiry passes', async () => {
        const url = signedUrl('files/user-2/b.txt', { expiresAt: NOW_S + 60 });
        expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);

        vi.setSystemTime(NOW_MS + 60_000);

        await expectForbidden(url);
      });

      test('refuses a signature replayed onto another key', async () => {
        await expectForbidden(signedUrl('files/user-2/b.txt', { signedKey: 'files/user-1/a.txt' }));
      });

      test('refuses a URL whose expiry was pushed forward', async () => {
        const url = signedUrl('files/user-2/b.txt', { expiresAt: NOW_S + 60 });
        await expectForbidden(
          url.replace(`expires=${String(NOW_S + 60)}`, `expires=${String(NOW_S + 86_400)}`),
        );
      });

      test('refuses a tampered signature', async () => {
        const url = valid();
        const tampered = url.replace(
          /signature=([0-9a-f])/,
          (_m, c: string) => `signature=${c === 'a' ? 'b' : 'a'}`,
        );
        expect(tampered).not.toBe(url);
        await expectForbidden(tampered);
      });

      test('refuses a signature from another deployment secret', async () => {
        await expectForbidden(
          signedUrl('files/user-2/b.txt', { signingKey: deriveStorageUrlKey(OTHER_SECRET) }),
        );
      });

      test('refuses a PUT-bound signature on GET', async () => {
        await expectForbidden(signedUrl('files/user-2/b.txt', { method: 'PUT' }));
      });

      test('refuses duplicated signature parameters', async () => {
        const url = valid();
        const signature = /signature=([0-9a-f]+)/.exec(url)?.[1] ?? '';
        await expectForbidden(`${url}&signature=${signature}`);
      });

      test.each([
        ['encoded parent segment', '/uploads/files/%2e%2e/files/user-2/b.txt'],
        ['encoded slash smuggling a parent segment', '/uploads/files%2F..%2Fuser-2%2Fb.txt'],
        ['dot segment', '/uploads/files/./user-2/b.txt'],
        ['empty segment', '/uploads/files//user-2/b.txt'],
        ['backslash', '/uploads/files%5Cuser-2%5Cb.txt'],
        ['NUL byte', '/uploads/files/user-2/b.txt%00.png'],
      ])('refuses a %s even with a matching signature', async (_label, path) => {
        const rawKey = decodeURIComponent(path.slice('/uploads/'.length));
        const expiresAt = NOW_S + 3600;
        const signature = signStorageUrl({ method: 'GET', key: rawKey, expiresAt }, SIGNING_KEY);
        await expectForbidden(`${path}?expires=${String(expiresAt)}&signature=${signature}`);
      });

      // Killer: a correctly signed URL for a traversal key must still not escape
      // the storage root, whether or not the target exists.
      test('never serves a file outside the root, even for a signed traversal key', async () => {
        const outside = join(root, '..', `outside-${String(process.pid)}.txt`);
        await writeFile(outside, SECRET_BODY, 'utf8');
        try {
          const key = `../outside-${String(process.pid)}.txt`;
          const expiresAt = NOW_S + 3600;
          const signature = signStorageUrl({ method: 'GET', key, expiresAt }, SIGNING_KEY);
          await expectForbidden(
            `/uploads/${encodeURIComponent(key)}?expires=${String(expiresAt)}&signature=${signature}`,
          );
        } finally {
          await rm(outside, { force: true });
        }
      });
    });
  });

  describe('parseRangeHeader', () => {
    test('returns null when no Range header is present', () => {
      expect(parseRangeHeader(undefined, 1000)).toBeNull();
    });

    test('returns null for a non-bytes unit', () => {
      expect(parseRangeHeader('items=0-10', 1000)).toBeNull();
    });

    test('parses a closed range', () => {
      expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
    });

    test('clamps a closed range end to the last byte', () => {
      expect(parseRangeHeader('bytes=500-9999', 1000)).toEqual({ start: 500, end: 999 });
    });

    test('parses an open-ended range', () => {
      expect(parseRangeHeader('bytes=200-', 1000)).toEqual({ start: 200, end: 999 });
    });

    test('parses a suffix range (last N bytes)', () => {
      expect(parseRangeHeader('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    });

    test('flags a start beyond the resource size as unsatisfiable', () => {
      expect(parseRangeHeader('bytes=2000-3000', 1000)).toBe('unsatisfiable');
    });

    test('ignores multi-range requests (falls back to full body)', () => {
      expect(parseRangeHeader('bytes=0-10,20-30', 1000)).toBeNull();
    });
  });
});
