// main/apps/server/src/plugin/logger.ts

import {
  createLogRequestContext,
  getOrCreateCorrelationId,
  type HookDoneFunction,
  type HttpServer,
  type HttpServerReply,
  type HttpServerRequest,
} from '@bslt/server-system/http';
import { createRequestLogger } from '@bslt/server-system/logger';
import { getMetricsCollector } from '@bslt/server-system/observability';

interface LoggerPluginOptions {
  /** Paths for which onResponse logging is skipped entirely (e.g. ['/health']). */
  excludePaths?: string[];
  /**
   * Fraction of requests to log on onResponse. 0.0 = none, 1.0 = all (default).
   * Useful for suppressing noise on high-frequency polling routes.
   */
  sampleRate?: number;
}

export function loggerPlugin(server: HttpServer, opts: LoggerPluginOptions = {}): void {
  const appLog = server.appLog;
  if (!appLog) {
    throw new Error('loggerPlugin requires server.appLog to be set (Logger).');
  }

  const { excludePaths, sampleRate } = opts;

  server.addHook(
    'onRequest',
    (request: HttpServerRequest, reply: HttpServerReply, done: HookDoneFunction) => {
      const requestWithCorrelation = request as HttpServerRequest & Record<string, unknown>;
      const existingCorrelationId = requestWithCorrelation.correlationId;
      const correlationId =
        typeof existingCorrelationId === 'string' && existingCorrelationId !== ''
          ? existingCorrelationId
          : getOrCreateCorrelationId(request.headers);

      requestWithCorrelation.correlationId = correlationId;
      reply.header('x-correlation-id', correlationId);

      const requestContext = createLogRequestContext(correlationId, {
        id: request.id,
        method: request.method,
        url: request.url,
        ip: request.ip,
        headers: request.headers,
      });

      request.requestContext = requestContext;
      request.log = createRequestLogger(appLog, requestContext);
      done();
    },
  );

  server.addHook(
    'onResponse',
    (request: HttpServerRequest, reply: HttpServerReply, done: HookDoneFunction) => {
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

      request.log.info('Request completed', {
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      done();
    },
  );
}
