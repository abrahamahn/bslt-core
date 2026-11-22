// main/kernel/client/src/transport/transport.ts
/**
 * Single HTTP transport for all BSLT browser/client requests.
 *
 * Centralizes:
 * - Normalized base URL + `/api` prefixing
 * - `Authorization: Bearer <token>` header attachment
 * - `x-tenant-id` header attachment (explicit `getTenantId` or app-wide default)
 * - Shared CSRF token cache (`/api/csrf-token`) + one-shot 403 CSRF retry
 * - One-shot 401 access-token refresh retry (explicit `onUnauthorized` or app-wide default)
 * - Canonical HTTP status -> `@bslt/shared/system` `AppError` mapping
 */

import {
  API_PREFIX,
  AppError,
  HTTP_STATUS,
  isInterstitialRequirementCode,
  trimTrailingSlashes,
  type InterstitialRequirementCode,
} from '@bslt/contract';

import { createApiError, type TransportErrorBody } from './errors';

export type { TransportErrorBody } from './errors';

export type RequirementInterceptorHandler = (
  details: Readonly<Record<string, unknown>>,
) => Promise<boolean>;

export type RequirementInterceptor = (
  code: InterstitialRequirementCode,
  details: Readonly<Record<string, unknown>>,
) => Promise<boolean>;

export interface TransportConfig {
  /** Base URL for API requests (e.g. 'http://localhost:3001' or '') */
  readonly baseUrl: string;
  /** Function to read the current access token */
  readonly getToken?: (() => string | null) | undefined;
  /** Function to read the active org/tenant id (falls back to `setDefaultTenantIdGetter`) */
  readonly getTenantId?: (() => string | null) | undefined;
  /** Custom `fetch` implementation (defaults to `globalThis.fetch`) */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Refresh-on-401 callback (falls back to `setDefaultOnUnauthorized`) */
  readonly onUnauthorized?: (() => Promise<boolean>) | undefined;
  /** Requirement-on-403 callback (falls back to `registerRequirementHandler` registry) */
  readonly onRequirement?: RequirementInterceptor | undefined;
  /** Optional custom HTTP error factory (defaults to canonical `AppError` subclasses) */
  readonly createHttpError?: ((status: number, body: TransportErrorBody) => Error) | undefined;
  /** Optional custom network error factory */
  readonly createNetworkError?: ((message: string, cause: Error) => Error) | undefined;
}

export interface TransportRequestOptions<T = unknown> extends RequestInit {
  /** Attach Bearer token and allow 401 refresh-retry. Defaults to `true`. */
  readonly requiresAuth?: boolean | undefined;
  /** Optional parser applied to 2xx JSON/empty responses. */
  readonly responseSchema?: { parse(data: unknown): T } | undefined;
  /**
   * Set `true` when `path` already starts with `/api/` (e.g. `@bslt/contract` `Endpoint.path`).
   * Defaults to `false`, which prefixes `API_PREFIX` (`/api`).
   */
  readonly rawApiPath?: boolean | undefined;
}

