// main/apps/server/src/bootstrap/phases/infra.ts

import { type ErrorTracker } from '@bslt/contract';
import { SubscriptionManager } from '@bslt/realtime';
import { createCache } from '@bslt/server-system/cache';
import { createLogger, developmentFormatter } from '@bslt/server-system/logger';
import { createLogErrorTracker } from '@bslt/server-system/observability';

import { type AppPorts, type PlatformContext } from '../context';

import type { AppConfig } from '@bslt/server-system/config';

export interface InfraPhaseState {
  platform: PlatformContext;
  stopCache?: (() => Promise<void>) | undefined;
}

type CloseableMethod = 'close' | 'stop';

function hasMethod<K extends PropertyKey>(
  value: unknown,
  key: K,
): value is Record<K, () => unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    key in value &&
    typeof (value as Record<PropertyKey, unknown>)[key] === 'function'
  );
}

async function callIfMethod(value: unknown, method: CloseableMethod): Promise<void> {
  if (hasMethod(value, method)) {
    await value[method]();
  }
}

function openCache(config: AppConfig): Pick<PlatformContext, 'cache'> & {
  stopCache: () => Promise<void>;
} {
  const cacheProvider = createCache(config.cache);
  return {
    cache: { getStats: () => Promise.resolve(cacheProvider.getStats()) },
    stopCache: () => callIfMethod(cacheProvider, 'close'),
  };
}

/**
 * Compose the platform services. A port the caller supplies (`ports.log`,
 * `ports.cache`, `ports.errorTracker`) is used as given and its default is
 * never constructed.
 */
export function bootstrapInfraPhase(
  config: AppConfig,
  ports: AppPorts = {},
): Promise<InfraPhaseState> {
  const log =
    ports.log ??
    createLogger(
      config.server.logLevel,
      { service: 'server-infra', env: config.env },
      config.env === 'development' ? developmentFormatter : undefined,
    );

  const { cache, stopCache } =
    ports.cache !== undefined ? { cache: ports.cache } : openCache(config);

  const pubsub = new SubscriptionManager();

  const errorTracker: ErrorTracker = ports.errorTracker ?? createLogErrorTracker(log);

  const platform: PlatformContext = Object.freeze({
    config,
    pubsub,
    cache,
    errorTracker,
    log,
  });

  platform.log.info('Infra phase bootstrapped');

  return Promise.resolve({ platform, stopCache });
}

export async function stopInfraPhase(state: Partial<InfraPhaseState> | undefined): Promise<void> {
  if (!state) return;

  if (state.stopCache !== undefined) {
    await state.stopCache();
  }
}
