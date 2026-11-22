// main/kernel/server/src/security/rate-limit.test.ts
import { createServer, type AddressInfo, type Socket } from 'node:net';

import { RespParser, type RespValue } from '@bslt/protocols/resp';
import { afterEach, describe, expect, it } from 'vitest';

import { createRateLimiter, RedisRateLimitStore } from './rate-limit';

interface LoopbackResp {
  readonly port: number;
  readonly kv: Map<string, string>;
  close(): Promise<void>;
}

async function startLoopbackResp(): Promise<LoopbackResp> {
  const kv = new Map<string, string>();
  const sockets = new Set<Socket>();

  const bulk = (v: string | null): string =>
    v === null ? '$-1\r\n' : `$${String(Buffer.byteLength(v))}\r\n${v}\r\n`;

  const server = createServer((socket) => {
    sockets.add(socket);
    const parser = new RespParser();
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', (chunk: Buffer) => {
      const frames: RespValue[] = parser.feed(chunk);
      for (const frame of frames) {
        if (!Array.isArray(frame)) continue;
        const args = frame.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
        const cmd = (args[0] ?? '').toUpperCase();
        if (cmd === 'GET') {
          socket.write(bulk(kv.get(args[1] ?? '') ?? null));
        } else if (cmd === 'PSETEX') {
          kv.set(args[1] ?? '', args[3] ?? '');
          socket.write('+OK\r\n');
        } else if (cmd === 'DEL') {
          const ok = kv.delete(args[1] ?? '');
          socket.write(`:${ok ? '1' : '0'}\r\n`);
        } else if (cmd === 'QUIT') {
          socket.write('+OK\r\n');
          socket.end();
        } else {
          socket.write('+OK\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    kv,
    close(): Promise<void> {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn !== undefined) await fn();
  }
});

describe('RedisRateLimitStore and RateLimiter over @bslt/protocols/resp', () => {
  it('enforces token bucket limits, blocks excess requests with progressive delay, and resets', async () => {
    const srv = await startLoopbackResp();
    cleanups.push(() => srv.close());

    const store = new RedisRateLimitStore({
      host: '127.0.0.1',
      port: srv.port,
      keyPrefix: 'rl',
      recordTtlMs: 60_000,
    });
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      store,
      progressiveDelay: {
        enabled: true,
        baseDelay: 500,
        maxDelay: 5000,
        backoffFactor: 2,
      },
    });
    cleanups.push(() => limiter.destroy());

    expect((await limiter.check('ip-1')).allowed).toBe(true);
    expect((await limiter.check('ip-1')).allowed).toBe(true);

    const firstBlock = await limiter.check('ip-1');
    expect(firstBlock.allowed).toBe(false);
    expect(firstBlock.violations).toBe(1);

    const secondBlock = await limiter.check('ip-1');
    expect(secondBlock.allowed).toBe(false);
    expect(secondBlock.violations).toBe(2);
    expect(secondBlock.delayMs).toBe(500);

    await limiter.reset('ip-1');
    expect((await limiter.check('ip-1')).allowed).toBe(true);
  });

  it('treats malformed or incomplete JSON records in Redis as undefined instead of crashing', async () => {
    const srv = await startLoopbackResp();
    cleanups.push(() => srv.close());

    srv.kv.set('rl:broken-json', '{bad');
    srv.kv.set('rl:partial-json', JSON.stringify({ tokens: 'nan' }));

    const store = new RedisRateLimitStore({
      host: '127.0.0.1',
      port: srv.port,
      keyPrefix: 'rl',
      recordTtlMs: 60_000,
    });
    cleanups.push(() => store.destroy());

    expect(await store.get('broken-json')).toBeUndefined();
    expect(await store.get('partial-json')).toBeUndefined();
  });

  it('ignores non-whitelisted role strings instead of allowing arbitrary role Limit injection', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      roleLimits: {
        superadmin_injected: { max: 9999, windowMs: 60_000 },
      },
    });
    cleanups.push(() => limiter.destroy());

    expect((await limiter.check('ip-2', 'superadmin_injected')).allowed).toBe(true);
    expect((await limiter.check('ip-2', 'superadmin_injected')).allowed).toBe(false);
  });
});
