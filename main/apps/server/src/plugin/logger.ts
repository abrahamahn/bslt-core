// main/apps/server/src/plugin/logger.ts

import { createLogRequestContext, getOrCreateCorrelationId } from '@bslt/server-system/http';
import { createRequestLogger } from '@bslt/server-system/logger';
import { getMetricsCollector } from '@bslt/server-system/observability';

import type { Logger, LogRequestContext } from '@bslt/shared/system';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    appLog?: Logger;
  }

  interface FastifyRequest {
    requestContext: LogRequestContext;
  }
}

export interface LoggerPluginOptions {
  /** Paths for which onResponse logging is skipped entirely (e.g. ['/health']). */
  excludePaths?: string[];
  /**
   * Fraction of requests to log on onResponse. 0.0 = none, 1.0 = all (default).
   * Useful for suppressing noise on high-frequency polling routes.
   */
  sampleRate?: number;
}

export function loggerPlugin(server: FastifyInstance, opts: LoggerPluginOptions = {}): void {
  const appLog = server.appLog;
  if (!appLog) {
    throw new Error('loggerPlugin requires server.appLog to be set (Logger).');
  }

  const { excludePaths, sampleRate } = opts;

  server.addHook(
    'onRequest',
    (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      const requestWithCorrelation = request as FastifyRequest & Record<string, unknown>;
      const existingCorrelationId = requestWithCorrelation.correlationId;
      const correlationId =
        typeof existingCorrelationId === 'string'
          ? existingCorrelationId
          : getOrCreateCorrelationId(
              request.headers as Record<string, string | string[] | undefined>,
            );

      requestWithCorrelation.correlationId = correlationId;
      reply.header('x-correlation-id', correlationId);

      const requestContext = createLogRequestContext(correlationId, {
        id: request.id,
        method: request.method,
        url: request.url,
        ip: request.ip,
        headers: request.headers as Record<string, string | string[] | undefined>,
      });

      request.requestContext = requestContext;

      const requestLogger = createRequestLogger(appLog, requestContext);
      (request as FastifyRequest & { log: FastifyBaseLogger & Logger }).log =
        requestLogger as FastifyBaseLogger & Logger;
      done();
    },
  );

  server.addHook(
    'onResponse',
    (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      const excluded = excludePaths !== undefined && excludePaths.includes(request.url);

      // Record request metrics for every non-excluded request, independent of the
      // log sample rate (sampling logs is fine; sampling metrics would undercount).
      // Use the route pattern, not the raw URL, to bound metric cardinality.
      if (!excluded) {
        const route = request.routeOptions.url ?? 'unmatched';
        const collector = getMetricsCollector();
        collector.incrementRequestCount(route, reply.statusCode);
        collector.recordRequestLatency(route, Math.round(reply.elapsedTime));
      }

      if (excluded) {
        done();
        return;
      }
      if (sampleRate !== undefined && Math.random() > sampleRate) {
        done();
        return;
      }

      (request as FastifyRequest & { log: FastifyBaseLogger & Logger }).log.info(
        'Request completed',
        {
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );
      done();
    },
  );
}
