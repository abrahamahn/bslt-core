// main/apps/server/src/middleware/security.ts
/**
 * HTTP Security Middleware
 *
 * Explicit security headers and CORS handling.
 * Replaces @fastify/helmet and @fastify/cors with framework-independent logic.
 *
 * Benefits:
 * - Full control over what headers are set
 * - No hidden defaults or unexpected behavior
 * - Easier to audit and understand
 */

import { HTTP_STATUS, SECONDS_PER_DAY } from '@bslt/shared/constants';
import { generateSecurityHeaders, type SecurityHeaderOptions } from '@bslt/shared/system';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Apply security headers to a Fastify reply
 *
 * @param res - The Fastify reply object
 * @param options - Security header configuration options
 */
export function applySecurityHeaders(res: FastifyReply, options: SecurityHeaderOptions = {}): void {
  const headers = generateSecurityHeaders(options);

  for (const [key, value] of Object.entries(headers)) {
    res.header(key, value);
  }

  // Remove server information (don't advertise technology stack)
  res.header('X-Powered-By', undefined);
  res.header('Server', undefined);
}

/**
 * Apply Cache-Control headers to prevent sensitive data from being cached.
 * Should be applied to API routes only (not static assets).
 *
 * Prevents back-button data leak: after logout, pressing back won't show
 * cached authenticated responses.
 */
export function applyApiCacheHeaders(res: FastifyReply): void {
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.header('Pragma', 'no-cache');
}

// ============================================================================
// CORS Headers (Replaces @fastify/cors)
// ============================================================================

export interface CorsOptions {
  origin: string;
  credentials?: boolean;
  allowedHeaders?: string[];
  allowedMethods?: string[];
  maxAge?: number;
}

const DEFAULT_CORS_OPTIONS: Required<Omit<CorsOptions, 'origin'>> = {
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Id'],
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  maxAge: SECONDS_PER_DAY,
};

/**
 * Apply CORS headers to the response.
 * Handles origin validation and header setting.
 *
 * @param req - The Fastify request object
 * @param res - The Fastify reply object
 * @param options - CORS configuration options
 */
export function applyCors(req: FastifyRequest, res: FastifyReply, options: CorsOptions): void {
  const {
    origin: allowedOrigin,
    credentials,
    allowedHeaders,
    allowedMethods,
    maxAge,
  } = {
    ...DEFAULT_CORS_OPTIONS,
    ...options,
  };

  const requestOrigin = req.headers.origin;
  let allowOrigin: string | null = null;
  const wildcardAllowed = hasWildcardOrigin(allowedOrigin);

  if (wildcardAllowed) {
    // Wildcard origin: use literal '*' only, never reflect arbitrary origins.
    // Credentials are handled separately and must not be enabled with '*'.
    allowOrigin = '*';
  } else if (requestOrigin === allowedOrigin) {
    // Exact match: use the configured value (not the request header) to avoid reflection
    allowOrigin = allowedOrigin;
  } else if (requestOrigin != null) {
    // Multi-origin: check if request origin matches one in the configured allowlist
    const matched = findAllowedOrigin(requestOrigin, allowedOrigin);
    if (matched !== undefined) {
      allowOrigin = matched;
    }
  }

  if (allowOrigin != null) {
    res.header('Access-Control-Allow-Origin', allowOrigin);
    if (allowOrigin !== '*') {
      res.header('Vary', 'Origin');
    }
  }

  if (credentials && allowOrigin != null && allowOrigin !== '*') {
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  // Allowed headers and methods
  res.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
  res.header('Access-Control-Allow-Methods', allowedMethods.join(', '));

  // Cache preflight response
  res.header('Access-Control-Max-Age', String(maxAge));
}

/**
 * Find a matching origin from a comma-separated allowlist.
 * Returns the configured origin value (not the request header) to avoid origin reflection.
 *
 * @param origin - The request origin to check
 * @param allowedOrigins - Comma-separated list of allowed origins
 * @returns The matched configured origin, or undefined if not found
 */
function findAllowedOrigin(origin: string, allowedOrigins: string): string | undefined {
  const origins = allowedOrigins.split(',').map((o) => o.trim());
  return origins.find((o) => o === origin);
}

function hasWildcardOrigin(allowedOrigin: string): boolean {
  if (allowedOrigin.trim() === '*') return true;
  return allowedOrigin
    .split(',')
    .map((origin) => origin.trim())
    .some((origin) => origin === '*');
}

/**
 * Handle CORS preflight (OPTIONS) requests.
 * Returns true if the request was a preflight and was handled.
 *
 * @param req - The Fastify request object
 * @param res - The Fastify reply object
 * @returns true if the request was a preflight OPTIONS request
 */
export function handlePreflight(req: FastifyRequest, res: FastifyReply): boolean {
  if (req.method === 'OPTIONS') {
    res.status(HTTP_STATUS.NO_CONTENT).send();
    return true;
  }
  return false;
}
