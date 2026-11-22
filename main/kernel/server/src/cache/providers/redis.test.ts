// main/kernel/server/src/cache/providers/redis.test.ts
import { createServer, type AddressInfo, type Socket } from 'node:net';

import { RespParser, type RespValue } from '@bslt/protocols/resp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheDeserializationError, CacheSerializationError } from '../errors';

import { createRedisProvider, RedisCacheProvider } from './redis';

interface LoopbackResp {
  readonly port: number;
  readonly kv: Map<string, string>;
  close(): Promise<void>;
}

async function startLoopbackResp(): Promise<LoopbackResp> {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
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
        switch (cmd) {
          case 'PING':
            socket.write('+PONG\r\n');
            break;
          case 'QUIT':
            socket.write('+OK\r\n');
            socket.end();
            break;
          case 'GET':
            socket.write(bulk(kv.get(args[1] ?? '') ?? null));
            break;
          case 'MGET':
            socket.write(
              `*${String(args.length - 1)}\r\n${args
                .slice(1)
                .map((k) => bulk(kv.get(k) ?? null))
                .join('')}`,
            );
            break;
          case 'SET':
          case 'PSETEX': {
            const key = args[1] ?? '';
            const val = cmd === 'PSETEX' ? (args[3] ?? '') : (args[2] ?? '');
            kv.set(key, val);
            socket.write('+OK\r\n');
            break;
          }
          case 'EXISTS':
            socket.write(`:${kv.has(args[1] ?? '') ? '1' : '0'}\r\n`);
            break;
          case 'DEL': {
            let removed = 0;
            for (const k of args.slice(1)) {
              if (kv.delete(k)) removed += 1;
              if (sets.delete(k)) removed += 1;
            }
            socket.write(`:${String(removed)}\r\n`);
            break;
          }
          case 'SADD': {
            const key = args[1] ?? '';
            let s = sets.get(key);
            if (s === undefined) {
              s = new Set();
              sets.set(key, s);
            }
            let added = 0;
            for (const m of args.slice(2)) {
              if (!s.has(m)) {
                s.add(m);
                added += 1;
              }
            }
            socket.write(`:${String(added)}\r\n`);
            break;
          }
          case 'SMEMBERS': {
            const members = [...(sets.get(args[1] ?? '') ?? [])];
            socket.write(`*${String(members.length)}\r\n${members.map((m) => bulk(m)).join('')}`);
            break;
          }
          case 'FLUSHDB':
            kv.clear();
            sets.clear();
            socket.write('+OK\r\n');
            break;
          default:
            socket.write('+OK\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    kv,
    close(): Promise<void> {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const providers: RedisCacheProvider[] = [];
const servers: LoopbackResp[] = [];

afterEach(async () => {
  while (providers.length > 0) {
    const p = providers.pop();
    if (p !== undefined) await p.close();
  }
  while (servers.length > 0) {
    const s = servers.pop();
    if (s !== undefined) await s.close();
  }
});

describe('RedisCacheProvider over @bslt/protocols/resp', () => {
  it('sets, gets, checks existence, invalidates by tag, bulk-loads, and reports health', async () => {
    const srv = await startLoopbackResp();
    servers.push(srv);

    const onEviction = vi.fn();
    const cache = createRedisProvider(
      {
        provider: 'redis',
        host: '127.0.0.1',
        port: srv.port,
        keyPrefix: 'cache',
        defaultTtl: 10_000,
      },
      { onEviction },
    );
    providers.push(cache);

    expect(await cache.healthCheck()).toBe(true);
    await cache.set('user:1', { name: 'Ada' }, { tags: ['users'] });
    expect(await cache.has('user:1')).toBe(true);
    expect(await cache.get<{ name: string }>('user:1')).toEqual({ name: 'Ada' });

    const entries = new Map<string, number>([
      ['k1', 1],
      ['k2', 2],
    ]);
    await cache.setMultiple(entries);
    const loaded = await cache.getMultiple<number>(['k1', 'k2', 'k3']);
    expect([...loaded.entries()]).toEqual([
      ['k1', 1],
      ['k2', 2],
    ]);

    expect(await cache.delete('users', { byTag: true })).toBe(true);
    expect(onEviction).toHaveBeenCalledWith('user:1', 'manual');
    expect(await cache.get('user:1')).toBeUndefined();

    await cache.clear();
    expect(await cache.has('k1')).toBe(false);
  });

  it('throws CacheDeserializationError when stored JSON is corrupted', async () => {
    const srv = await startLoopbackResp();
    servers.push(srv);
    srv.kv.set('corrupt', '{not-json');

    const cache = createRedisProvider({
      provider: 'redis',
      host: '127.0.0.1',
      port: srv.port,
    });
    providers.push(cache);

    await expect(cache.get('corrupt')).rejects.toBeInstanceOf(CacheDeserializationError);
  });

  it('throws CacheSerializationError when attempting to cache circular structures', async () => {
    const srv = await startLoopbackResp();
    servers.push(srv);

    const cache = createRedisProvider({
      provider: 'redis',
      host: '127.0.0.1',
      port: srv.port,
    });
    providers.push(cache);

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await expect(cache.set('bad', circular)).rejects.toBeInstanceOf(CacheSerializationError);
  });

  it('returns false on missing deletes, missing tag deletes, and unreachable healthCheck', async () => {
    const srv = await startLoopbackResp();
    const port = srv.port;
    const cache = createRedisProvider({
      provider: 'redis',
      host: '127.0.0.1',
      port,
      connectTimeout: 80,
      commandTimeout: 80,
    });
    providers.push(cache);

    expect(await cache.delete('nonexistent')).toBe(false);
    expect(await cache.delete('empty-tag', { byTag: true })).toBe(false);
    expect(await cache.deleteMultiple([])).toBe(0);

    await srv.close();
    expect(await cache.healthCheck()).toBe(false);
    expect(await cache.get('any')).toBeUndefined();
  });
});
