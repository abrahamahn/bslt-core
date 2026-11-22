// main/kernel/react/src/query/useEndpoint.test.tsx
/**
 * @vitest-environment jsdom
 */

import {
  clearCsrfTokenCache,
  createEndpointClient,
  createTransport,
  QueryCache,
} from '@bslt/client-engine';
import { BadRequestError, defineModule, endpoint, NotFoundError } from '@bslt/contract';
import {
  array,
  boolean,
  number,
  object,
  optional,
  SchemaValidationError,
  string,
} from '@bslt/schema';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryCacheProvider } from './QueryCacheProvider';
import {
  endpointQueryKey,
  useEndpoint,
  useEndpointMutation,
  type UseEndpointMutationOptions,
  type UseEndpointOptions,
} from './useEndpoint';

import type { ReactNode } from 'react';

const taskSchema = object({
  id: string({ min: 1 }),
  title: string({ min: 1 }),
});

const tasksEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/api/tasks',
    auth: 'user',
    query: object({
      search: optional(string()),
    }),
    response: object({ tasks: array(taskSchema) }),
    persist: true,
    summary: 'List tasks',
  }),
  stats: endpoint({
    method: 'GET',
    path: '/api/tasks/stats',
    auth: 'user',
    response: object({ openCount: number() }),
    summary: 'Task stats',
  }),
  detail: endpoint({
    method: 'GET',
    path: '/api/tasks/:id',
    auth: 'user',
    params: object({ id: string({ min: 1 }) }),
    response: object({ task: taskSchema }),
    summary: 'Get task',
  }),
  create: endpoint({
    method: 'POST',
    path: '/api/tasks/create',
    auth: 'user',
    body: object({ title: string({ min: 1 }) }),
    response: object({ task: taskSchema, ok: boolean() }),
    invalidates: ['list'],
    summary: 'Create task',
  }),
} as const;

const tasksModule = defineModule({
  id: 'tasks',
  summary: 'Tasks test module',
  status: 'stable',
  dependsOn: [],
  endpoints: tasksEndpoints,
  events: {},
  jobs: {},
  tables: ['tasks'],
});

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const caches: QueryCache[] = [];

function createWrapper(cache = new QueryCache()) {
  caches.push(cache);
  return {
    cache,
    wrapper: ({ children }: { children: ReactNode }): ReactNode => (
      <QueryCacheProvider cache={cache}>{children}</QueryCacheProvider>
    ),
  };
}

afterEach(() => {
  cleanup();
  clearCsrfTokenCache();
  for (const cache of caches.splice(0)) {
    cache.destroy();
  }
});

describe('useEndpoint and useEndpointMutation', () => {
  it('surfaces typed NotFoundError on 404 and skips network when enabled is false', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse(404, { message: 'Task missing', code: 'tasks.NOT_FOUND' }));
    const client = createEndpointClient(
      tasksModule,
      createTransport({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const { wrapper } = createWrapper();

    const disabledOptions: UseEndpointOptions<typeof tasksEndpoints.list> = {
      enabled: false,
      retry: 0,
    };
    const { result: disabledResult } = renderHook(
      () => useEndpoint(client.list, undefined, disabledOptions),
      { wrapper },
    );
    expect(disabledResult.current.fetchStatus).toBe('idle');
    expect(fetchImpl).not.toHaveBeenCalled();

    const { result } = renderHook(
      () => useEndpoint(client.detail, { params: { id: 'missing-id' } }, { retry: 0 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(NotFoundError);
  });

  it('does not invalidate sibling queries when mutation fails with 400 or schema error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(400, { message: 'Title empty', code: 'VALIDATION_ERROR' }),
      )
      .mockResolvedValueOnce(mockResponse(200, { wrongShape: true }));
    const client = createEndpointClient(
      tasksModule,
      createTransport({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const { cache, wrapper } = createWrapper();

    cache.setQueryData(endpointQueryKey(client.list), { tasks: [{ id: '1', title: 'Existing' }] });
    expect(cache.getQueryState(endpointQueryKey(client.list))?.isInvalidated).toBe(false);

    const mutationOptions: UseEndpointMutationOptions<typeof tasksEndpoints.create> = {
      retry: 0,
    };
    const { result } = renderHook(() => useEndpointMutation(client.create, mutationOptions), {
      wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ body: { title: 'x' } })).rejects.toBeInstanceOf(
        BadRequestError,
      );
    });
    expect(cache.getQueryState(endpointQueryKey(client.list))?.isInvalidated).toBe(false);

    await act(async () => {
      await expect(result.current.mutateAsync({ body: { title: 'x' } })).rejects.toBeInstanceOf(
        SchemaValidationError,
      );
    });
    expect(cache.getQueryState(endpointQueryKey(client.list))?.isInvalidated).toBe(false);
  });

  it('normalizes endpointQueryKey and invalidates all sibling variants on mutation success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { tasks: [{ id: '1', title: 'First' }] }))
      .mockResolvedValueOnce(mockResponse(200, { task: { id: '2', title: 'Second' }, ok: true }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          tasks: [
            { id: '1', title: 'First' },
            { id: '2', title: 'Second' },
          ],
        }),
      );
    const client = createEndpointClient(
      tasksModule,
      createTransport({ baseUrl: 'https://api.example.com', fetchImpl }),
    );
    const { cache, wrapper } = createWrapper();

    expect(endpointQueryKey(client.list)).toEqual(['tasks', 'list']);
    expect(endpointQueryKey(client.list, {})).toEqual(['tasks', 'list']);
    expect(endpointQueryKey(client.list, { query: { search: 'ship' } })).toEqual([
      'tasks',
      'list',
      { query: { search: 'ship' } },
    ]);

    // Seed parameterized sibling and unrelated query to verify selective invalidation
    cache.setQueryData(['tasks', 'list', { query: { search: 'ship' } }], { tasks: [] });
    cache.setQueryData(endpointQueryKey(client.stats), { openCount: 1 });

    const { result: listHook } = renderHook(() => useEndpoint(client.list), { wrapper });
    await waitFor(() => {
      expect(listHook.current.isSuccess).toBe(true);
    });
    expect(listHook.current.data?.tasks).toHaveLength(1);

    const { result: createHook } = renderHook(() => useEndpointMutation(client.create), {
      wrapper,
    });

    await act(async () => {
      await createHook.current.mutateAsync({ body: { title: 'Second' } });
    });

    // Active `list` query refetches automatically; inactive parameterized `list` variant is marked invalidated; `stats` is untouched
    await waitFor(() => {
      expect(listHook.current.data?.tasks).toHaveLength(2);
    });
    expect(
      cache.getQueryState(['tasks', 'list', { query: { search: 'ship' } }])?.isInvalidated,
    ).toBe(true);
    expect(cache.getQueryState(endpointQueryKey(client.stats))?.isInvalidated).toBe(false);
  });
});
