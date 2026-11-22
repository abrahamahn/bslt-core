// main/apps/server/src/plugin/errors.ts

import { RequestSchemaError, type ErrorTracker } from '@bslt/contract';
import { mapErrorToHttpResponse, type ErrorMapperLogger } from '@bslt/server-system/errors';

import type {
  HttpPlugin,
  HttpServer,
  HttpServerReply,
  HttpServerRequest,
} from '@bslt/server-system/http';
import type { Logger } from '@bslt/server-system/logger';

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

/**
 * A request the HTTP framework itself refused before any handler ran: a body
 * over the limit (413), malformed or empty JSON (400), an unsupported content
 * type (415). These carry an `HTTP_ERR_*` code and a 4xx status, and the client
 * can act on them. Only the framework's own codes are trusted: a 4xx `statusCode`
 * on any other error says nothing about what is safe to tell the client.
 */
function frameworkClientError(error: Error): { status: number; message: string } | undefined {
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  if (typeof code !== 'string' || !code.startsWith('HTTP_ERR_')) return undefined;
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 500) return undefined;
  return { status: statusCode, message: error.message };
}

interface ErrorHandlerOptions {
  isProduction: boolean;
  /** Optional error tracker (logger-backed). Server errors (5xx) are reported to it. */
  errorTracker?: ErrorTracker;
}

export const errorHandlerPlugin: HttpPlugin<ErrorHandlerOptions> = (
  server: HttpServer,
  opts: ErrorHandlerOptions,
): void => {
  const isProd = opts.isProduction;

  server.setErrorHandler((error: Error, request: HttpServerRequest, reply: HttpServerReply) => {
    // request.log is already a request-scoped child logger.
    const log = toErrorMapperLogger(request.log);

    const correlationId: string | undefined =
      request.correlationId || (request.headers['x-correlation-id'] as string | undefined);
    // The path only: a query string can carry a token (reset, magic link,
    // unsubscribe), and these lines go to the log in every environment.
    const url = request.url.split('?', 1)[0];

    // Schema validation is a framework error too, but it has a typed form below.
    const isSchemaValidation = Array.isArray((error as { validation?: unknown }).validation);
    const refused = isSchemaValidation ? undefined : frameworkClientError(error);
    if (refused !== undefined) {
      log.warn(
        { correlationId, method: request.method, url, ip: request.ip },
        `validation error [system.validation]: ${refused.message}`,
      );
      if (correlationId) {
        reply.header('x-correlation-id', correlationId);
      }
      reply.status(refused.status).send({
        code: 'system.validation',
        kind: 'validation',
        message: refused.message,
        ...(correlationId ? { correlationId } : {}),
      });
      return;
    }

    let normalizedError: unknown = error;

    // JSON-schema validation → rewrite as the typed schema error (422).
    const schemaErr = error as { validation?: unknown[] };
    if (Array.isArray(schemaErr.validation)) {
      normalizedError = new RequestSchemaError(schemaErr.validation);
    }

    const { status, wire, retryAfter } = mapErrorToHttpResponse(normalizedError, log, {
      isProduction: isProd,
      logContext: {
        correlationId,
        method: request.method,
        url,
        ip: request.ip,
      },
    });

    // Report genuine server errors (5xx) to the error tracker. Client errors
    // (4xx) are expected and intentionally not captured.
    if (status >= 500) {
      opts.errorTracker?.captureError(error, {
        correlationId,
        method: request.method,
        url,
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
};
