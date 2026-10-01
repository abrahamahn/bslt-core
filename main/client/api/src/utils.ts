// main/client/api/src/utils.ts
/**
 * Shared utilities for API client modules.
 */

import {
  API_PREFIX as SHARED_API_PREFIX,
  trimTrailingSlashes as sharedTrimTrailingSlashes,
} from '@bslt/shared';

import { createApiError, NetworkError } from './errors';

import type { ApiErrorBody } from './errors';

export const API_PREFIX = SHARED_API_PREFIX;
export const trimTrailingSlashes = sharedTrimTrailingSlashes;

type ResponseSchema<T> = {
  parse(data: unknown): T;
};

// ============================================================================
// Base Client Config
// ============================================================================

/** Shared configuration for all API client factories */
export interface BaseClientConfig {
  /** Base URL for API requests (e.g. 'http://localhost:3001') */
  baseUrl: string;
  /** Function to get the current auth token */
  getToken?: (() => string | null) | undefined;
  /**
   * Function to get the active tenant/workspace id. When it returns a non-empty
   * value, requests carry an `x-tenant-id` header so the server scopes RLS to
   * that tenant (drives the org switcher). Membership is still verified server-side.
   */
  getTenantId?: (() => string | null) | undefined;
  /** Custom fetch implementation (defaults to global fetch) */
  fetchImpl?: typeof fetch | undefined;
  /**
   * Called once when an authenticated request returns 401, to refresh the
   * access token. Resolve `true` if the token was refreshed and the request
   * should be retried, `false` otherwise. Without it, a 401 surfaces directly
   * (the access token lives in memory and can lapse, e.g. in a backgrounded tab).
   */
  onUnauthorized?: (() => Promise<boolean>) | undefined;
}

// ============================================================================
// Shared Request Factory
// ============================================================================

/** Options for the shared request factory */
export interface RequestFactoryOptions {
  /** Normalized base URL (already trimmed of trailing slashes) */
  baseUrl: string;
  /** Fetch implementation to use */
  fetcher: typeof fetch;
  /** Function to get the current auth token */
  getToken?: (() => string | null) | undefined;
  /** Active tenant id accessor; see {@link BaseClientConfig.getTenantId}. */
  getTenantId?: (() => string | null) | undefined;
  /** Refresh-on-401 hook; see {@link BaseClientConfig.onUnauthorized}. */
  onUnauthorized?: (() => Promise<boolean>) | undefined;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfTokenCache = new Map<string, string>();

/** Set the `x-tenant-id` header from the factory's active-tenant accessor, if any. */
function applyTenantHeader(headers: Headers, factory: RequestFactoryOptions): void {
  const tenantId = factory.getTenantId?.();
  if (tenantId !== null && tenantId !== undefined && tenantId !== '') {
    headers.set('x-tenant-id', tenantId);
  }
}

// App-injected fallback refresh-on-401 handler. The app registers this once at
// startup (see AuthService) so every client built without its own
// `onUnauthorized` still self-heals a lapsed in-memory access token, instead of
// each of the ~50 feature clients having to wire the hook individually.
let defaultOnUnauthorized: (() => Promise<boolean>) | undefined;

/**
 * Register (or clear, with `undefined`) the fallback {@link BaseClientConfig.onUnauthorized}
 * applied to any client that does not specify its own. The handler is shared
 * process-wide; the last caller wins, mirroring the single auth instance.
 */
export function setDefaultOnUnauthorized(handler: (() => Promise<boolean>) | undefined): void {
  defaultOnUnauthorized = handler;
}

export function resolveFetchImpl(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl !== undefined) return fetchImpl;
  return globalThis.fetch.bind(globalThis);
}

function isCsrfError(status: number, data: Record<string, unknown>): boolean {
  if (status !== 403) return false;
  const message = typeof data['message'] === 'string' ? data['message'].toLowerCase() : '';
  return message.includes('csrf');
}

async function fetchCsrfToken(factory: RequestFactoryOptions): Promise<string> {
  const response = await factory.fetcher(`${factory.baseUrl}${API_PREFIX}/csrf-token`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json().catch(() => ({}))) as { token?: unknown; message?: unknown };
  if (!response.ok || typeof data.token !== 'string' || data.token.length === 0) {
    throw createApiError(response.status, {
      message: typeof data.message === 'string' ? data.message : 'Failed to fetch CSRF token',
    });
  }

  csrfTokenCache.set(factory.baseUrl, data.token);
  return data.token;
}

/**
 * CSRF-aware request function wrapper for clients that perform mutating
 * operations behind CSRF protection.
 */
export interface CsrfRequestClient {
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
}

/**
 * Create a typed request function from a base client config.
 * Consolidates the duplicated request logic from all client modules.
 */
export function createRequestFactory(config: BaseClientConfig): RequestFactoryOptions {
  return {
    baseUrl: trimTrailingSlashes(config.baseUrl),
    fetcher: resolveFetchImpl(config.fetchImpl),
    getToken: config.getToken,
    getTenantId: config.getTenantId,
    onUnauthorized: config.onUnauthorized ?? defaultOnUnauthorized,
  };
}

