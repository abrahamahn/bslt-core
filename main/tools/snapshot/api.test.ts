// main/tools/snapshot/api.test.ts
import { existsSync } from 'node:fs';

import { createRouteMap, protectedRoute, registerRouteMap } from '@bslt/server-system/http';
import { describe, expect, it } from 'vitest';

import { repoPath } from '../lib/paths';

import {
  API_SNAPSHOT,
  buildApiSnapshot,
  describeApiRoutes,
  type ApiRoute,
  type ContractEndpoint,
  type RegisteredRoute,
} from './api';
import { checkSnapshot } from './snapshot-file';

interface ApiSnapshotFile {
  readonly generated: string;
  readonly composedFor: Readonly<Record<string, unknown>>;
  readonly routes: readonly ApiRoute[];
}

function parse(text: string): ApiSnapshotFile {
  return JSON.parse(text) as ApiSnapshotFile;
}

function route(file: ApiSnapshotFile, method: string, path: string): ApiRoute {
  const found = file.routes.find((entry) => entry.method === method && entry.path === path);
  if (found === undefined) throw new Error(`no ${method} ${path} in the snapshot`);
  return found;
}

const loginSchema = { parse: () => null, safeParse: () => ({ success: true }) };
const otherSchema = { parse: () => null, safeParse: () => ({ success: true }) };

function registered(overrides: Partial<RegisteredRoute> = {}): RegisteredRoute {
  return {
    method: 'POST',
    path: '/api/auth/login',
    module: 'auth',
    isPublic: true,
    roles: [],
    deprecated: false,
    schema: loginSchema,
    preHandlers: [],
    bodyLimit: null,
    ...overrides,
  };
}

const LOGIN_CONTRACT: ContractEndpoint = {
  id: 'auth.login',
  method: 'POST',
  path: '/api/auth/login',
  schemas: { body: loginSchema, responses: { '200': otherSchema } },
  source: {
    body: 'loginRequestSchema',
    query: null,
    pathParams: null,
    responses: { '200': 'loginSuccessResponseSchema' },
  },
};

