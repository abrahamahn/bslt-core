// main/testing/src/http.ts
/**
 * Request and response helpers for `inject()`-driven tests: JSON bodies,
 * cookies, the CSRF pair a browser would send, and authenticated requests.
 */

import type { HttpServer, InjectOptions, InjectResponse } from '@bslt/server-system/http';

// ============================================================================
// CSRF
// ============================================================================

export interface CsrfTokenPair {
  token: string;
  cookie: string;
}

/** The server's own CSRF endpoint (registered by `createServer`). */
export const CSRF_TOKEN_PATH = '/api/csrf-token';

/**
 * Get a valid CSRF token pair from a server: the token for the
 * `x-csrf-token` header and the `_csrf` cookie that goes with it.
 */
export async function getCsrfToken(server: HttpServer): Promise<CsrfTokenPair> {
  const response = await server.inject({ method: 'GET', url: CSRF_TOKEN_PATH });

  const body = JSON.parse(response.body) as { token: string };
  const cookies = response.headers['set-cookie'];
  const csrfCookie = Array.isArray(cookies)
    ? cookies.find((c) => c.startsWith('_csrf='))
    : cookies?.startsWith('_csrf=') === true
      ? cookies
      : undefined;

  if (csrfCookie === undefined) {
    throw new Error('CSRF cookie not set');
  }

  return {
    token: body.token,
    cookie: csrfCookie.split(';')[0]!,
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function headerValue(headers: InjectOptions['headers'], name: string): unknown {
  if (headers === undefined) return undefined;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match === undefined ? undefined : (headers as Record<string, unknown>)[match];
}

/**
 * Add the CSRF header and cookie to a state-changing request, as the web client
 * does, unless the test already sends a token of its own. Safe methods are
 * returned unchanged.
 */
export function withCsrf(options: InjectOptions, csrf: CsrfTokenPair): InjectOptions {
  const method = (options.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return options;
  if (headerValue(options.headers, 'x-csrf-token') !== undefined) return options;

  const existingCookie = headerValue(options.headers, 'cookie');
  // Every header but the cookie, which is rewritten below under one spelling.
  const headers: Record<string, unknown> = Object.fromEntries(
    Object.entries((options.headers ?? {}) as Record<string, unknown>).filter(
      ([key]) => key.toLowerCase() !== 'cookie',
    ),
  );
  headers['x-csrf-token'] = csrf.token;
  headers['cookie'] =
    typeof existingCookie === 'string' && existingCookie !== ''
      ? `${existingCookie}; ${csrf.cookie}`
      : csrf.cookie;

  return { ...options, headers } as InjectOptions;
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Parse JSON response body. Returns unknown - callers should cast or validate the result.
 * Example: const data = parseJsonResponse(response) as MyType;
 */
export function parseJsonResponse(response: Pick<InjectResponse, 'body'>): unknown {
  return JSON.parse(response.body) as unknown;
}

export function getResponseCookie(response: InjectResponse, name: string): string | undefined {
  const cookies = response.headers['set-cookie'];
  if (cookies === undefined) return undefined;

  const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
  const targetCookie = cookieArray.find((c) => c.startsWith(`${name}=`));

  return targetCookie?.split(';')[0]?.split('=')[1];
}

export function getAllCookies(response: InjectResponse): string[] {
  const cookies = response.headers['set-cookie'];
  if (cookies === undefined) return [];
  return Array.isArray(cookies) ? cookies : [cookies];
}

// ============================================================================
// Request Builders
// ============================================================================

export interface AuthenticatedRequestOptions extends Omit<InjectOptions, 'headers'> {
  headers?: Record<string, string | string[] | undefined>;

  accessToken?: string;
  csrfToken?: string;
  csrfCookie?: string;
  cookies?: Record<string, string>;
  tenantId?: string;
}

export function buildAuthenticatedRequest(options: AuthenticatedRequestOptions): InjectOptions {
  const {
    accessToken,
    csrfToken,
    csrfCookie,
    cookies = {},
    headers = {},
    tenantId,
    ...rest
  } = options;

  const allHeaders: Record<string, string> = { ...headers } as Record<string, string>;
  const cookieParts: string[] = [];

  // Add authorization header
  if (accessToken !== undefined) {
    allHeaders['authorization'] = `Bearer ${accessToken}`;
  }

  // Add CSRF token header
  if (csrfToken !== undefined) {
    allHeaders['x-csrf-token'] = csrfToken;
  }

  // Add tenant ID header for tenant-scoped tests
  if (tenantId !== undefined) {
    allHeaders['x-tenant-id'] = tenantId;
  }

  // Add CSRF cookie
  if (csrfCookie !== undefined) {
    cookieParts.push(csrfCookie);
  }

  // Add other cookies
  for (const [name, value] of Object.entries(cookies)) {
    cookieParts.push(`${name}=${value}`);
  }

  if (cookieParts.length > 0) {
    allHeaders['cookie'] = cookieParts.join('; ');
  }

  return {
    ...rest,
    headers: allHeaders,
  };
}