/**
 * Obtain a CSRF token for a transport that cannot use the request client.
 *
 * A WebSocket handshake is the case this exists for: browsers cannot set
 * headers on it, so the token has to travel in the URL and the caller needs the
 * raw value. Routed through here rather than a second `fetch` so there is ONE
 * CSRF endpoint path in the codebase — a hand-written copy is how the upstream
 * realtime client spent a long time requesting `/csrf-token` and never
 * connecting, in every environment, while looking exactly like a working poll.
 *
 * Shares the cache with the request client, so this rarely costs a round trip.
 *
 * @param config - Client config (base URL, fetch impl)
 * @returns A CSRF token
 * @complexity O(1) after the first call
 */
export async function getCsrfToken(config: BaseClientConfig): Promise<string> {
  const factory = createRequestFactory(config);
  const cached = csrfTokenCache.get(factory.baseUrl);
  if (cached !== undefined && cached !== '') return cached;
  return fetchCsrfToken(factory);
}

/**
 * Create a request client that automatically retries once on CSRF failures.
 * Uses the standard `/api/csrf-token` endpoint to refresh the CSRF token.
 */
export function createCsrfRequestClient(config: BaseClientConfig): CsrfRequestClient {
  const factory = createRequestFactory(config);

  const request = async <T>(
    path: string,
    options?: RequestInit,
    attempt: number = 0,
  ): Promise<T> => {
    const method = options?.method ?? 'GET';
    const requiresCsrf = !SAFE_METHODS.has(method.toUpperCase());
    const headers = new Headers(options?.headers);
    if (!(options?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const token = factory.getToken?.();
    if (token !== null && token !== undefined && token !== '') {
      headers.set('Authorization', `Bearer ${token}`);
    }
    applyTenantHeader(headers, factory);
    const csrfToken = csrfTokenCache.get(factory.baseUrl) ?? null;
    if (requiresCsrf && csrfToken !== null && csrfToken.length > 0) {
      headers.set('x-csrf-token', csrfToken);
    }

    const url = `${factory.baseUrl}${API_PREFIX}${path}`;

    let response: Response;
    try {
      response = await factory.fetcher(url, {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new NetworkError(`Failed to fetch ${method} ${path}`, cause) as Error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      if (requiresCsrf && attempt === 0 && isCsrfError(response.status, data)) {
        await fetchCsrfToken(factory);
        return request<T>(path, options, 1);
      }
      if (
        response.status === 401 &&
        attempt === 0 &&
        factory.onUnauthorized !== undefined &&
        (await factory.onUnauthorized())
      ) {
        return request<T>(path, options, 1);
      }
      throw createApiError(response.status, data as ApiErrorBody);
    }

    return data as T;
  };

  return { request };
}

/**
 * Make an authenticated JSON API request.
 *
 * Handles: URL construction, auth headers, JSON parsing, error mapping.
 * Used by all client factories to avoid duplicating request boilerplate.
 */
export async function apiRequest<T>(
  factory: RequestFactoryOptions,
  path: string,
  options?: RequestInit,
  requiresAuth = true,
  responseSchema?: ResponseSchema<T>,
  attempt: number = 0,
): Promise<T> {
  const method = options?.method ?? 'GET';
  const requiresCsrf = !SAFE_METHODS.has(method.toUpperCase());
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');

  if (requiresAuth) {
    const token = factory.getToken?.();
    if (token !== null && token !== undefined && token !== '') {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  applyTenantHeader(headers, factory);
  const csrfToken = csrfTokenCache.get(factory.baseUrl) ?? null;
  if (requiresCsrf && csrfToken !== null && csrfToken.length > 0) {
    headers.set('x-csrf-token', csrfToken);
  }

  const url = `${factory.baseUrl}${API_PREFIX}${path}`;

  let response: Response;
  try {
    response = await factory.fetcher(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (error: unknown) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new NetworkError(`Failed to fetch ${options?.method ?? 'GET'} ${path}`, cause) as Error;
  }

  const data = (await response.json().catch(() => ({}))) as ApiErrorBody & Record<string, unknown>;

  if (!response.ok) {
    if (requiresCsrf && attempt === 0 && isCsrfError(response.status, data)) {
      await fetchCsrfToken(factory);
      return apiRequest(factory, path, options, requiresAuth, responseSchema, 1);
    }
    if (
      requiresAuth &&
      response.status === 401 &&
      attempt === 0 &&
      factory.onUnauthorized !== undefined &&
      (await factory.onUnauthorized())
    ) {
      return apiRequest(factory, path, options, requiresAuth, responseSchema, 1);
    }
    throw createApiError(response.status, data);
  }

  if (responseSchema !== undefined) {
    return responseSchema.parse(data);
  }

  return data as T;
}
