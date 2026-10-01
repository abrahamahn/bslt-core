// main/apps/server/src/bootstrap/phases/infra.ts

import { createCache } from '@bslt/server-system/cache';
import { createLogger, developmentFormatter } from '@bslt/server-system/logger';
import { createErrorTracker } from '@bslt/server-system/observability';
import { type ErrorTracker } from '@bslt/shared/contracts';
import { SubscriptionManager } from '@bslt/shared/db';

import { type PlatformContext } from '../context';

import type { AppConfig } from '@bslt/shared/system/config';

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

export function bootstrapInfraPhase(config: AppConfig): Promise<InfraPhaseState> {
  const log = createLogger(
    config.server.logLevel,
    { service: 'server-infra', env: config.env },
    config.env === 'development' ? developmentFormatter : undefined,
  );

  const cacheProvider = createCache(config.cache);
  const cache = {
    getStats: () => Promise.resolve(cacheProvider.getStats()),
  };

  const pubsub = new SubscriptionManager();

  const errorTrackingConfig = {
    dsn: process.env['SENTRY_DSN']?.trim() || null,
    environment: config.env,
  };
  const errorTrackingProvider = createErrorTracker(errorTrackingConfig);
  errorTrackingProvider.init(errorTrackingConfig);

  const errorTracker: ErrorTracker = {
    captureError: (error, context) => {
      errorTrackingProvider.captureError(error, context);
    },
    addBreadcrumb: (message, data) => {
      errorTrackingProvider.addBreadcrumb(message, 'app', data);
    },
    setUserContext: (userId, userEmail) => {
      errorTrackingProvider.setUserContext(userId, userEmail);
    },
  };

  const platform: PlatformContext = Object.freeze({
    config,
    pubsub,
    cache,
    errorTracker,
    log,
  });

  platform.log.info('Infra phase bootstrapped');

  return Promise.resolve({
    platform,
    stopCache: () => callIfMethod(cacheProvider, 'close'),
  });
}

export async function stopInfraPhase(state: Partial<InfraPhaseState> | undefined): Promise<void> {
  if (!state) return;

  if (state.stopCache !== undefined) {
    await state.stopCache();
  }
}
