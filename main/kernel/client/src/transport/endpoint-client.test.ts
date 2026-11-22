// main/kernel/client/src/transport/endpoint-client.test.ts
import {
  BadRequestError,
  defineModule,
  emptyBodySchema,
  endpoint,
  NotFoundError,
} from '@bslt/contract';
import { boolean, number, object, optional, SchemaValidationError, string } from '@bslt/schema';
import { describe, expect, it, vi } from 'vitest';

import {
  createEndpointClient,
  createPersistAllowlist,
  type EndpointCall,
  type EndpointCallMeta,
  type EndpointClient,
  type EndpointClientInput,
} from './endpoint-client';
import { createTransport } from './transport';

const itemSchema = object({
  id: string({ min: 1 }),
  title: string({ min: 1 }),
});

const testEndpoints = {
  list: endpoint({
    method: 'GET',
    path: '/api/items',
    auth: 'user',
    query: object({
      limit: optional(number()),
      search: optional(string()),
    }),
    response: object({ items: object({ count: number() }) }),
    persist: true,
    summary: 'List items',
  }),
  publicPing: endpoint({
    method: 'GET',
    path: '/api/items/ping',
    auth: 'public',
    response: object({ ok: boolean() }),
    summary: 'Public health ping',
  }),
  update: endpoint({
    method: 'POST',
    path: '/api/items/:id/update',
    auth: 'user',
    params: object({ id: string({ min: 1 }) }),
    body: object({ title: string({ min: 1 }) }),
    response: itemSchema,
    invalidates: ['list'],
    summary: 'Update item',
  }),
  remove: endpoint({
    method: 'POST',
    path: '/api/items/:id/delete',
    auth: 'user',
    params: object({ id: string({ min: 1 }) }),
    body: emptyBodySchema,
    response: object({ deleted: boolean() }),
    invalidates: ['list'],
    summary: 'Delete item',
  }),
} as const;

const testModule = defineModule({
  id: 'items',
  summary: 'Test items module',
  status: 'stable',
  dependsOn: [],
  endpoints: testEndpoints,
  events: {},
  jobs: {},
  tables: ['items'],
});

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('createEndpointClient', () => {
  it('throws synchronously when a required :param segment is missing or empty', async () => {
    const fetchImpl = vi.fn();
    const transport = createTransport({ baseUrl: 'https://api.example.com', fetchImpl });
    const client: EndpointClient<'items', typeof testEndpoints> = createEndpointClient(
      testModule,
      transport,
    );

    const emptyParamInput: EndpointClientInput<typeof testEndpoints.remove> = {
      params: { id: '' },
    };
    await expect(client.remove(emptyParamInput)).rejects.toThrow(/Missing path parameter "id"/u);
    await expect(client.remove({ params: {} as { id: string } })).rejects.toThrow(
      /Missing path parameter "id"/u,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates typed HTTP errors (404 NotFoundError, 400 BadRequestError) from transport', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(404, { message: 'Item gone', code: 'items.NOT_FOUND' }))
      .mockResolvedValueOnce(
        mockResponse(400, { message: 'Title empty', code: 'VALIDATION_ERROR' }),
      );
    const transport = createTransport({ baseUrl: 'https://api.example.com', fetchImpl });
    const client = createEndpointClient(testModule, transport);

    await expect(client.remove({ params: { id: 'item-1' } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      client.update({ params: { id: 'item-1' }, body: { title: 'x' } }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects with SchemaValidationError when server response violates endpoint.response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, { ok: 'not-a-boolean' }));
    const transport = createTransport({ baseUrl: 'https://api.example.com', fetchImpl });
    const client = createEndpointClient(testModule, transport);

    await expect(client.publicPing()).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('denies IndexedDB persistence by default unless endpoint declares persist: true', () => {
    const isAllowed = createPersistAllowlist([testModule]);

    expect(isAllowed(['items', 'publicPing', {}])).toBe(false);
    expect(isAllowed(['items', 'update', {}])).toBe(false);
    expect(isAllowed(['items', 'unknownEndpoint'])).toBe(false);
    expect(isAllowed(['items'])).toBe(false);
    expect(isAllowed(['items', 'list', {}])).toBe(true);
    // Legacy non-module query keys return undefined so caller can apply legacy policy
    expect(isAllowed(['legacyDomain', 'something'])).toBeUndefined();
  });

  it('interpolates encoded :params, serializes sorted query strings, sends {} for emptyBodySchema, and exposes metadata', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, { items: { count: 2 } }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }))
      .mockResolvedValueOnce(mockResponse(200, { deleted: true }));

    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
      getToken: () => 'jwt-token',
    });
    const client = createEndpointClient(testModule, transport);

    const listCall: EndpointCall<'items', 'list', typeof testEndpoints.list> = client.list;
    const listMeta: EndpointCallMeta<'items', 'list', typeof testEndpoints.list> = listCall;
    expect(listMeta.moduleId).toBe('items');
    expect(listMeta.endpointName).toBe('list');
    expect(listMeta.endpoint).toBe(testEndpoints.list);

    const listRes = await client.list({ query: { search: 'a b', limit: undefined } });
    expect(listRes).toEqual({ items: { count: 2 } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.com/api/items?search=a+b');
    expect(
      ((fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer jwt-token');

    const pingRes = await client.publicPing();
    expect(pingRes).toEqual({ ok: true });
    expect(
      ((fetchImpl.mock.calls[1]?.[1] as RequestInit).headers as Headers).has('Authorization'),
    ).toBe(false);

    const delRes = await client.remove({ params: { id: 'a/b' } });
    expect(delRes).toEqual({ deleted: true });
    expect(fetchImpl.mock.calls[2]?.[0]).toBe('https://api.example.com/api/items/a%2Fb/delete');
    expect((fetchImpl.mock.calls[2]?.[1] as RequestInit).body).toBe('{}');
  });

  it('forwards per-call request headers (such as x-sudo-token) and rejects forbidden responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(403, { message: 'Sudo required', code: 'identity.SUDO_REQUIRED' }),
      )
      .mockResolvedValueOnce(
        mockResponse(403, { message: 'Sudo expired', code: 'identity.SUDO_EXPIRED' }),
      )
      .mockResolvedValueOnce(mockResponse(200, { deleted: true }));

    const transport = createTransport({
      baseUrl: 'https://api.example.com',
      fetchImpl,
      getToken: () => 'jwt-token',
    });
    const client = createEndpointClient(testModule, transport);

    await expect(client.remove({ params: { id: 'item-1' } })).rejects.toThrow('Sudo required');
    await expect(
      client.remove({ params: { id: 'item-1' } }, { headers: { 'x-sudo-token': 'expired-sudo' } }),
    ).rejects.toThrow('Sudo expired');

    const res = await client.remove(
      { params: { id: 'item-1' } },
      { headers: { 'x-sudo-token': 'valid-sudo-jwt' } },
    );
    expect(res).toEqual({ deleted: true });
    const sentHeaders = (fetchImpl.mock.calls[2]?.[1] as RequestInit).headers as Headers;
    expect(sentHeaders.get('x-sudo-token')).toBe('valid-sudo-jwt');
    expect(sentHeaders.get('authorization')).toBe('Bearer jwt-token');
  });
});
