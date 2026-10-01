// main/apps/server/src/bootstrap/phases/http.ts

import net from 'node:net';

import { uniquePorts } from '@bslt/shared/system';

import { App, isAddrInUse } from '../app';

import type { InfraContext } from '../context';
import type { AppConfig } from '@bslt/shared/system/config';

export interface HttpPhaseState {
  app: App;
  port: number;
}

function validateHttpBinding(config: AppConfig): void {
  if (config.server.host.trim().length === 0) {
    throw new Error('Invalid HTTP configuration: host is required');
  }

  if (!Number.isFinite(config.server.port) || config.server.port <= 0) {
    throw new Error('Invalid HTTP configuration: port must be a positive number');
  }
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen({ port, host }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

async function pickAvailablePort(
  preferredPorts: Array<number | undefined>,
  host: string,
): Promise<number> {
  const candidates = uniquePorts(preferredPorts);
  for (const port of candidates) {
    if (await isPortFree(port, host)) {
      return port;
    }
  }
  throw new Error(`No available ports found in list: ${candidates.join(', ')}`);
}

export async function initHttpPhase(
  config: AppConfig,
  context: InfraContext,
): Promise<HttpPhaseState> {
  const app = new App(config, context);
  await app.init();
  return { app, port: 0 };
}

export async function startHttpPhase(config: AppConfig, app: App): Promise<number> {
  validateHttpBinding(config);

  const { host, port: configuredPort, portFallbacks } = config.server;

  // No fallbacks configured (production) means the port is a contract, not a
  // preference: bind exactly what we were told, or die saying so. Probing first
  // and picking whatever is free would leave the server up on a port nothing
  // else in the stack addresses.
  if (portFallbacks.length === 0) {
    try {
      await app.start(configuredPort, host);
    } catch (error) {
      if (isAddrInUse(error)) {
        throw new Error(
          `Port ${String(configuredPort)} is already in use on ${host}. ` +
            `The server binds the configured port exactly in production rather than ` +
            `drifting to another one, because the reverse proxy, the container port map ` +
            `and the healthcheck all address it by number. ` +
            `Free the port, or set API_PORT/PORT to the one you actually want.`,
        );
      }
      throw error;
    }

    app.log.info(`Server listening on ${host}:${String(configuredPort)}`);
    return configuredPort;
  }

  const port = await pickAvailablePort([configuredPort, ...portFallbacks], host);

  await app.start(port, host);
  app.log.info(`Server listening on ${host}:${String(port)}`);
  return port;
}

export async function stopHttpPhase(state: Partial<HttpPhaseState> | undefined): Promise<void> {
  const app = state?.app;
  if (!app) return;
  await app.stop();
}