describe('describeApiRoutes', () => {
  it('joins a served route with its registration and its contract', () => {
    const routes = describeApiRoutes({
      served: [{ method: 'POST', url: '/api/auth/login' }],
      registered: [registered()],
      contracts: [LOGIN_CONTRACT],
    });

    expect(routes).toEqual([
      {
        method: 'POST',
        path: '/api/auth/login',
        registeredBy: 'route-map',
        module: 'auth',
        auth: 'public',
        roles: [],
        deprecated: false,
        bodyLimit: null,
        preHandlers: [],
        request: 'loginRequestSchema',
        contract: {
          endpoint: 'auth.login',
          body: 'loginRequestSchema',
          query: null,
          pathParams: null,
          responses: { '200': 'loginSuccessResponseSchema' },
        },
      },
    ]);
  });

  it('records the role requirement of a protected route', () => {
    const [anyUser, admin] = describeApiRoutes({
      served: [
        { method: 'GET', url: '/api/a' },
        { method: 'GET', url: '/api/b' },
      ],
      registered: [
        registered({ method: 'GET', path: '/api/a', isPublic: false, schema: undefined }),
        registered({
          method: 'GET',
          path: '/api/b',
          isPublic: false,
          roles: ['owner', 'admin'],
          schema: undefined,
        }),
      ],
      contracts: [],
    });

    expect(anyUser).toMatchObject({ auth: 'authenticated', roles: [], request: null });
    expect(admin).toMatchObject({ auth: 'role', roles: ['admin', 'owner'], contract: null });
  });

  it('lists a route the server registered outside the route maps, with nothing declared', () => {
    const routes = describeApiRoutes({
      served: [{ method: 'POST', url: '/api/webhooks/stripe' }],
      registered: [],
      contracts: [],
    });

    expect(routes).toEqual([
      {
        method: 'POST',
        path: '/api/webhooks/stripe',
        registeredBy: 'server',
        module: null,
        auth: 'undeclared',
        roles: [],
        deprecated: false,
        bodyLimit: null,
        preHandlers: [],
        request: null,
        contract: null,
      },
    ]);
  });

  it('folds the HEAD route Fastify adds for a GET into the GET row', () => {
    const routes = describeApiRoutes({
      served: [
        { method: 'GET', url: '/api/a' },
        { method: 'HEAD', url: '/api/a' },
        { method: 'GET', url: '/api/b' },
        { method: 'HEAD', url: '/api/only-head' },
      ],
      registered: [],
      contracts: [],
    });

    expect(routes.map((entry) => [entry.method, entry.path, entry.head])).toEqual([
      ['GET', '/api/a', true],
      ['GET', '/api/b', false],
      ['HEAD', '/api/only-head', undefined],
    ]);
  });

  it('sorts by path, then method, whatever the registration order', () => {
    const served = [
      { method: 'POST', url: '/api/b' },
      { method: 'GET', url: '/api/b' },
      { method: 'DELETE', url: '/api/a/:id' },
      { method: 'GET', url: '/api/a' },
    ];

    const forward = describeApiRoutes({ served, registered: [], contracts: [] });
    const backward = describeApiRoutes({
      served: [...served].reverse(),
      registered: [],
      contracts: [],
    });

    expect(forward).toEqual(backward);
    expect(forward.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'GET /api/a',
      'DELETE /api/a/:id',
      'GET /api/b',
      'POST /api/b',
    ]);
  });

  it('names the schema a route validates with, also when it is not its contract body', () => {
    const [entry] = describeApiRoutes({
      served: [{ method: 'POST', url: '/api/auth/login' }],
      registered: [registered({ schema: otherSchema })],
      contracts: [LOGIN_CONTRACT],
    });
    expect(entry?.request).toBe('loginSuccessResponseSchema');
    expect(entry?.contract?.body).toBe('loginRequestSchema');

    const [unknown] = describeApiRoutes({
      served: [{ method: 'POST', url: '/api/auth/login' }],
      registered: [registered({ schema: { parse: () => null, safeParse: () => null } })],
      contracts: [LOGIN_CONTRACT],
    });
    expect(unknown?.request).toBe('(a schema no contract declares)');
  });

  it('matches a contract whose path names its parameters differently', () => {
    const [entry] = describeApiRoutes({
      served: [{ method: 'POST', url: '/api/items/:itemId/update' }],
      registered: [],
      contracts: [
        { ...LOGIN_CONTRACT, id: 'items.update', path: '/api/items/:id/update' },
        { ...LOGIN_CONTRACT, id: 'items.other', method: 'GET', path: '/api/items/:id/update' },
      ],
    });

    expect(entry?.contract?.endpoint).toBe('items.update');
  });

  it('stops when the registry names a route the server does not serve', () => {
    expect(() =>
      describeApiRoutes({ served: [], registered: [registered()], contracts: [] }),
    ).toThrow(/POST \/api\/auth\/login.*not served/u);
  });

  it('stops when two contract endpoints claim one route', () => {
    expect(() =>
      describeApiRoutes({
        served: [{ method: 'POST', url: '/api/auth/login' }],
        registered: [],
        contracts: [LOGIN_CONTRACT, { ...LOGIN_CONTRACT, id: 'auth.loginAgain' }],
      }),
    ).toThrow(/auth\.login, auth\.loginAgain/u);
  });
});

