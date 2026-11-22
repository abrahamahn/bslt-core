// main/kernel/db/src/client.integration.test.ts
/**
 * The connect timeout of the client, against a server that never answers.
 *
 * `DbConfig.connectTimeout` is milliseconds. The driver's option is seconds,
 * and the client passed the number through: the default of 10 000 meant ten
 * thousand seconds, so a pool pointed at a host that accepts the connection
 * and says nothing waited for hours instead of failing.
 *
 * No database: a local TCP server accepts and stays silent, and the real
 * driver (not the mock of client.test.ts) is the one that has to give up.
 */

import { createServer, type Server, type Socket } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { canReachDatabase, createRawDb } from './client';

describe('connect timeout', () => {
  let server: Server;
  let port: number;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    // Accepts every connection and never sends a byte.
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const silentServer = (): string => `postgres://user:pass@127.0.0.1:${String(port)}/db`;

  test('gives up after connectTimeout milliseconds', async () => {
    const db = createRawDb({
      connectionString: silentServer(),
      connectTimeout: 300,
      ssl: false,
    });
    const started = Date.now();

    try {
      const failure = await db.raw('SELECT 1').then(
        () => undefined,
        (error: unknown) => error,
      );

      expect((failure as { code?: string } | undefined)?.code).toBe('CONNECT_TIMEOUT');
      // 300 ms, not 300 s.
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await db.close();
    }
  }, 20_000);

  test('canReachDatabase answers false within its one second', async () => {
    const started = Date.now();

    expect(await canReachDatabase(silentServer())).toBe(false);
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 20_000);
});