export interface Transport {
  request<T = unknown>(path: string, options?: TransportRequestOptions<T>): Promise<T>;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfTokenCache = new Map<string, string>();
const requirementHandlers = new Map<InterstitialRequirementCode, RequirementInterceptorHandler>();

let defaultOnUnauthorized: (() => Promise<boolean>) | undefined;
let defaultTenantIdGetter: (() => string | null) | undefined;

/**
 * Register a module UI handler for a typed 403 requirement code (e.g. `TOS_ACCEPTANCE_REQUIRED`).
 * Returns an unregister function.
 */
export function registerRequirementHandler(
  code: InterstitialRequirementCode,
  handler: RequirementInterceptorHandler,
): () => void {
  requirementHandlers.set(code, handler);
  return () => {
    if (requirementHandlers.get(code) === handler) {
      requirementHandlers.delete(code);
    }
  };
}

/** Clear all registered requirement handlers (used on teardown and in tests). */
export function clearRequirementHandlers(): void {
  requirementHandlers.clear();
}

async function runRequirementInterceptor(
  code: InterstitialRequirementCode,
  details: Readonly<Record<string, unknown>>,
  override: RequirementInterceptor | undefined,
): Promise<boolean> {
  if (override !== undefined) {
    return override(code, details);
  }
  const registered = requirementHandlers.get(code);
  if (registered === undefined) {
    return false;
  }
  return registered(details);
}

/**
 * Register (or clear with `undefined`) the app-wide fallback 401 token-refresh handler.
 */
export function setDefaultOnUnauthorized(handler: (() => Promise<boolean>) | undefined): void {
  defaultOnUnauthorized = handler;
}

/**
 * Register (or clear with `undefined`) the app-wide fallback active-org/tenant getter
 * used to populate `x-tenant-id` on every transport that does not supply its own `getTenantId`.
 */
export function setDefaultTenantIdGetter(getter: (() => string | null) | undefined): void {
  defaultTenantIdGetter = getter;
}

/** Clear cached CSRF tokens (used on session reset and in tests). */
export function clearCsrfTokenCache(): void {
  csrfTokenCache.clear();
}

/**
 * Return `true` when `error` represents an HTTP error response with the given `status`
 * (e.g. `404` for idempotent delete), allowing modules to inspect HTTP status codes
 * without importing `@bslt/shared/system` error classes.
 */
export function isHttpStatusError(error: unknown, status: number): boolean {
  if (error instanceof AppError) {
    return error.statusCode === status;
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    return (error as { readonly statusCode?: unknown }).statusCode === status;
  }
  return false;
}

function resolveFetcher(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl !== undefined) return fetchImpl;
  return globalThis.fetch.bind(globalThis);
}