describe('bslt snapshot api', () => {
  it('is byte-identical on two runs', async () => {
    const first = await buildApiSnapshot();
    const second = await buildApiSnapshot();

    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(10_000);
  }, 60_000);

  it('records method, path, auth and the schema identities of the composed server', async () => {
    const file = parse(await buildApiSnapshot());

    expect(file.generated).toContain('pnpm bslt snapshot api');
    expect(Object.keys(file)).toEqual(['generated', 'composedFor', 'routes']);

    expect(route(file, 'POST', '/api/auth/login')).toEqual({
      method: 'POST',
      path: '/api/auth/login',
      registeredBy: 'route-map',
      module: 'identity',
      auth: 'public',
      roles: [],
      deprecated: false,
      bodyLimit: null,
      preHandlers: [],
      request: 'loginRequestSchema',
      contract: {
        endpoint: 'identity.login',
        body: 'loginRequestSchema',
        query: null,
        pathParams: null,
        responses: expect.objectContaining({ '200': 'loginResponseSchema' }) as unknown,
      },
    });
    expect(route(file, 'GET', '/api/activities')).toMatchObject({
      module: 'audit',
      auth: 'role',
      roles: ['user'],
      head: true,
      request: null,
      contract: expect.objectContaining({
        endpoint: 'audit.listActivities',
        query: 'listActivitiesQuerySchema',
      }) as unknown,
    });
    const hasBilling = existsSync(repoPath('main/modules/billing'));
    if (hasBilling) {
      expect(route(file, 'GET', '/api/billing/subscription')).toMatchObject({
        module: 'billing',
        auth: 'role',
        roles: ['user'],
        head: true,
        request: null,
      });
    }
    expect(route(file, 'GET', '/api/users/me')).toMatchObject({ auth: 'role', roles: ['user'] });
    expect(route(file, 'GET', '/api/admin/users')).toMatchObject({
      auth: 'role',
      roles: ['admin'],
    });
    if (hasBilling) {
      // Webhook endpoints are contract-backed routes on @bslt/billing (`auth: { webhook, rawBody: true }`).
      expect(route(file, 'POST', '/api/webhooks/stripe')).toMatchObject({
        registeredBy: 'route-map',
        module: 'billing',
        auth: 'public',
        contract: expect.objectContaining({ endpoint: 'billing.stripeWebhook' }) as unknown,
      });
    }
    expect(route(file, 'GET', '/api/csrf-token').registeredBy).toBe('server');
    // Every auth strategy is composed, so the strategy-filtered routes are in.
    expect(route(file, 'POST', '/api/auth/magic-link/request').auth).toBe('public');

    const keys = file.routes.map((entry) => `${entry.path} ${entry.method}`);
    expect(new Set(keys).size).toBe(keys.length);
    // A HEAD row is a HEAD route without a GET on the same path; the others are `head: true`.
    for (const head of file.routes.filter((entry) => entry.method === 'HEAD')) {
      expect(keys).not.toContain(`${head.path} GET`);
    }
  }, 60_000);

  it('detects a route added to the server and a changed role requirement', async () => {
    const current = await buildApiSnapshot();
    const seeded = await buildApiSnapshot({
      extend: (app) => {
        app.server.get('/api/seeded/raw', () => ({ ok: true }));
        registerRouteMap(
          app.server as never,
          app.context,
          createRouteMap([
            ['seeded/guarded', protectedRoute('POST', () => ({ ok: true }), ['admin'])],
          ]),
          { prefix: '/api', jwtSecret: 'unused', authGuardFactory: () => () => undefined },
        );
      },
    });

    expect(seeded).not.toBe(current);
    const result = checkSnapshot(API_SNAPSHOT, seeded);
    expect(result.ok).toBe(false);
    const problems = (result.problems ?? []).join('\n');
    expect(problems).toContain('+       "path": "/api/seeded/raw",');
    expect(problems).toContain('+       "path": "/api/seeded/guarded",');
    expect(problems).toContain('pnpm bslt snapshot api');

    expect(route(parse(seeded), 'POST', '/api/seeded/guarded')).toMatchObject({
      registeredBy: 'route-map',
      auth: 'role',
      roles: ['admin'],
    });
  }, 60_000);
});
