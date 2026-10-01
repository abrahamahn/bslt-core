// main/server/system/src/http/request-context.ts
/**
 * Shared request correlation/context helpers for server transports.
 *
 * Keep this module as the single source of truth for correlation ID parsing
 * and log request-context construction.
 */

import { randomUUID } from 'node:crypto';

import { STANDARD_HEADERS } from '@bslt/shared/constants';
import { AuthenticationError } from '@bslt/shared/system';

import type { AuthenticatedUser, RequestContext } from '@bslt/shared/contracts';
import type { HttpRequest, LogRequestContext } from '@bslt/shared/system';

/** Extract the authenticated user attached to a request by the auth middleware. */
export function getAuthenticatedUser(
  request: HttpRequest | RequestContext,
): AuthenticatedUser | undefined {
  return (request as { user?: AuthenticatedUser }).user;
}

/** Extract the authenticated user or throw a 401 `AuthenticationError`. */
export function requireAuthenticatedUser(request: HttpRequest | RequestContext): AuthenticatedUser {
  const user = getAuthenticatedUser(request);
  if (user === undefined) {
    throw new AuthenticationError();
  }
  return user;
}

export function isValidCorrelationId(id: string): boolean {
  if (id === '' || id.length > 128) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extracts the W3C trace ID from a `traceparent` header.
 * Format: `{version}-{traceId}-{parentId}-{flags}` (e.g., `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`)
 * Returns undefined when the header is absent or malformed.
 */
export function extractTraceId(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const traceparent = headers['traceparent'];
  if (typeof traceparent !== 'string' || traceparent === '') return undefined;
  const traceId = traceparent.split('-')[1];
  // traceId is a 32-char hex string (16 bytes)
  return typeof traceId === 'string' && traceId.length === 32 ? traceId : undefined;
}

export function getOrCreateCorrelationId(
  headers: Record<string, string | string[] | undefined>,
): string {
  const correlationId = headers[STANDARD_HEADERS.CORRELATION_ID];
  if (typeof correlationId === 'string' && isValidCorrelationId(correlationId)) {
    return correlationId;
  }

  const requestId = headers[STANDARD_HEADERS.REQUEST_ID];
  if (typeof requestId === 'string' && isValidCorrelationId(requestId)) {
    return requestId;
  }

  const traceId = extractTraceId(headers);
  if (traceId !== undefined) return traceId;

  return generateCorrelationId();
}

export function createLogRequestContext(
  correlationId: string,
  request: {
    id: string;
    method: string;
    url: string;
    ip: string;
    headers: Record<string, string | string[] | undefined>;
  },
  userId?: string,
): LogRequestContext {
  const context: LogRequestContext = {
    correlationId,
    requestId: request.id,
    method: request.method,
    path: request.url,
    ip: request.ip,
  };

  const userAgent = request.headers['user-agent'];
  if (typeof userAgent === 'string') {
    context.userAgent = userAgent;
  }

  const traceId = extractTraceId(request.headers);
  if (traceId !== undefined) {
    context.traceId = traceId;
  }

  if (userId) {
    context.userId = userId;
  }

  return context;
}