function isFormDataBody(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function isCsrfFailure(status: number, body: Record<string, unknown>): boolean {
  if (status !== HTTP_STATUS.FORBIDDEN) return false;
  const message = typeof body['message'] === 'string' ? body['message'].toLowerCase() : '';
  const code = typeof body['code'] === 'string' ? body['code'].toLowerCase() : '';
  return message.includes('csrf') || code.includes('csrf');
}

function defaultCreateHttpError(status: number, body: TransportErrorBody): AppError {
  return createApiError(status, body);
}

function defaultCreateNetworkError(message: string, cause: Error): AppError {
  const error = new AppError(message, {
    code: 'NETWORK_ERROR',
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
  });
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function toErrorBody(raw: Record<string, unknown>): TransportErrorBody {
  return {
    message: typeof raw['message'] === 'string' ? raw['message'] : undefined,
    code: typeof raw['code'] === 'string' ? raw['code'] : undefined,
    details:
      typeof raw['details'] === 'object' &&
      raw['details'] !== null &&
      !Array.isArray(raw['details'])
        ? (raw['details'] as Record<string, unknown>)
        : undefined,
    lockReason: typeof raw['lockReason'] === 'string' ? raw['lockReason'] : undefined,
    lockedUntil: typeof raw['lockedUntil'] === 'string' ? raw['lockedUntil'] : undefined,
  };
}

async function fetchCsrfToken(
  baseUrl: string,
  fetcher: typeof fetch,
  makeHttpError: (status: number, body: TransportErrorBody) => Error,
): Promise<string> {
  const response = await fetcher(`${baseUrl}${API_PREFIX}/csrf-token`, {
    method: 'GET',
    credentials: 'include',
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const token = data['token'];
  if (!response.ok || typeof token !== 'string' || token.length === 0) {
    const status = response.ok ? HTTP_STATUS.BAD_REQUEST : response.status;
    throw makeHttpError(status, {
      message: typeof data['message'] === 'string' ? data['message'] : 'Failed to fetch CSRF token',
      code: typeof data['code'] === 'string' ? data['code'] : undefined,
    });
  }

  csrfTokenCache.set(baseUrl, token);
  return token;
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const trimmed = trimTrailingSlashes(rawBaseUrl);
  if (trimmed === API_PREFIX) {
    return '';
  }
  if (trimmed.endsWith(API_PREFIX)) {
    return trimmed.slice(0, -API_PREFIX.length);
  }
  return trimmed;
}

/**
 * Obtain a raw CSRF token (sharing the transport cache) for non-fetch transports such as WebSocket handshakes.
 */
export async function getTransportCsrfToken(config: TransportConfig): Promise<string> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const cached = csrfTokenCache.get(baseUrl);
  if (cached !== undefined && cached.length > 0) {
    return cached;
  }
  const fetcher = resolveFetcher(config.fetchImpl);
  const makeHttpError = config.createHttpError ?? defaultCreateHttpError;
  return fetchCsrfToken(baseUrl, fetcher, makeHttpError);
}

/**
 * Create the single shared HTTP transport used by both contract-inferred module clients
 * and legacy API/React wrappers.
 */
export function createTransport(config: TransportConfig): Transport {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetcher = resolveFetcher(config.fetchImpl);
  const makeHttpError = config.createHttpError ?? defaultCreateHttpError;
  const makeNetworkError = config.createNetworkError ?? defaultCreateNetworkError;

  const execute = async <T>(
    path: string,
    options: TransportRequestOptions<T> | undefined,
    csrfRetried: boolean,
    authRetried: boolean,
    requirementRetried: boolean,
  ): Promise<T> => {
    const method = options?.method ?? 'GET';
    const requiresAuth = options?.requiresAuth ?? true;
    const requiresCsrf = !SAFE_METHODS.has(method.toUpperCase());

    const headers = new Headers(options?.headers);
    if (!isFormDataBody(options?.body)) {
      headers.set('Content-Type', 'application/json');
    }

    if (requiresAuth) {
      const token = config.getToken?.();
      if (token !== null && token !== undefined && token.length > 0) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    const tenantGetter = config.getTenantId ?? defaultTenantIdGetter;
    const tenantId = tenantGetter?.();
    if (tenantId !== null && tenantId !== undefined && tenantId.length > 0) {
      headers.set('x-tenant-id', tenantId);
    }

    const csrfToken = csrfTokenCache.get(baseUrl) ?? null;
    if (requiresCsrf && csrfToken !== null && csrfToken.length > 0) {
      headers.set('x-csrf-token', csrfToken);
    }

    const url =
      options?.rawApiPath === true ? `${baseUrl}${path}` : `${baseUrl}${API_PREFIX}${path}`;

    const {
      requiresAuth: _requiresAuth,
      responseSchema,
      rawApiPath: _rawApiPath,
      ...fetchInit
    } = options ?? {};

    let response: Response;
    try {
      response = await fetcher(url, {
        ...fetchInit,
        headers,
        credentials: 'include',
      });
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw makeNetworkError(`Failed to fetch ${method} ${path}`, cause);
    }

    if (response.status === HTTP_STATUS.NO_CONTENT) {
      if (responseSchema !== undefined) {
        return responseSchema.parse(undefined);
      }
      return undefined as T;
    }

    const responseHeaders = (response as { readonly headers?: Headers | undefined }).headers;
    const contentType = (responseHeaders?.get('content-type') ?? '').toLowerCase();
    if (response.ok && contentType.includes('text/csv')) {
      const headerMap: Record<string, string> = {};
      responseHeaders?.forEach((value, key) => {
        headerMap[key] = value;
      });
      const envelope = {
        status: response.status,
        wire: await response.text(),
        headers: headerMap,
      };
      if (responseSchema !== undefined) {
        return responseSchema.parse(envelope);
      }
      return envelope as T;
    }

    const rawData = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      if (requiresCsrf && !csrfRetried && isCsrfFailure(response.status, rawData)) {
        await fetchCsrfToken(baseUrl, fetcher, makeHttpError);
        return execute<T>(path, options, true, authRetried, requirementRetried);
      }

      const onUnauthorized = config.onUnauthorized ?? defaultOnUnauthorized;
      if (
        requiresAuth &&
        response.status === HTTP_STATUS.UNAUTHORIZED &&
        !authRetried &&
        onUnauthorized !== undefined &&
        (await onUnauthorized())
      ) {
        return execute<T>(path, options, csrfRetried, true, requirementRetried);
      }

      const errorBody = toErrorBody(rawData);
      if (
        response.status === HTTP_STATUS.FORBIDDEN &&
        !requirementRetried &&
        errorBody.code !== undefined &&
        isInterstitialRequirementCode(errorBody.code)
      ) {
        const satisfied = await runRequirementInterceptor(
          errorBody.code,
          errorBody.details ?? {},
          config.onRequirement,
        );
        if (satisfied) {
          return execute<T>(path, options, csrfRetried, authRetried, true);
        }
      }

      throw makeHttpError(response.status, errorBody);
    }

    if (responseSchema !== undefined) {
      return responseSchema.parse(rawData);
    }

    return rawData as T;
  };

  return {
    request<T = unknown>(path: string, options?: TransportRequestOptions<T>): Promise<T> {
      return execute<T>(path, options, false, false, false);
    },
  };
}
