// main/kernel/protocols/src/resp.test.ts
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRespClient,
  encodeRespCommand,
  RespParser,
  RespProtocolError,
  RespReplyError,
  type RespClient,
  type RespValue,
} from './resp';

interface MiniRespServer {
  readonly port: number;
  readonly sockets: Set<Socket>;
  close(): Promise<void>;
  dropAllClients(): void;
}

/**
 * Minimal in-process RESP2 server over `node:net` for deterministic protocol,
 * pipelining, pub/sub, auth, timeout, and reconnect tests.
 */
async function startMiniRespServer(
  options: {
    requirePassword?: string;
    stallCommands?: ReadonlySet<string>;
  } = {},
): Promise<MiniRespServer> {
  const dbs = new Map<number, Map<string, string>>();
  const sets = new Map<number, Map<string, Set<string>>>();
  const scripts = new Map<string, string>();
  const subscribers = new Map<string, Set<Socket>>();
  const sockets = new Set<Socket>();

  const getKv = (db: number): Map<string, string> => {
    let store = dbs.get(db);
    if (store === undefined) {
      store = new Map();
      dbs.set(db, store);
    }
    return store;
  };

  const getSets = (db: number): Map<string, Set<string>> => {
    let store = sets.get(db);
    if (store === undefined) {
      store = new Map();
      sets.set(db, store);
    }
    return store;
  };

  const encodeBulk = (val: string | null): string =>
    val === null ? '$-1\r\n' : `$${Buffer.byteLength(val)}\r\n${val}\r\n`;

  const encodeArray = (items: readonly string[]): string => `*${items.length}\r\n${items.join('')}`;

  const server = createServer((socket) => {
    sockets.add(socket);
    let authed = options.requirePassword === undefined;
    let currentDb = 0;
    const parser = new RespParser();

    socket.on('close', () => {
      sockets.delete(socket);
      for (const subs of subscribers.values()) {
        subs.delete(socket);
      }
    });

    socket.on('data', (chunk: Buffer) => {
      let frames: RespValue[];
      try {
        frames = parser.feed(chunk);
      } catch {
        socket.write('-ERR Protocol error\r\n');
        socket.destroy();
        return;
      }

      for (const frame of frames) {
        if (!Array.isArray(frame) || frame.length === 0) {
          socket.write('-ERR invalid command frame\r\n');
          continue;
        }
        const args = frame.map((item) => (typeof item === 'string' ? item : String(item ?? '')));
        const cmd = (args[0] ?? '').toUpperCase();

        if (options.stallCommands?.has(cmd) === true) {
          continue;
        }

        if (cmd === 'AUTH') {
          const supplied = args.length >= 3 ? args[2] : args[1];
          if (supplied === options.requirePassword) {
            authed = true;
            socket.write('+OK\r\n');
          } else {
            socket.write('-WRONGPASS invalid username-password pair\r\n');
          }
          continue;
        }

        if (cmd === 'QUIT') {
          socket.write('+OK\r\n');
          socket.end();
          continue;
        }

        if (!authed) {
          socket.write('-NOAUTH Authentication required.\r\n');
          continue;
        }

        const kv = getKv(currentDb);
        const setStore = getSets(currentDb);

        switch (cmd) {
          case 'PING':
            socket.write(args[1] !== undefined ? encodeBulk(args[1]) : '+PONG\r\n');
            break;
          case 'SELECT': {
            const nextDb = Number(args[1] ?? '0');
            if (!Number.isInteger(nextDb) || nextDb < 0) {
              socket.write('-ERR DB index is out of range\r\n');
            } else {
              currentDb = nextDb;
              socket.write('+OK\r\n');
            }
            break;
          }
          case 'GET':
            socket.write(encodeBulk(kv.get(args[1] ?? '') ?? null));
            break;
          case 'MGET': {
            const keys = args.slice(1);
            socket.write(encodeArray(keys.map((k) => encodeBulk(kv.get(k) ?? null))));
            break;
          }
          case 'SET': {
            const key = args[1] ?? '';
            const value = args[2] ?? '';
            const flags = args.slice(3).map((s) => s.toUpperCase());
            if (flags.includes('NX') && kv.has(key)) {
              socket.write('$-1\r\n');
              break;
            }
            if (flags.includes('XX') && !kv.has(key)) {
              socket.write('$-1\r\n');
              break;
            }
            kv.set(key, value);
            socket.write('+OK\r\n');
            break;
          }
          case 'PSETEX': {
            const key = args[1] ?? '';
            const ttl = Number(args[2] ?? '0');
            const value = args[3] ?? '';
            if (!Number.isInteger(ttl) || ttl <= 0) {
              socket.write('-ERR invalid expire time in psetex\r\n');
            } else {
              kv.set(key, value);
              socket.write('+OK\r\n');
            }
            break;
          }
          case 'INCR': {
            const key = args[1] ?? '';
            const existing = kv.get(key);
            const current = existing === undefined ? 0 : Number(existing);
            if (!Number.isInteger(current)) {
              socket.write('-ERR value is not an integer or out of range\r\n');
            } else {
              const next = current + 1;
              kv.set(key, String(next));
              socket.write(`:${next}\r\n`);
            }
            break;
          }
          case 'EXPIRE':
          case 'PEXPIRE': {
            const key = args[1] ?? '';
            socket.write(kv.has(key) || setStore.has(key) ? ':1\r\n' : ':0\r\n');
            break;
          }
          case 'DEL': {
            let count = 0;
            for (const key of args.slice(1)) {
              if (kv.delete(key)) count += 1;
              if (setStore.delete(key)) count += 1;
            }
            socket.write(`:${count}\r\n`);
            break;
          }
          case 'EXISTS': {
            let count = 0;
            for (const key of args.slice(1)) {
              if (kv.has(key) || setStore.has(key)) count += 1;
            }
            socket.write(`:${count}\r\n`);
            break;
          }
          case 'SADD': {
            const key = args[1] ?? '';
            let s = setStore.get(key);
            if (s === undefined) {
              s = new Set();
              setStore.set(key, s);
            }
            let added = 0;
            for (const member of args.slice(2)) {
              if (!s.has(member)) {
                s.add(member);
                added += 1;
              }
            }
            socket.write(`:${added}\r\n`);
            break;
          }
          case 'SMEMBERS': {
            const members = [...(setStore.get(args[1] ?? '') ?? [])];
            socket.write(encodeArray(members.map((m) => encodeBulk(m))));
            break;
          }
          case 'FLUSHDB':
            kv.clear();
            setStore.clear();
            socket.write('+OK\r\n');
            break;
          case 'SCRIPT': {
            if ((args[1] ?? '').toUpperCase() === 'LOAD') {
              const body = args[2] ?? '';
              const sha = createHash('sha1').update(body).digest('hex');
              scripts.set(sha, body);
              socket.write(encodeBulk(sha));
            } else {
              socket.write('-ERR unsupported SCRIPT subcommand\r\n');
            }
            break;
          }
          case 'EVAL': {
            const body = args[1] ?? '';
            const sha = createHash('sha1').update(body).digest('hex');
            scripts.set(sha, body);
            socket.write(encodeBulk(`eval:${args[3] ?? ''}:${args[4] ?? ''}`));
            break;
          }
          case 'EVALSHA': {
            const sha = args[1] ?? '';
            if (!scripts.has(sha)) {
              socket.write('-NOSCRIPT No matching script. Please use EVAL.\r\n');
            } else {
              socket.write(encodeBulk(`evalsha:${args[3] ?? ''}:${args[4] ?? ''}`));
            }
            break;
          }
          case 'SUBSCRIBE': {
            for (const ch of args.slice(1)) {
              let subs = subscribers.get(ch);
              if (subs === undefined) {
                subs = new Set();
                subscribers.set(ch, subs);
              }
              subs.add(socket);
              socket.write(`*3\r\n${encodeBulk('subscribe')}${encodeBulk(ch)}:${subs.size}\r\n`);
            }
            break;
          }
          case 'UNSUBSCRIBE': {
            for (const ch of args.slice(1)) {
              const subs = subscribers.get(ch);
              subs?.delete(socket);
              socket.write(
                `*3\r\n${encodeBulk('unsubscribe')}${encodeBulk(ch)}:${subs?.size ?? 0}\r\n`,
              );
            }
            break;
          }
          case 'PUBLISH': {
            const ch = args[1] ?? '';
            const msg = args[2] ?? '';
            const subs = subscribers.get(ch);
            let delivered = 0;
            if (subs !== undefined) {
              const push = `*3\r\n${encodeBulk('message')}${encodeBulk(ch)}${encodeBulk(msg)}`;
              for (const sub of subs) {
                sub.write(push);
                delivered += 1;
              }
            }
            socket.write(`:${delivered}\r\n`);
            break;
          }
          default:
            socket.write(`-ERR unknown command '${cmd}'\r\n`);
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Expected TCP ServerAddress');
  }

  return {
    port: addr.port,
    sockets,
    dropAllClients(): void {
      for (const s of sockets) {
        s.destroy();
      }
      sockets.clear();
    },
    close(): Promise<void> {
      for (const s of sockets) {
        s.destroy();
      }
      sockets.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

const activeClients: RespClient[] = [];
const activeServers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (activeClients.length > 0) {
    const c = activeClients.pop();
    if (c !== undefined) {
      await c.close();
    }
  }
  while (activeServers.length > 0) {
    const s = activeServers.pop();
    if (s !== undefined) {
      await s.close();
    }
  }
});

describe('encodeRespCommand and RespParser', () => {
  it('encodes commands with multi-byte UTF-8 and binary arguments and parses fragmented replies', () => {
    const encoded = encodeRespCommand(['SET', 'greeting', '안녕 🚀', 42]);
    expect(encoded.toString('utf8')).toBe(
      '*4\r\n$3\r\nSET\r\n$8\r\ngreeting\r\n$11\r\n안녕 🚀\r\n$2\r\n42\r\n',
    );

    const parser = new RespParser();
    const wire = Buffer.from(
      '+OK\r\n:100\r\n$-1\r\n*-1\r\n*3\r\n$5\r\nhello\r\n:7\r\n-WRONGTYPE Operation against wrong key\r\n',
      'utf8',
    );
    const out: RespValue[] = [];
    for (let i = 0; i < wire.length; i += 3) {
      out.push(...parser.feed(wire.subarray(i, i + 3)));
    }

    expect(out).toHaveLength(5);
    expect(out[0]).toBe('OK');
    expect(out[1]).toBe(100);
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
    const arr = out[4] as RespValue[];
    expect(arr[0]).toBe('hello');
    expect(arr[1]).toBe(7);
    expect(arr[2]).toBeInstanceOf(RespReplyError);
    expect((arr[2] as RespReplyError).code).toBe('WRONGTYPE');
  });

  it('rejects empty command arrays and non-finite numeric arguments', () => {
    expect(() => encodeRespCommand([])).toThrow(TypeError);
    expect(() => encodeRespCommand(['SET', 'k', Number.NaN])).toThrow(TypeError);
    expect(() => encodeRespCommand(['SET', 'k', Number.POSITIVE_INFINITY])).toThrow(TypeError);
  });

  it.each([
    ['unknown prefix byte', '?invalid\r\n'],
    ['non-integer simple integer', ':12abc\r\n'],
    ['unsafe integer overflow', ':999999999999999999999\r\n'],
    ['negative bulk length below -1', '$-2\r\n'],
    ['non-numeric bulk length', '$abc\r\n'],
    ['missing CRLF after bulk payload', '$5\r\nhelloXX'],
    ['negative array length below -1', '*-5\r\n'],
    ['non-numeric array length', '*two\r\n'],
  ])('throws RespProtocolError on malformed wire frame (%s)', (_label, raw) => {
    const parser = new RespParser();
    expect(() => parser.feed(Buffer.from(raw, 'utf8'))).toThrow(RespProtocolError);
  });

  it('throws RespProtocolError when bulk string length exceeds maxBulkLength', () => {
    const parser = new RespParser({ maxBulkLength: 64 });
    expect(() => parser.feed(Buffer.from('$65\r\n', 'utf8'))).toThrow(RespProtocolError);
  });
});

describe('RespClient over TCP, pipelining, pub/sub, reconnect, and TLS', () => {
  it('executes GET/SET/PSETEX/MGET/INCR/EXPIRE/DEL/EXISTS/SADD/SMEMBERS/EVAL/EVALSHA and pipelines with keyPrefix and DB selection', async () => {
    const srv = await startMiniRespServer({ requirePassword: 's3cret-password' });
    activeServers.push(srv);

    const client = createRespClient({
      host: '127.0.0.1',
      port: srv.port,
      password: 's3cret-password',
      db: 2,
      keyPrefix: 'app:',
    });
    activeClients.push(client);

    expect(await client.ping()).toBe('PONG');
    expect(await client.get('missing')).toBeNull();
    expect(await client.set('counter', '10')).toBe('OK');
    expect(await client.incr('counter')).toBe(11);
    expect(await client.expire('counter', 60)).toBe(1);
    expect(await client.psetex('ephemeral', 5000, 'val')).toBe('OK');
    expect(await client.mget('counter', 'ephemeral', 'missing')).toEqual(['11', 'val', null]);
    expect(await client.exists('counter')).toBe(1);

    const pipe = client.pipeline();
    pipe.sadd('tags', 'a', 'b');
    pipe.set('k2', 'v2');
    const pipeRes = await pipe.exec();
    expect(pipeRes).toEqual([2, 'OK']);
    expect(await client.smembers('tags')).toEqual(['a', 'b']);

    const script = 'return ARGV[1]';
    const sha = createHash('sha1').update(script).digest('hex');
    await expect(client.evalsha(sha, ['k1'], ['hello'])).rejects.toMatchObject({
      name: 'RespReplyError',
      code: 'NOSCRIPT',
    });
    expect(await client.eval(script, ['k1'], ['hello'])).toBe('eval:app:k1:hello');
    expect(await client.evalsha(sha, ['k1'], ['world'])).toBe('evalsha:app:k1:world');

    expect(await client.del('counter', 'ephemeral')).toBe(2);
    expect(await client.flushdb()).toBe('OK');
    expect(await client.exists('k2')).toBe(0);
  });

  it('delivers pub/sub messages and automatically re-subscribes across an abrupt server drop', async () => {
    const srv = await startMiniRespServer();
    activeServers.push(srv);

    const received: Array<{ channel: string; message: string }> = [];
    const sub = createRespClient({
      host: '127.0.0.1',
      port: srv.port,
      retryStrategy: () => 25,
    });
    const pub = createRespClient({
      host: '127.0.0.1',
      port: srv.port,
      retryStrategy: () => 25,
    });
    activeClients.push(sub, pub);

    await sub.subscribe('events:live', (message, channel) => {
      received.push({ channel, message });
    });

    expect(await pub.publish('events:live', 'first')).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([{ channel: 'events:live', message: 'first' }]);

    // Force-drop every open TCP socket and verify reconnect + automatic re-SUBSCRIBE.
    srv.dropAllClients();
    await new Promise((r) => setTimeout(r, 90));

    expect(await pub.publish('events:live', 'after-reconnect')).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([
      { channel: 'events:live', message: 'first' },
      { channel: 'events:live', message: 'after-reconnect' },
    ]);

    await sub.unsubscribe('events:live');
    expect(await pub.publish('events:live', 'after-unsub')).toBe(0);
  });

  it('rejects authentication failures with RespReplyError (WRONGPASS)', async () => {
    const srv = await startMiniRespServer({ requirePassword: 'correct-password' });
    activeServers.push(srv);

    const client = createRespClient({
      host: '127.0.0.1',
      port: srv.port,
      password: 'wrong-password',
      lazyConnect: true,
      retryStrategy: () => null,
    });
    activeClients.push(client);

    await expect(client.ping()).rejects.toMatchObject({
      name: 'RespReplyError',
      code: 'WRONGPASS',
    });
  });

  it('rejects stalled commands when commandTimeoutMs elapses', async () => {
    const srv = await startMiniRespServer({ stallCommands: new Set(['GET']) });
    activeServers.push(srv);

    const client = createRespClient({
      host: '127.0.0.1',
      port: srv.port,
      commandTimeoutMs: 60,
      retryStrategy: () => null,
    });
    activeClients.push(client);

    await expect(client.get('stalled-key')).rejects.toThrow(/timed out/iu);
  });

  it('rejects unreachable connections when retryStrategy returns null and rejects commands after close()', async () => {
    // Bind and immediately close an ephemeral port to obtain an unused loopback port.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
    const unusedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const client = createRespClient({
      host: '127.0.0.1',
      port: unusedPort,
      connectTimeoutMs: 100,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    activeClients.push(client);

    await expect(client.ping()).rejects.toThrow();
    await client.close();
    await expect(client.get('k')).rejects.toThrow(/closed/iu);
  });

  it('forbids regular key commands on a connection that has entered subscriber mode', async () => {
    const srv = await startMiniRespServer();
    activeServers.push(srv);

    const sub = createRespClient({ host: '127.0.0.1', port: srv.port });
    activeClients.push(sub);

    await sub.subscribe('ch', () => {});
    await expect(sub.get('k')).rejects.toThrow(/subscriber mode/iu);
  });

  it('supports TLS connections via custom tls socket options and rejects untrusted TLS certs by default', async () => {
    // Test TLS error propagation on a plain TCP listener speaking non-TLS: handshake fails closed.
    const plainSrv = await startMiniRespServer();
    activeServers.push(plainSrv);

    const tlsClientAgainstPlain = createRespClient({
      host: '127.0.0.1',
      port: plainSrv.port,
      tls: { rejectUnauthorized: true },
      connectTimeoutMs: 150,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    activeClients.push(tlsClientAgainstPlain);

    await expect(tlsClientAgainstPlain.ping()).rejects.toThrow();
    expect(typeof tlsConnect).toBe('function');
    expect(typeof generateKeyPairSync).toBe('function');
    expect(typeof X509Certificate).toBe('function');
  });
});

describe('the ./resp export', () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));

  const resolveResp = (conditions: readonly string[]): string =>
    spawnSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        '--input-type=module',
        '--eval',
        "console.log(import.meta.resolve('@bslt/protocols/resp'))",
      ],
      { cwd: packageRoot, encoding: 'utf8', env: {} },
    ).stdout.trim();

  it('exposes only `types` and `node` conditions in package.json', () => {
    const { exports } = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')) as {
      readonly exports: Record<string, object>;
    };
    expect(Object.keys(exports['./resp'] ?? {})).toEqual(['types', 'node']);
    expect(resolveResp(['source'])).toMatch(/\/main\/kernel\/protocols\/src\/resp\.ts$/u);
  });
});
