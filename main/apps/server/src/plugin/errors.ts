// main/apps/server/src/plugin/errors.ts

import { mapErrorToHttpResponse, type ErrorMapperLogger } from '@bslt/server-system/errors';
import { type Logger } from '@bslt/shared/system';
import { RequestSchemaError } from '@bslt/shared/system/errors';
import fp from 'fastify-plugin';

import type { ErrorTracker } from '@bslt/shared/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Adapt a Logger (err: Error first) to ErrorMapperLogger (error: unknown first). */
function toErrorMapperLogger(log: Logger): ErrorMapperLogger {
  return {
    info: (message, context) => {
      log.info(message, context);
    },
    warn: (context, message) => {
      log.warn(context, message);
    },
    error: (error, message, context) => {
      log.error(error instanceof Error ? error : new Error(String(error)), message, context);
    },
  };
}

interface ErrorHandlerOptions {
  isProduction: boolean;
  /** Optional error tracker (e.g. Sentry). Server errors (5xx) are reported to it. */
  errorTracker?: ErrorTracker;
}

export const errorHandlerPlugin = fp<ErrorHandlerOptions>(
  (server: FastifyInstance, opts: ErrorHandlerOptions) => {
    const isProd = opts.isProduction;

    server.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
      // Use Fastify's built-in request.log — it's already a request-scoped child logger.
      const log = toErrorMapperLogger(request.log as Logger);

      const correlationId: string | undefined =
        request.correlationId || (request.headers['x-correlation-id'] as string | undefined);

      let normalizedError: unknown = error;

      // Fastify JSON-schema validation (AJV) → rewrite as a typed 400 error.
      const fastifyError = error as { validation?: unknown[] };
      if (Array.isArray(fastifyError.validation)) {
        normalizedError = new RequestSchemaError(fastifyError.validation);
      }

      const { status, wire, retryAfter } = mapErrorToHttpResponse(normalizedError, log, {
        isProduction: isProd,
        logContext: {
          correlationId,
          method: request.method,
          url: request.url,
          ip: request.ip,
        },
      });

      // Report genuine server errors (5xx) to the error tracker. Client errors
      // (4xx) are expected and intentionally not captured.
      if (status >= 500) {
        opts.errorTracker?.captureError(error, {
          correlationId,
          method: request.method,
          url: request.url,
          ip: request.ip,
          statusCode: status,
        });
      }

      if (correlationId) {
        reply.header('x-correlation-id', correlationId);
      }

      if (retryAfter !== undefined) {
        reply.header('Retry-After', retryAfter);
      }

      reply.status(status).send(wire);
    });
  },
  { name: 'abe-system-error-handler', fastify: '5.x' },
);
