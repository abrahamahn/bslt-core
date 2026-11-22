// main/kernel/server/src/http/routing.test.ts
/**
 * Tests for canonical Fastify route registration behavior.
 *
 * These assertions own the adapter contract for F4 so runtime and tooling
 * share one behavior surface.
 */

import { RequestSchemaError } from '@bslt/contract';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearRegistry,
  createRouteMap,
  getRegisteredRoutes,
  getRouteDefinition,
  protectedRoute,
  publicRoute,
  registerRouteMap,
  withRouteOptions,
  withRoutePreHandlers,
} from './index';

import type {
  HandlerContext,
  RouteHandler,
  RouteSchema,
  RouterOptions,
  ValidationSchema,
} from './index';

type MockRequest = {
  body?: unknown;
  context?: HandlerContext;
  url?: string;
  routeOptions: { url?: string; config?: unknown };
};

type MockReply = {
  sentStatus: number | null;
  sentBody: unknown;
  headers: Record<string, string>;
  statusCode: number;
  sent: boolean;
  elapsedTime?: number;
  status: (code: number) => { send: (data: unknown) => MockReply };
  send: (data: unknown) => MockReply;
  header: (name: string, value: string) => MockReply;
};

type MockOnSendHook = (request: MockRequest, reply: MockReply) => Promise<void> | void;

function createMockRequest(body?: unknown, url?: string): MockRequest {
  return {
    body,
    ...(url === undefined ? {} : { url }),
    routeOptions: url === undefined ? {} : { url },
  };
}

function createMockReply(): MockReply {
  const reply: MockReply = {
    sentStatus: null,
    sentBody: undefined,
    headers: {},
    statusCode: 200,
    sent: false,
    elapsedTime: 0,
    status(code: number) {
      reply.sentStatus = code;
      reply.statusCode = code;
      return {
        send(data: unknown) {
          reply.sentBody = data;
          reply.sent = true;
          return reply;
        },
      };
    },
    send(data: unknown) {
      reply.sentBody = data;
      reply.sent = true;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name] = value;
      return reply;
    },
  };

  return reply;
}

function createMockFastify(): {
  app: {
    route: ReturnType<typeof vi.fn>;
    addHook: ReturnType<typeof vi.fn>;
  };
  routes: Array<{
    method: string;
    url: string;
    handler: (req: MockRequest, reply: MockReply) => Promise<unknown>;
    preHandler?: unknown;
    schema?: Record<string, unknown>;
    bodyLimit?: number;
    config?: Record<string, unknown>;
  }>;
  onSendHooks: MockOnSendHook[];
} {
  const routes: Array<{
    method: string;
    url: string;
    handler: (req: MockRequest, reply: MockReply) => Promise<unknown>;
    preHandler?: unknown;
    schema?: Record<string, unknown>;
    bodyLimit?: number;
    config?: Record<string, unknown>;
  }> = [];
  const onSendHooks: MockOnSendHook[] = [];

  const app = {
    route: vi.fn((opts: Record<string, unknown>) => {
      routes.push(opts as (typeof routes)[number]);
    }),
    addHook: vi.fn((name: string, hook: MockOnSendHook) => {
      if (name === 'onSend') {
        onSendHooks.push(hook);
      }
    }),
  };

  return { app, routes, onSendHooks };
}

