// main/kernel/client/src/transport/transport.test.ts
import {
  AppError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  TooManyRequestsError,
  UnprocessableError,
} from '@bslt/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearCsrfTokenCache,
  clearRequirementHandlers,
  createTransport,
  getTransportCsrfToken,
  isHttpStatusError,
  registerRequirementHandler,
  setDefaultOnUnauthorized,
  setDefaultTenantIdGetter,
  type RequirementInterceptor,
  type RequirementInterceptorHandler,
  type Transport,
  type TransportConfig,
  type TransportErrorBody,
  type TransportRequestOptions,
} from './transport';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function headersOf(call: readonly unknown[]): Headers {
  return (call[1] as RequestInit).headers as Headers;
}

afterEach(() => {
  clearCsrfTokenCache();
  clearRequirementHandlers();
  setDefaultOnUnauthorized(undefined);
  setDefaultTenantIdGetter(undefined);
});

describe('createTransport', () => {
  it('maps HTTP failure statuses to canonical @bslt/shared/system error classes', async () => {
    const cases: ReadonlyArray<{
      readonly status: number;
      readonly body: TransportErrorBody;
      readonly expected: new (...args: never[]) => AppError;
    }> = [
      {
        status: 400,
        body: { message: 'Bad input', code: 'VALIDATION_ERROR' },
        expected: BadRequestError,
      },
      {
        status: 401,
        body: { message: 'Missing token', code: 'UNAUTHORIZED' },
        expected: AuthenticationError,
      },
      { status: 403, body: { message: 'Denied', code: 'FORBIDDEN' }, expected: ForbiddenError },
      {
        status: 404,
        body: { message: 'Missing task', code: 'tasks.TASK_NOT_FOUND' },
        expected: NotFoundError,
      },
      { status: 409, body: { message: 'Duplicate', code: 'CONFLICT' }, expected: ConflictError },
      {
        status: 422,
        body: { message: 'Invalid entity', code: 'UNPROCESSABLE' },
        expected: UnprocessableError,
      },
      {
        status: 502,
        body: { message: 'Bad gateway', code: 'UPSTREAM_DOWN' },
        expected: InternalError,
      },
      { status: 418, body: { message: 'Teapot', code: 'TEAPOT' }, expected: AppError },
    ];

    for (const testCase of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(mockResponse(testCase.status, testCase.body));
      const transport: Transport = createTransport({
        baseUrl: 'https://api.example.com/',
        fetchImpl,
      });

      await expect(transport.request('/items')).rejects.toBeInstanceOf(testCase.expected);
    }

    const rateLimitFetch = vi.fn().mockResolvedValue(
      mockResponse(429, {
        message: 'Locked',
        lockReason: 'too_many_attempts',
        lockedUntil: '2026-12-01T00:00:00.000Z',
      }),
    );
    const rateLimitTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: rateLimitFetch,
    });
    await expect(rateLimitTransport.request('/login')).rejects.toMatchObject({
      message: 'Locked',
      lockReason: 'too_many_attempts',
      lockedUntil: '2026-12-01T00:00:00.000Z',
    });
    await expect(rateLimitTransport.request('/login')).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('wraps fetch rejections in a network AppError or custom createNetworkError', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('socket hang up'))
      .mockRejectedValueOnce('raw string failure');

    const defaultTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });

    await expect(defaultTransport.request('/tasks')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Failed to fetch GET /tasks',
    });
    await expect(defaultTransport.request('/tasks')).rejects.toBeInstanceOf(AppError);

    class CustomNetworkError extends Error {
      constructor(
        message: string,
        public readonly causeError: Error,
      ) {
        super(message);
      }
    }
    const customConfig: TransportConfig = {
      baseUrl: 'https://api.example.com',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
      createNetworkError: (msg, cause) => new CustomNetworkError(msg, cause),
      createHttpError: (status, body) =>
        new Error(`custom-${String(status)}-${body.message ?? ''}`),
    };
    const customTransport = createTransport(customConfig);
    await expect(customTransport.request('/tasks')).rejects.toBeInstanceOf(CustomNetworkError);
  });

  it('does not retry 401 when onUnauthorized is absent, returns false, or requiresAuth is false', async () => {
    const noHookFetch = vi.fn().mockResolvedValue(mockResponse(401, { message: 'Unauthorized' }));
    const noHook = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: noHookFetch,
      getToken: () => 'stale',
    });
    await expect(noHook.request('/me')).rejects.toBeInstanceOf(AuthenticationError);
    expect(noHookFetch).toHaveBeenCalledTimes(1);

    const falseHookFetch = vi
      .fn()
      .mockResolvedValue(mockResponse(401, { message: 'Unauthorized' }));
    const onUnauthorizedFalse = vi.fn(async () => false);
    const falseHook = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: falseHookFetch,
      getToken: () => 'stale',
      onUnauthorized: onUnauthorizedFalse,
    });
    await expect(falseHook.request('/me')).rejects.toBeInstanceOf(AuthenticationError);
    expect(onUnauthorizedFalse).toHaveBeenCalledTimes(1);
    expect(falseHookFetch).toHaveBeenCalledTimes(1);

    const publicFetch = vi.fn().mockResolvedValue(mockResponse(401, { message: 'Unauthorized' }));
    const onUnauthorizedPublic = vi.fn(async () => true);
    const publicTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: publicFetch,
      onUnauthorized: onUnauthorizedPublic,
    });
    const opts: TransportRequestOptions<unknown> = { requiresAuth: false };
    await expect(publicTransport.request('/public', opts)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(onUnauthorizedPublic).not.toHaveBeenCalled();
  });

  it('retries at most once on 401 even when refreshed request still returns 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(401, { message: 'Still expired' }));
    const onUnauthorized = vi.fn(async () => true);
    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
      getToken: () => 'tok',
      onUnauthorized,
    });

    await expect(transport.request('/me')).rejects.toBeInstanceOf(AuthenticationError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects when CSRF token endpoint fails or second mutating attempt still fails CSRF', async () => {
    const brokenCsrfFetch = vi.fn().mockResolvedValue(mockResponse(500, { message: 'CSRF down' }));
    await expect(
      getTransportCsrfToken({ baseUrl: 'https://api.example.com', fetchImpl: brokenCsrfFetch }),
    ).rejects.toBeInstanceOf(InternalError);

    const emptyCsrfFetch = vi.fn().mockResolvedValue(mockResponse(200, { token: '' }));
    await expect(
      getTransportCsrfToken({ baseUrl: 'https://api.example.com', fetchImpl: emptyCsrfFetch }),
    ).rejects.toBeInstanceOf(BadRequestError);

    const doubleCsrfFail = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(403, { message: 'Invalid CSRF token' }))
      .mockResolvedValueOnce(mockResponse(200, { token: 'csrf-1' }))
      .mockResolvedValueOnce(mockResponse(403, { message: 'Invalid CSRF token' }));
    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: doubleCsrfFail,
    });

    await expect(
      transport.request('/tasks/create', { method: 'POST', body: '{}' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(doubleCsrfFail).toHaveBeenCalledTimes(3);
  });

  it('rejects when responseSchema.parse rejects malformed server payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, { wrong: true }));
    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });

    await expect(
      transport.request('/tasks', {
        responseSchema: {
          parse: () => {
            throw new Error('Schema mismatch');
          },
        },
      }),
    ).rejects.toThrow('Schema mismatch');
  });

  it('refreshes on 401 via default fallback, attaches x-tenant-id via default getter, and caches CSRF', async () => {
    let token = 'stale-token';
    setDefaultOnUnauthorized(async () => {
      token = 'fresh-token';
      return true;
    });
    setDefaultTenantIdGetter(() => 'org-123');

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(403, { message: 'CSRF token missing' }))
      .mockResolvedValueOnce(mockResponse(200, { token: 'csrf-shared' }))
      .mockResolvedValueOnce(mockResponse(401, { message: 'Token expired' }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const transport = createTransport({
      baseUrl: 'https://api.example.com///',
      fetchImpl,
      getToken: () => token,
    });

    const result = await transport.request<{ ok: boolean }>('/api/tasks/create', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test' }),
      rawApiPath: true,
    });

    expect(result).toEqual({ ok: true });
    // 1: initial POST (403 csrf) -> 2: GET /api/csrf-token -> 3: retry POST (401) -> 4: retry POST after refresh (200)
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.com/api/tasks/create');
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://api.example.com/api/csrf-token');

    const finalHeaders = headersOf(fetchImpl.mock.calls[3]!);
    expect(finalHeaders.get('Authorization')).toBe('Bearer fresh-token');
    expect(finalHeaders.get('x-tenant-id')).toBe('org-123');
    expect(finalHeaders.get('x-csrf-token')).toBe('csrf-shared');
    expect(finalHeaders.get('Content-Type')).toBe('application/json');

    // Shared cache returns token without another network call
    const cached = await getTransportCsrfToken({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });
    expect(cached).toBe('csrf-shared');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('handles 204 No Content and omits Content-Type for FormData bodies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(204, undefined));
    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
      getTenantId: () => 'explicit-org',
    });

    const form = new FormData();
    form.append('file', 'hello');
    const res = await transport.request<undefined>('/upload', {
      method: 'POST',
      body: form,
    });

    expect(res).toBeUndefined();
    const headers = headersOf(fetchImpl.mock.calls[0]!);
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.get('x-tenant-id')).toBe('explicit-org');
  });

  it("forwards the caller's abort signal to fetch", async () => {
    // The capability provider bounds each context request with this signal; a
    // transport that dropped it would leave a hung request unbounded.
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, {}));
    const transport = createTransport({ baseUrl: 'https://api.example.com', fetchImpl });
    const controller = new AbortController();

    await transport.request('/api/platform/context', {
      method: 'GET',
      rawApiPath: true,
      signal: controller.signal,
    });

    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
  });

  it('checks HTTP error status codes via isHttpStatusError without leaking non-matching errors', () => {
    expect(isHttpStatusError(new NotFoundError('missing', 'tasks.TASK_NOT_FOUND'), 404)).toBe(true);
    expect(isHttpStatusError(new NotFoundError('missing', 'tasks.TASK_NOT_FOUND'), 400)).toBe(
      false,
    );
    expect(isHttpStatusError({ statusCode: 404, message: 'custom' }, 404)).toBe(true);
    expect(isHttpStatusError({ statusCode: '404' }, 404)).toBe(false);
    expect(isHttpStatusError(new Error('network boom'), 500)).toBe(false);
    expect(isHttpStatusError(null, 404)).toBe(false);
    expect(isHttpStatusError(undefined, 404)).toBe(false);
  });

  it('deduplicates trailing /api on baseUrl for both rawApiPath and standard paths while preserving HTTP errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { tasks: [] }))
      .mockResolvedValueOnce(mockResponse(404, { message: 'Missing', code: 'NOT_FOUND' }))
      .mockResolvedValueOnce(mockResponse(400, { message: 'Bad', code: 'BAD_REQUEST' }));

    const transport = createTransport({
      baseUrl: 'http://localhost:3000/api/',
      fetchImpl,
    });

    await expect(transport.request('/api/tasks', { rawApiPath: true })).resolves.toEqual({
      tasks: [],
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/tasks');

    await expect(transport.request('/api/api-keys', { rawApiPath: true })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('http://localhost:3000/api/api-keys');

    const rootApiTransport = createTransport({
      baseUrl: '/api',
      fetchImpl,
    });
    await expect(rootApiTransport.request('/tasks')).rejects.toBeInstanceOf(BadRequestError);
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('/api/tasks');
  });

  it('intercepts 403 requirement codes via registered module handlers or per-transport onRequirement and retries at most once', async () => {
    const tosHandler: RequirementInterceptorHandler = vi.fn(async (details) => {
      expect(details).toEqual({
        requirement: 'tos.accepted',
        documentId: 'doc-1',
        requiredVersion: 2,
      });
      return Promise.resolve(true);
    });
    const unregisterTos = registerRequirementHandler('TOS_ACCEPTANCE_REQUIRED', tosHandler);

    const retrySuccessFetch = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(403, {
          code: 'TOS_ACCEPTANCE_REQUIRED',
          message: 'Accept ToS',
          details: { requirement: 'tos.accepted', documentId: 'doc-1', requiredVersion: 2 },
        }),
      )
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: retrySuccessFetch,
    });
    await expect(transport.request('/tasks')).resolves.toEqual({ ok: true });
    expect(tosHandler).toHaveBeenCalledTimes(1);
    expect(retrySuccessFetch).toHaveBeenCalledTimes(2);

    // Failure 1: retries at most once even if second attempt still returns 403 requirement code
    const double403Fetch = vi.fn().mockResolvedValue(
      mockResponse(403, {
        code: 'TOS_ACCEPTANCE_REQUIRED',
        message: 'Still gated',
        details: { requirement: 'tos.accepted', documentId: 'doc-1', requiredVersion: 2 },
      }),
    );
    const doubleTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: double403Fetch,
    });
    await expect(doubleTransport.request('/tasks')).rejects.toMatchObject({
      statusCode: 403,
      code: 'TOS_ACCEPTANCE_REQUIRED',
      details: { requirement: 'tos.accepted', documentId: 'doc-1', requiredVersion: 2 },
    });
    expect(double403Fetch).toHaveBeenCalledTimes(2);

    // Failure 2: unregistering handler stops interception and surfaces ForbiddenError with details
    unregisterTos();
    const unhandledFetch = vi.fn().mockResolvedValue(
      mockResponse(403, {
        code: 'TOS_ACCEPTANCE_REQUIRED',
        message: 'Accept ToS',
        details: { documentId: 'doc-1' },
      }),
    );
    const unhandledTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: unhandledFetch,
    });
    await expect(unhandledTransport.request('/tasks')).rejects.toBeInstanceOf(ForbiddenError);
    expect(unhandledFetch).toHaveBeenCalledTimes(1);

    // Failure 3: handler returning false (e.g. user dismissed modal) does not retry and surfaces 403
    const onRequirementFalse: RequirementInterceptor = vi.fn(async (code) => {
      expect(code).toBe('AGE_ASSURANCE_REQUIRED');
      return Promise.resolve(false);
    });
    const dismissedFetch = vi.fn().mockResolvedValue(
      mockResponse(403, {
        code: 'AGE_ASSURANCE_REQUIRED',
        message: 'Age assurance required',
        details: { requirement: 'age.verified:18' },
      }),
    );
    const customTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: dismissedFetch,
      onRequirement: onRequirementFalse,
    });
    await expect(customTransport.request('/adult')).rejects.toMatchObject({
      statusCode: 403,
      code: 'AGE_ASSURANCE_REQUIRED',
    });
    expect(onRequirementFalse).toHaveBeenCalledTimes(1);
    expect(dismissedFetch).toHaveBeenCalledTimes(1);

    // Failure 4: ordinary 403 FORBIDDEN never invokes requirement interceptor
    const ordinary403Fetch = vi.fn().mockResolvedValue(
      mockResponse(403, {
        code: 'FORBIDDEN',
        message: 'Insufficient role',
      }),
    );
    const ordinaryTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: ordinary403Fetch,
      onRequirement: onRequirementFalse,
    });
    await expect(ordinaryTransport.request('/admin')).rejects.toBeInstanceOf(ForbiddenError);
    expect(onRequirementFalse).toHaveBeenCalledTimes(1);
  });

  it('parses text/csv 200 responses into a validated { status, wire, headers } envelope while rejecting schema mismatches', async () => {
    const csvResponse = new Response('# profile\nid,email\n1,a@b.test\n', {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="data-export-1.csv"',
      },
    });
    const fetchImpl = vi.fn().mockResolvedValueOnce(csvResponse);
    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
    });

    const parsed = await transport.request<{
      readonly status: number;
      readonly wire: string;
      readonly headers: Record<string, string>;
    }>('/users/me/export/1/download');

    expect(parsed.status).toBe(200);
    expect(parsed.wire).toBe('# profile\nid,email\n1,a@b.test\n');
    expect(parsed.headers['content-type']).toContain('text/csv');

    // Schema failure on text/csv envelope propagates instead of silently swallowing
    const badSchemaResponse = new Response('col1,col2\n', {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    });
    const strictFetch = vi.fn().mockResolvedValueOnce(badSchemaResponse);
    const strictTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: strictFetch,
    });
    await expect(
      strictTransport.request('/users/me/export/1/download', {
        responseSchema: {
          parse: () => {
            throw new Error('Unexpected text envelope');
          },
        } as never,
      }),
    ).rejects.toThrow('Unexpected text envelope');

    // Non-CSV text/plain responses (such as default new Response('invalid json')) are NOT wrapped as CSV envelopes
    const plainResponse = new Response('invalid json', { status: 200 });
    const plainFetch = vi.fn().mockResolvedValueOnce(plainResponse);
    const plainTransport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl: plainFetch,
    });
    await expect(plainTransport.request('/settings')).resolves.toEqual({});
  });
});
