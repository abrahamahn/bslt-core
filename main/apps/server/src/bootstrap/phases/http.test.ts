// main/apps/server/src/bootstrap/phases/http.test.ts
/**
 * Port selection had no test at all, which is how it went unnoticed that the
 * server treats an explicitly configured production port as a suggestion.
 */

import net from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHttpPhase } from './http';

import type { App } from '../app';
import type { AppConfig } from '@bslt/server-system/config';

const openServers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

/** Actually occupy a port, so EADDRINUSE is real rather than mocked. */
async function occupy(host: string): Promise<number> {
  const server = net.createServer();
  openServers.push(server);

  return new Promise<number>((resolve) => {
    server.listen({ port: 0, host }, () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

function makeConfig(port: number, portFallbacks: number[]): AppConfig {
  return {
    server: { host: '127.0.0.1', port, portFallbacks },
  } as unknown as AppConfig;
}

/** An App whose `start` binds for real, so it fails for the real reason. */
function makeApp(): { app: App; started: number[] } {
  const started: number[] = [];

  const app = {
    log: { info: vi.fn() },
    start: vi.fn(async (port: number, host: string) => {
      const server = net.createServer();
      openServers.push(server);

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host }, () => {
          resolve();
        });
      });

      started.push(port);
    }),
  } as unknown as App;

  return { app, started: started };
}

describe('startHttpPhase — production pins the port', () => {
  it('fails loudly when the configured port is taken and there are no fallbacks', async () => {
    // The production shape: portFallbacks is empty. Before this, the server
    // probed, found 8080 busy, bound 3000, and logged success — while the
    // compose port map, Caddy and the healthcheck all still addressed 8080.
    const taken = await occupy('127.0.0.1');
    const { app, started } = makeApp();

    await expect(startHttpPhase(makeConfig(taken, []), app)).rejects.toThrow(
      new RegExp(`Port ${String(taken)} is already in use`, 'u'),
    );

    expect(started).toEqual([]);
  });

  it('names API_PORT in the failure, so the message is actionable', async () => {
    const taken = await occupy('127.0.0.1');
    const { app } = makeApp();

    await expect(startHttpPhase(makeConfig(taken, []), app)).rejects.toThrow(/API_PORT/u);
  });

  it('binds the configured port exactly when it is free', async () => {
    const { app, started } = makeApp();
    const free = await occupy('127.0.0.1');
    // Release it, then claim that exact number.
    await new Promise<void>((resolve) => {
      openServers.pop()?.close(() => {
        resolve();
      });
    });

    const bound = await startHttpPhase(makeConfig(free, []), app);

    expect(bound).toBe(free);
    expect(started).toEqual([free]);
  });
});

describe('startHttpPhase — development still walks the fallback chain', () => {
  it('moves to a fallback when the preferred port is busy', async () => {
    // Locally a busy 8080 usually means a stale `pnpm dev`, and walking to the
    // next port is genuinely what you want. That behaviour must survive.
    const taken = await occupy('127.0.0.1');
    const { app, started } = makeApp();

    const bound = await startHttpPhase(makeConfig(taken, [0]), app);

    expect(bound).not.toBe(taken);
    expect(started).toHaveLength(1);
  });
});