const mockCtx: HandlerContext = {
  db: {},
  repos: {},
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as unknown as HandlerContext;

const defaultOptions: RouterOptions = {
  prefix: '/api',
  jwtSecret: 'test-secret-that-is-at-least-32-chars-long',
  authGuardFactory: vi.fn((_secret: string, ..._roles: string[]) => vi.fn()),
};

describe('registerRouteMap', () => {
  let routes: ReturnType<typeof createMockFastify>['routes'];
  let onSendHooks: ReturnType<typeof createMockFastify>['onSendHooks'];
  let app: ReturnType<typeof createMockFastify>['app'];

  beforeEach(() => {
    const mock = createMockFastify();
    app = mock.app;
    routes = mock.routes;
    onSendHooks = mock.onSendHooks;
    clearRegistry();
    vi.clearAllMocks();
  });

  test('registers routes with correct URL prefix', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve({ ok: true }));
    const routeMap = createRouteMap([['health', publicRoute('GET', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes).toHaveLength(1);
    expect(routes[0]?.method).toBe('GET');
    expect(routes[0]?.url).toBe('/api/health');
  });

  test('normalizes double slashes in URL', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([['/users/', publicRoute('GET', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, {
      ...defaultOptions,
      prefix: '/api/',
    });

    expect(routes[0]?.url).toBe('/api/users/');
  });

  test('does not attach preHandler for public routes', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([['public', publicRoute('GET', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes[0]?.preHandler).toBeUndefined();
    expect(defaultOptions.authGuardFactory).not.toHaveBeenCalled();
  });

  test('attaches adapted preHandler from authGuardFactory for protected routes', async () => {
    const guard = vi.fn();
    const authFactory = vi.fn().mockReturnValue(guard);
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([['protected', protectedRoute('GET', handler, ['admin'])]]);

    registerRouteMap(app as never, mockCtx, routeMap, {
      ...defaultOptions,
      authGuardFactory: authFactory,
    });

    expect(authFactory).toHaveBeenCalledWith(defaultOptions.jwtSecret, 'admin');

    const registeredPreHandler = routes[0]?.preHandler as
      ((req: MockRequest, reply: MockReply) => Promise<void>) | undefined;

    expect(typeof registeredPreHandler).toBe('function');

    await registeredPreHandler?.(createMockRequest(), createMockReply());

    expect(guard).toHaveBeenCalledTimes(1);
  });

  test('attaches route-local preHandlers for public routes', async () => {
    const guard = vi.fn();
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      ['preview', withRoutePreHandlers(publicRoute('GET', handler), guard)],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const registeredPreHandler = routes[0]?.preHandler as
      ((req: MockRequest, reply: MockReply) => Promise<void>) | undefined;

    expect(typeof registeredPreHandler).toBe('function');
    expect(defaultOptions.authGuardFactory).not.toHaveBeenCalled();

    const reply = createMockReply();
    await registeredPreHandler?.(createMockRequest(), reply);

    expect(guard).toHaveBeenCalledTimes(1);
  });

  test('runs auth before route-local preHandlers on protected routes', async () => {
    const calls: string[] = [];
    const authGuard = vi.fn(() => {
      calls.push('auth');
    });
    const routeGuard = vi.fn(() => {
      calls.push('route');
    });
    const authFactory = vi.fn().mockReturnValue(authGuard);
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      ['protected', withRoutePreHandlers(protectedRoute('GET', handler, ['admin']), routeGuard)],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, {
      ...defaultOptions,
      authGuardFactory: authFactory,
    });

    const registeredPreHandler = routes[0]?.preHandler as
      ((req: MockRequest, reply: MockReply) => Promise<void>) | undefined;

    await registeredPreHandler?.(createMockRequest(), createMockReply());

    expect(calls).toEqual(['auth', 'route']);
  });

  test('validates body with safeParse schema and throws RequestSchemaError on failure', async () => {
    const handler: RouteHandler = vi.fn((_ctx, body) => Promise.resolve(body));
    const schema: ValidationSchema = {
      parse: vi.fn(),
      safeParse: vi.fn().mockReturnValue({ success: false, error: new Error('Invalid email') }),
    };
    const routeMap = createRouteMap([['create', publicRoute('POST', handler, schema)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    await expect(
      route.handler(createMockRequest({ email: 'bad' }), createMockReply()),
    ).rejects.toBeInstanceOf(RequestSchemaError);
    expect(schema.safeParse).toHaveBeenCalledWith({ email: 'bad' });
    expect(handler).not.toHaveBeenCalled();
  });

  test('passes validated data to handler on safeParse success', async () => {
    const validatedData = { email: 'valid@test.com', name: 'Test' };
    const handler: RouteHandler = vi.fn((_ctx, body) => Promise.resolve({ received: body }));
    const schema: ValidationSchema = {
      parse: vi.fn(),
      safeParse: vi.fn().mockReturnValue({ success: true, data: validatedData }),
    };
    const routeMap = createRouteMap([['create', publicRoute('POST', handler, schema)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const req = createMockRequest({ email: 'valid@test.com', name: 'Test' });
    const reply = createMockReply();
    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    await route.handler(req, reply);

    expect(handler).toHaveBeenCalledWith(mockCtx, validatedData, req, reply);
  });

  test('passes request-scoped context to handlers when present', async () => {
    const scopedCtx = { ...mockCtx, scoped: true } as HandlerContext;
    const handler: RouteHandler = vi.fn((ctx) => Promise.resolve(ctx));
    const routeMap = createRouteMap([['scoped', publicRoute('GET', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const request = createMockRequest();
    request.context = scopedCtx;
    const reply = createMockReply();
    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    const result = await route.handler(request, reply);

    expect(result).toBe(scopedCtx);
    expect(handler).toHaveBeenCalledWith(scopedCtx, undefined, request, reply);
  });

  test('handles { status, body } response pattern', async () => {
    const handler: RouteHandler = vi.fn(() =>
      Promise.resolve({ status: 201, body: { id: '123', created: true } }),
    );
    const routeMap = createRouteMap([['create', publicRoute('POST', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const reply = createMockReply();
    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    await route.handler(createMockRequest({}), reply);

    expect(reply.sentStatus).toBe(201);
    expect(reply.sentBody).toEqual({ id: '123', created: true });
  });

  test('returns raw result when not { status, body } pattern', async () => {
    const responseData = { items: [1, 2, 3] };
    const handler: RouteHandler = vi.fn(() => Promise.resolve(responseData));
    const routeMap = createRouteMap([['list', publicRoute('GET', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const reply = createMockReply();
    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    const result = await route.handler(createMockRequest(undefined), reply);

    expect(result).toEqual(responseData);
    expect(reply.sentStatus).toBeNull();
  });

  test('passes body through unvalidated when no schema', async () => {
    const handler: RouteHandler = vi.fn((_ctx, body) => Promise.resolve(body));
    const routeMap = createRouteMap([['no-schema', publicRoute('POST', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const rawBody = { anything: 'goes', nested: { deep: true } };
    const req = createMockRequest(rawBody);
    const reply = createMockReply();
    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    await route.handler(req, reply);

    expect(handler).toHaveBeenCalledWith(mockCtx, rawBody, req, reply);
  });

  test('handles non-Error safeParse error with generic RequestSchemaError', async () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const schema: ValidationSchema = {
      parse: vi.fn(),
      safeParse: vi.fn().mockReturnValue({ success: false, error: 'string error' }),
    };
    const routeMap = createRouteMap([['create', publicRoute('POST', handler, schema)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const reply = createMockReply();
    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    await expect(route.handler(createMockRequest({}), reply)).rejects.toBeInstanceOf(
      RequestSchemaError,
    );
    expect(reply.sentStatus).toBeNull();
    expect(reply.sentBody).toBeUndefined();
  });

  test('feeds route registry with metadata for each registered route', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const schema: ValidationSchema = { parse: vi.fn(), safeParse: vi.fn() };
    const routeMap = createRouteMap([
      ['auth/login', publicRoute('POST', handler, schema)],
      ['admin/users', protectedRoute('GET', handler, ['admin'])],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(getRegisteredRoutes()).toEqual([
      {
        path: '/api/auth/login',
        method: 'POST',
        isPublic: true,
        roles: [],
        hasSchema: true,
        module: 'auth',
        deprecated: false,
      },
      {
        path: '/api/admin/users',
        method: 'GET',
        isPublic: false,
        roles: ['admin'],
        hasSchema: false,
        module: 'admin',
        deprecated: false,
      },
    ]);
  });

  test('keeps the definition each registry entry was registered from', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const schema: ValidationSchema = { parse: vi.fn(), safeParse: vi.fn() };
    const login = publicRoute('POST', handler, schema);
    const routeMap = createRouteMap([
      ['auth/login', login],
      ['admin/users', protectedRoute('GET', handler, ['admin'])],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const [loginEntry, usersEntry] = getRegisteredRoutes();
    if (loginEntry === undefined || usersEntry === undefined) throw new Error('not registered');
    expect(getRouteDefinition(loginEntry)).toBe(login);
    expect(getRouteDefinition(loginEntry)?.schema).toBe(schema);
    expect(getRouteDefinition(usersEntry)?.schema).toBeUndefined();
    // The entry itself stays plain data: the admin manifest endpoint returns it as JSON.
    expect(Object.keys(loginEntry)).not.toContain('schema');
    expect(getRouteDefinition({ ...loginEntry })).toBeUndefined();
  });

  test('uses explicit module from options when provided', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([['health', publicRoute('GET', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, {
      ...defaultOptions,
      module: 'system',
    });

    expect(getRegisteredRoutes()[0]?.module).toBe('system');
  });

  test('hands Fastify only the body, params, querystring and response it enforces', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      [
        'health',
        publicRoute('GET', handler, undefined, {
          summary: 'Health check',
          tags: ['system'],
          response: {
            200: { type: 'object', properties: { status: { type: 'string' } } },
          },
        }),
      ],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes[0]?.schema?.['response']).toBeDefined();
    expect(routes[0]?.schema?.['summary']).toBeUndefined();
    expect(routes[0]?.schema?.['tags']).toBeUndefined();
  });

  test('leaves a protected route without a declared schema schema-less', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([['admin', protectedRoute('GET', handler, ['admin'])]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes[0]?.schema).toBeUndefined();
  });

  test('applies deprecation headers through the onSend hook', async () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      [
        'legacy',
        {
          ...publicRoute('GET', handler),
          deprecated: {
            sunset: '2026-12-31',
            message: 'Use /api/v2/legacy instead',
          },
        },
      ],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const reply = createMockReply();
    const request = createMockRequest(undefined, '/api/legacy');
    const hook = onSendHooks[0];
    if (hook === undefined) throw new Error('onSend hook not registered');

    await hook(request, reply);

    expect(reply.headers).toEqual({
      Deprecation: 'true',
      Sunset: '2026-12-31',
      'X-Deprecation-Notice': 'Use /api/v2/legacy instead',
    });
  });

  test('concurrent handler calls do not share mutable state', async () => {
    const handler: RouteHandler = vi.fn((_ctx, body) => Promise.resolve(body));
    const routeMap = createRouteMap([['concurrent', publicRoute('POST', handler)]]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const route = routes[0];
    if (route === undefined) throw new Error('Route not registered');

    const [r1, r2] = await Promise.all([
      route.handler(createMockRequest({ n: 1 }), createMockReply()),
      route.handler(createMockRequest({ n: 2 }), createMockReply()),
    ]);

    expect(r1).toEqual({ n: 1 });
    expect(r2).toEqual({ n: 2 });
  });

  test('handles null and undefined handler results gracefully', async () => {
    const nullHandler: RouteHandler = vi.fn(() => Promise.resolve(null));
    const undefinedHandler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      ['null-route', publicRoute('GET', nullHandler)],
      ['void-route', publicRoute('GET', undefinedHandler)],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    const reply1 = createMockReply();
    const reply2 = createMockReply();
    const route1 = routes[0];
    const route2 = routes[1];
    if (route1 === undefined || route2 === undefined) {
      throw new Error('Routes not registered');
    }

    const r1 = await route1.handler(createMockRequest(undefined), reply1);
    const r2 = await route2.handler(createMockRequest(undefined), reply2);

    expect(r1).toBeNull();
    expect(r2).toBeUndefined();
    expect(reply1.sentStatus).toBeNull();
    expect(reply2.sentStatus).toBeNull();
  });

  test('hands Fastify the injection-filter opt-out as route config, on that route only', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      [
        'reports',
        withRouteOptions(publicRoute('POST', handler), {
          bodyLimit: 1024,
          skipBodyInjectionFilter: true,
        }),
      ],
      ['other', publicRoute('POST', handler)],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes[0]?.bodyLimit).toBe(1024);
    expect(routes[0]?.config).toEqual({ skipBodyInjectionFilter: true });
    expect(routes[1]?.config).toBeUndefined();
  });

  test('hands Fastify rawBody and webhookVerified config flags on signed webhook routes only', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const routeMap = createRouteMap([
      [
        'webhooks/stripe',
        withRouteOptions(publicRoute('POST', handler), {
          rawBody: true,
          webhookVerified: true,
          skipBodyInjectionFilter: true,
        }),
      ],
      ['checkout', publicRoute('POST', handler)],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes[0]?.config).toEqual({
      rawBody: true,
      webhookVerified: true,
      skipBodyInjectionFilter: true,
    });
    expect(routes[1]?.config).toBeUndefined();
  });

  test('registers FastifySchema on routes with properties key', () => {
    const handler: RouteHandler = vi.fn(() => Promise.resolve(undefined));
    const fastifySchema = {
      properties: { body: { type: 'object' } },
    } as unknown as RouteSchema;
    const routeMap = createRouteMap([
      ['schema-route', publicRoute('POST', handler, fastifySchema)],
    ]);

    registerRouteMap(app as never, mockCtx, routeMap, defaultOptions);

    expect(routes[0]?.schema).toStrictEqual(fastifySchema);
  });
});
