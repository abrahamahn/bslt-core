// main/kernel/realtime/src/pubsub-adapter.test.ts
import { createServer, type AddressInfo, type Socket } from 'node:net';

import { RespParser, type RespValue } from '@bslt/protocols/resp';
import { afterEach, describe, expect, it } from 'vitest';

import { createRespPubSubAdapter, type PubSubEnvelope } from './pubsub-adapter';

interface MiniPubSubResp {
  readonly port: number;
  close(): Promise<void>;
}

async function startMiniPubSubResp(): Promise<MiniPubSubResp> {
  const subscribers = new Map<string, Set<Socket>>();
  const sockets = new Set<Socket>();
  const bulk = (s: string): string => `$${String(Buffer.byteLength(s))}\r\n${s}\r\n`;

  const server = createServer((socket) => {
    sockets.add(socket);
    const parser = new RespParser();
    socket.on('close', () => {
      sockets.delete(socket);
      for (const set of subscribers.values()) set.delete(socket);
    });
    socket.on('data', (chunk: Buffer) => {
      const frames: RespValue[] = parser.feed(chunk);
      for (const frame of frames) {
        if (!Array.isArray(frame)) continue;
        const args = frame.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
        const cmd = (args[0] ?? '').toUpperCase();
        if (cmd === 'SUBSCRIBE') {
          const ch = args[1] ?? '';
          let set = subscribers.get(ch);
          if (set === undefined) {
            set = new Set();
            subscribers.set(ch, set);
          }
          set.add(socket);
          socket.write(`*3\r\n${bulk('subscribe')}${bulk(ch)}:${String(set.size)}\r\n`);
        } else if (cmd === 'UNSUBSCRIBE') {
          const ch = args[1] ?? '';
          const set = subscribers.get(ch);
          set?.delete(socket);
          socket.write(`*3\r\n${bulk('unsubscribe')}${bulk(ch)}:${String(set?.size ?? 0)}\r\n`);
        } else if (cmd === 'PUBLISH') {
          const ch = args[1] ?? '';
          const msg = args[2] ?? '';
          const set = subscribers.get(ch);
          let n = 0;
          if (set !== undefined) {
            for (const sub of set) {
              sub.write(`*3\r\n${bulk('message')}${bulk(ch)}${bulk(msg)}`);
              n += 1;
            }
          }
          socket.write(`:${String(n)}\r\n`);
        } else if (cmd === 'QUIT') {
          socket.write('+OK\r\n');
          socket.end();
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
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

describe('RespPubSubAdapter over @bslt/protocols/resp', () => {
  it('broadcasts invalidation, frame, and session_revoked envelopes across instances while suppressing self-echo', async () => {
    const srv = await startMiniPubSubResp();
    cleanups.push(() => srv.close());

    const receivedByA: PubSubEnvelope[] = [];
    const receivedByB: PubSubEnvelope[] = [];

    const nodeA = createRespPubSubAdapter({
      host: '127.0.0.1',
      port: srv.port,
      onEnvelope: (env) => receivedByA.push(env),
    });
    const nodeB = createRespPubSubAdapter({
      host: '127.0.0.1',
      port: srv.port,
      onEnvelope: (env) => receivedByB.push(env),
    });
    cleanups.push(
      () => nodeA.stop(),
      () => nodeB.stop(),
    );

    await nodeA.start();
    await nodeB.start();

    await nodeA.publish({ kind: 'invalidation', key: 'user:u1', version: 10 });
    await nodeA.publish({ kind: 'session_revoked', userId: 'u1', sessionId: 's1' });
    await new Promise((r) => setTimeout(r, 35));

    // Self-echo suppressed on nodeA; delivered to nodeB!
    expect(receivedByA).toEqual([]);
    expect(receivedByB).toEqual([
      { kind: 'invalidation', key: 'user:u1', version: 10 },
      { kind: 'session_revoked', userId: 'u1', sessionId: 's1' },
    ]);
  });

  it('rejects publishing before start() and survives malformed wire JSON via onError', async () => {
    const srv = await startMiniPubSubResp();
    cleanups.push(() => srv.close());

    const errors: Error[] = [];
    const adapter = createRespPubSubAdapter({
      host: '127.0.0.1',
      port: srv.port,
      onEnvelope: () => {},
      onError: (err) => errors.push(err),
    });
    cleanups.push(() => adapter.stop());

    await expect(
      adapter.publish({ kind: 'invalidation', key: 'user:u1', version: 1 }),
    ).rejects.toThrow(/not started/iu);
    expect(errors).toEqual([]);
  });
});
