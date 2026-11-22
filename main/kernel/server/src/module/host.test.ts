// main/kernel/server/src/module/host.test.ts
import {
  AppError,
  AuthenticationError,
  BadRequestError,
  defineErrors,
  defineModule,
  emptyBodySchema,
  endpoint,
  ForbiddenError,
  InternalError,
  job,
} from '@bslt/contract';
import {
  boolean,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  string,
  union,
} from '@bslt/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRegistry, getRegisteredRoutes } from '../http/route.registry';
import { getRouteDefinition } from '../http/routing';

import {
  assertRequirements,
  buildModuleRouteMap,
  buildPlatformContextRouteMap,
  collectModuleJobs,
  createCapabilityResolver,
  extractViewerFromRequest,
  registerModuleCrons,
  registerServerModules,
  type CapabilityContextResolver,
  type ModuleHostOptions,
  type PlatformContextRouteOptions,
} from './host';
import {
  createKernelEventsService,
  createKernelJobsService,
  implementServer,
  type KernelServices,
  type Tx,
  type WebhookVerifier,
  type WebhookVerifierInput,
} from './server-module';

import type { Logger } from '../logger/types';
import type { DbClient } from '@bslt/db';

const widgetErrors = defineErrors('widgets', {
  WIDGET_NOT_FOUND: 404,
  WIDGET_LOCKED: 409,
});

const widgetsModule = defineModule({
  id: 'widgets',
  summary: 'Widgets test module',
  status: 'stable',
  dependsOn: [],
  endpoints: {
    publicStatus: endpoint({
      method: 'GET',
      path: '/api/widgets/status',
      auth: 'public',
      query: object({ verbose: optional(string()) }),
      response: object({ healthy: string({ min: 1 }) }),
      summary: 'Public status',
    }),
    create: endpoint({
      method: 'POST',
      path: '/api/widgets/create',
      auth: 'user',
      body: object({ name: string({ min: 2 }) }),
      response: object({ id: string({ min: 1 }), name: string({ min: 1 }) }),
      status: 201,
      summary: 'Create widget',
    }),
    update: endpoint({
      method: 'POST',
      path: '/api/widgets/:id/update',
      auth: 'user',
      params: object({ id: string({ min: 1 }) }),
      body: emptyBodySchema,
      response: object({ id: string({ min: 1 }) }),
      errors: [widgetErrors.WIDGET_NOT_FOUND, widgetErrors.WIDGET_LOCKED],
      summary: 'Update widget',
    }),
    purge: endpoint({
      method: 'POST',
      path: '/api/widgets/purge',
      auth: 'admin',
      body: emptyBodySchema,
      response: object({ purged: string({ min: 1 }) }),
      summary: 'Admin purge',
    }),
    orgManage: endpoint({
      method: 'POST',
      path: '/api/widgets/org-manage',
      auth: { org: 'widgets.manage' },
      body: emptyBodySchema,
      response: object({ managed: string({ min: 1 }) }),
      summary: 'Org manage',
    }),
  },
  events: {},
  jobs: {},
  tables: ['widgets'],
});

const silentLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

interface FakeRegisteredRoute {
  readonly method: string;
  readonly url: string;
  readonly preHandler?: (req: unknown, reply: unknown) => Promise<void>;
  readonly handler: (req: unknown, reply: unknown) => Promise<unknown>;
}

function makeFakeServer() {
  const routes = new Map<string, FakeRegisteredRoute>();
  const sent: { status?: number; payload?: unknown } = {};
  const headers: Record<string, string> = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    send(payload: unknown) {
      sent.payload = payload;
      return reply;
    },
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
  };
  return {
    routes,
    sent,
    headers,
    reply,
    server: {
      route(opts: FakeRegisteredRoute) {
        routes.set(`${opts.method} ${opts.url}`, opts);
      },
      addHook() {},
    },
  };
}

function makeFakeDb(): { db: DbClient; txCalls: number } {
  const state = { txCalls: 0 };
  const fakeDb = {
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => {
      state.txCalls += 1;
      return fn(fakeDb as unknown as DbClient);
    },
  } as unknown as DbClient;
  return {
    get db() {
      return fakeDb;
    },
    get txCalls() {
      return state.txCalls;
    },
  };
}

function makeKernel(db: DbClient): KernelServices {
  const clock = { now: () => new Date('2026-11-14T00:00:00.000Z') };
  return {
    db: {
      system: <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => db.transaction(fn),
    },
    jobs: createKernelJobsService(clock),
    events: createKernelEventsService({ sealSecret: 'test-seal-secret', clock }),
    log: silentLogger,
    clock,
  };
}

describe('server module host', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('registers module routes in the route registry with exact schema references, roles, and 201 envelope handling', async () => {
    const fakeDb = makeFakeDb();
    const fake = makeFakeServer();
    const guardSpy = vi.fn(() => async () => {});

    const widgetsServer = implementServer(widgetsModule, {
      create: () => ({ prefix: 'w' }),
      handlers: {
        publicStatus: async (input) => Promise.resolve({ healthy: input.query.verbose ?? 'yes' }),
        create: async (input, req, s) =>
          req.tx(async () => Promise.resolve({ id: `${s.prefix}-1`, name: input.body.name })),
        update: async (input) => Promise.resolve({ id: input.params.id }),
        purge: async () => Promise.resolve({ purged: 'done' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });

    const hostOpts: ModuleHostOptions = {
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 'secret',
        authGuardFactory: guardSpy,
      },
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      orgBitLookup: (perm) => (perm === 'widgets.manage' ? 2 : undefined),
    };

    registerServerModules(fake.server, { db: fakeDb.db }, [widgetsServer], hostOpts);

    const reg = getRegisteredRoutes();
    expect(reg).toHaveLength(5);

    const createEntry = reg.find((r) => r.path === '/api/widgets/create');
    expect(createEntry).toMatchObject({
      method: 'POST',
      path: '/api/widgets/create',
      module: 'widgets',
      isPublic: false,
      roles: ['user'],
      hasSchema: true,
    });
    expect(getRouteDefinition(createEntry!)?.schema).toBe(widgetsModule.endpoints.create.body);
    expect(getRouteDefinition(createEntry!)?.preHandlers).toBeUndefined();

    const createRoute = fake.routes.get('POST /api/widgets/create')!;
    await createRoute.handler(
      {
        user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
        body: { name: 'Alpha' },
        params: {},
        query: {},
      },
      fake.reply,
    );
    expect(fake.sent).toEqual({ status: 201, payload: { id: 'w-1', name: 'Alpha' } });
    expect(fakeDb.txCalls).toBe(1);
  });

  it('throws 400 BadRequestError (VALIDATION_ERROR) when params, query, or body fail endpoint schema validation', async () => {
    const fakeDb = makeFakeDb();
    const widgetsServer = implementServer(widgetsModule, {
      create: () => ({}),
      handlers: {
        publicStatus: async () => Promise.resolve({ healthy: 'ok' }),
        create: async (input) => Promise.resolve({ id: '1', name: input.body.name }),
        update: async (input) => Promise.resolve({ id: input.params.id }),
        purge: async () => Promise.resolve({ purged: 'ok' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });
    const inst = widgetsServer.instantiate(makeKernel(fakeDb.db), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });

    const createDef = map.get('widgets/create')!;
    await expect(
      createDef.handler(
        {},
        { name: 'x' },
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: { name: 'x' },
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      kind: 'validation',
    });

    await expect(
      createDef.handler(
        {},
        { name: 'x' },
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: { name: 'x' },
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);

    const updateDef = map.get('widgets/:id/update')!;
    await expect(
      updateDef.handler(
        {},
        {},
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: {},
          params: { id: '' },
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });

    const statusDef = map.get('widgets/status')!;
    await expect(
      statusDef.handler(
        {},
        undefined,
        {
          body: undefined,
          params: {},
          query: { unknownParam: 'nope' },
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('enforces auth levels (401 unauthenticated, 403 insufficient role or missing org bitmask)', async () => {
    const fakeDb = makeFakeDb();
    const widgetsServer = implementServer(widgetsModule, {
      create: () => ({}),
      handlers: {
        publicStatus: async () => Promise.resolve({ healthy: 'ok' }),
        create: async () => Promise.resolve({ id: '1', name: 'ab' }),
        update: async () => Promise.resolve({ id: '1' }),
        purge: async () => Promise.resolve({ purged: 'ok' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });
    const inst = widgetsServer.instantiate(makeKernel(fakeDb.db), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      orgBitLookup: (perm) => (perm === 'widgets.manage' ? 1 : undefined),
    });

    const createDef = map.get('widgets/create')!;
    await expect(
      createDef.handler(
        {},
        { name: 'ab' },
        { body: { name: 'ab' }, params: {}, query: {} } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);

    const purgeDef = map.get('widgets/purge')!;
    await expect(
      purgeDef.handler(
        {},
        {},
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: {},
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const orgDef = map.get('widgets/org-manage')!;
    await expect(
      orgDef.handler(
        {},
        {},
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: {},
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps req.fail(code) to AppError with registered HTTP status, code, and humanized message', async () => {
    const fakeDb = makeFakeDb();
    const widgetsServer = implementServer(widgetsModule, {
      create: () => ({}),
      handlers: {
        publicStatus: async () => Promise.resolve({ healthy: 'ok' }),
        create: async () => Promise.resolve({ id: '1', name: 'ab' }),
        update: async (input, req) => {
          if (input.params.id === 'locked') {
            return req.fail('WIDGET_LOCKED', 'Widget is currently locked', { id: 'locked' });
          }
          return req.fail('WIDGET_NOT_FOUND');
        },
        purge: async () => Promise.resolve({ purged: 'ok' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });
    const inst = widgetsServer.instantiate(makeKernel(fakeDb.db), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });

    const updateDef = map.get('widgets/:id/update')!;
    await expect(
      updateDef.handler(
        {},
        {},
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: {},
          params: { id: 'missing' },
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'widgets.WIDGET_NOT_FOUND',
      kind: 'not_found',
      message: 'Widget not found',
    });

    let caught: unknown;
    try {
      await updateDef.handler(
        {},
        {},
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: {},
          params: { id: 'locked' },
          query: {},
        } as never,
        {} as never,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({
      statusCode: 409,
      code: 'widgets.WIDGET_LOCKED',
      kind: 'conflict',
      message: 'Widget is currently locked',
      details: { id: 'locked' },
    });
  });

  it('throws 500 InternalError in dev/test when a handler returns data violating endpoint.response', async () => {
    const fakeDb = makeFakeDb();
    const badServer = implementServer(widgetsModule, {
      create: () => ({}),
      handlers: {
        publicStatus: async () => Promise.resolve({ healthy: '' }),
        create: async () => Promise.resolve({ id: '1', name: 'ab' }),
        update: async () => Promise.resolve({ id: '1' }),
        purge: async () => Promise.resolve({ purged: 'ok' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });
    const inst = badServer.instantiate(makeKernel(fakeDb.db), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });

    const statusDef = map.get('widgets/status')!;
    await expect(
      statusDef.handler(
        {},
        undefined,
        { body: undefined, params: {}, query: {} } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(InternalError);
  });

  it('collectModuleJobs collects handlers and specs and rejects invalid job payloads', async () => {
    const syncJob = job('widgets.sync', object({ widgetId: string({ min: 1 }) }), {
      queue: 'default',
      maxAttempts: 3,
      timeoutMs: 1_500,
    });
    const modWithJobs = defineModule({
      id: 'widgets',
      summary: 'Widgets with sync job',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: { sync: syncJob },
      tables: [],
      web: false,
    });

    const synced: string[] = [];
    const srv = implementServer(modWithJobs, {
      create: () => ({ prefix: 'job' }),
      handlers: {},
      jobs: {
        sync: async (payload, s) => {
          synced.push(`${s.prefix}:${payload.widgetId}`);
          await Promise.resolve();
        },
      },
    });

    const fakeDb = makeFakeDb();
    const inst = srv.instantiate(makeKernel(fakeDb.db), {});
    const { handlers, jobSpecs } = collectModuleJobs(new Map([['widgets', inst]]));

    expect(jobSpecs['widgets.sync']).toEqual({
      queue: 'default',
      maxAttempts: 3,
      timeoutMs: 1_500,
    });
    await handlers['widgets.sync']!({ widgetId: 'w-7' });
    expect(synced).toEqual(['job:w-7']);

    await expect(handlers['widgets.sync']!({ widgetId: '' })).rejects.toThrow();
    expect(synced).toEqual(['job:w-7']);
  });

  it('registerModuleCrons schedules module crons and ONLY enqueues jobs with deterministic idempotency keys', async () => {
    const sweepJob = job('widgets.sweep', object({}), {
      queue: 'default',
      maxAttempts: 2,
      timeoutMs: 2_000,
    });
    const modWithCron = defineModule({
      id: 'widgets',
      summary: 'Widgets with cron',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: { sweep: sweepJob },
      tables: [],
      web: false,
    });

    let inlineRan = false;
    const srv = implementServer(modWithCron, {
      create: () => ({}),
      handlers: {},
      jobs: {
        sweep: async () => {
          inlineRan = true;
          await Promise.resolve();
        },
      },
      cron: [{ job: 'sweep', schedule: '* * * * *', catchUp: false }],
    });

    const enqueued: Array<{ name: string; payload: unknown; idempotencyKey?: string | undefined }> =
      [];
    const fakeDb = makeFakeDb();
    const kernel = makeKernel(fakeDb.db);
    const jobsSpy: KernelServices['jobs'] = {
      enqueue: async (_tx, def, payload, opts) => {
        enqueued.push({ name: def.name, payload, idempotencyKey: opts?.idempotencyKey });
        return Promise.resolve('job-1');
      },
    };
    const inst = srv.instantiate(kernel, {});

    const registered = new Map<
      string,
      {
        expression: string;
        handler: (args: { cron: string; scheduledFor: string }) => Promise<void>;
      }
    >();
    registerModuleCrons(
      {
        register: (name, expression, handler) => {
          registered.set(name, { expression, handler });
        },
      },
      new Map([['widgets', inst]]),
      { db: fakeDb.db, jobs: jobsSpy },
    );

    expect(registered.get('widgets.sweep')?.expression).toBe('* * * * *');
    await registered.get('widgets.sweep')!.handler({
      cron: 'widgets.sweep',
      scheduledFor: '2026-11-14T00:05:00.000Z',
    });

    expect(inlineRan).toBe(false);
    expect(enqueued).toEqual([
      {
        name: 'widgets.sweep',
        payload: {},
        idempotencyKey: 'widgets.sweep:2026-11-14T00:05:00.000Z',
      },
    ]);
  });

  it('passes options.env to module instantiation and fails fast when module env validation fails', () => {
    const fakeDb = makeFakeDb();
    const fake = makeFakeServer();
    const envMod = defineModule({
      id: 'widgetsenv',
      summary: 'Widgets env module',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
      env: object({
        WIDGETS_MAX_ATTEMPTS: optional(number({ coerce: true, int: true, min: 1, max: 5 })),
      }),
    });

    const srv = implementServer(envMod, {
      create: (k) => ({ maxAttempts: k.env.WIDGETS_MAX_ATTEMPTS ?? 5 }),
      api: (s) => s,
      handlers: {},
    });

    const baseOpts: ModuleHostOptions = {
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 'secret',
        authGuardFactory: () => async () => {},
      },
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    };

    const instances = registerServerModules(fake.server, { db: fakeDb.db }, [srv], {
      ...baseOpts,
      env: { WIDGETS_MAX_ATTEMPTS: '3', UNRELATED_VAR: 'ignored' },
    });
    expect(instances.get('widgetsenv')?.api).toEqual({ maxAttempts: 3 });

    expect(() =>
      registerServerModules(fake.server, { db: fakeDb.db }, [srv], {
        ...baseOpts,
        env: { WIDGETS_MAX_ATTEMPTS: '99' },
      }),
    ).toThrow(/WIDGETS_MAX_ATTEMPTS/);
  });

  it('evaluates endpoint.requires against memoized CapabilityContext and emits typed 403 details before body validation', async () => {
    const gatedModule = defineModule({
      id: 'gated',
      summary: 'Requirement-gated endpoints',
      status: 'stable',
      dependsOn: [],
      flags: {
        'gated.alpha': { default: false, summary: 'Alpha feature' },
      },
      endpoints: {
        tosAndFlag: endpoint({
          method: 'POST',
          path: '/api/gated/publish',
          auth: 'user',
          requires: ['tos.accepted', 'flag:gated.alpha', 'email.verified'],
          body: object({ title: string({ min: 3 }) }),
          response: object({ ok: string({ min: 1 }), audience: number({ int: true }) }),
          summary: 'Publish gated item',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    let contextCalls = 0;
    let contributorState: {
      tosAccepted: boolean;
      emailVerified: boolean;
      alphaEnabled: boolean;
      maxAudience: number;
    } = {
      tosAccepted: false,
      emailVerified: false,
      alphaEnabled: false,
      maxAudience: 2,
    };

    const sessionCalls: unknown[] = [];
    const fakeDb = {
      withSession(session: unknown) {
        sessionCalls.push(session);
        return fakeDb;
      },
      transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> =>
        fn(fakeDb as unknown as DbClient),
    } as unknown as DbClient;

    const srv = implementServer(gatedModule, {
      create: () => ({}),
      context: async () => {
        contextCalls += 1;
        return Promise.resolve({
          flags: { 'gated.alpha': contributorState.alphaEnabled },
          eligibility: {
            tosAccepted: contributorState.tosAccepted,
            emailVerified: contributorState.emailVerified,
          },
          maxAudience: contributorState.maxAudience,
          ...(!contributorState.tosAccepted
            ? {
                requirementDetails: {
                  TOS_ACCEPTANCE_REQUIRED: { documentId: 'tos-doc-1', requiredVersion: 5 },
                },
              }
            : {}),
        });
      },
      handlers: {
        tosAndFlag: async (_input, req) =>
          req.tx(async () => Promise.resolve({ ok: 'yes', audience: req.caps.maxAudience })),
      },
    });

    const inst = srv.instantiate(makeKernel(fakeDb), {});
    const resolveCapabilities: CapabilityContextResolver = createCapabilityResolver({
      instances: [inst],
      extraContributions: [() => ({ authStrategies: ['password'] })],
    });
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb,
      validateResponses: true,
      resolveCapabilities,
    });

    const publishDef = map.get('gated/publish')!;

    // Failure 1: ToS refusal carries both { requirement } and { documentId, requiredVersion } BEFORE body validation
    await expect(
      publishDef.handler(
        {},
        { title: 'x' },
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: { title: 'x' },
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'TOS_ACCEPTANCE_REQUIRED',
      kind: 'authorization',
      details: {
        requirement: 'tos.accepted',
        documentId: 'tos-doc-1',
        requiredVersion: 5,
      },
    });

    // Failure 2: Feature disabled refusal when ToS accepted but flag is false
    contributorState = {
      tosAccepted: true,
      emailVerified: false,
      alphaEnabled: false,
      maxAudience: 2,
    };
    await expect(
      publishDef.handler(
        {},
        { title: 'Valid title' },
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: { title: 'Valid title' },
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FEATURE_DISABLED',
      details: { requirement: 'flag:gated.alpha' },
    });

    // Failure 3: Email verification refusal when flag is true
    contributorState = {
      tosAccepted: true,
      emailVerified: false,
      alphaEnabled: true,
      maxAudience: 2,
    };
    await expect(
      publishDef.handler(
        {},
        { title: 'Valid title' },
        {
          user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
          body: { title: 'Valid title' },
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
      details: { requirement: 'email.verified' },
    });

    // Success: memoizes per request object and propagates maxAudience to withSession
    contributorState = {
      tosAccepted: true,
      emailVerified: true,
      alphaEnabled: true,
      maxAudience: 2,
    };
    const reqObj = {
      user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
      actingOrg: { orgId: 'org-1', permissions: 3n },
      body: { title: 'Valid title' },
      params: {},
      query: {},
    };
    const preResolved = await resolveCapabilities(
      reqObj as never,
      extractViewerFromRequest(reqObj as never),
    );
    expect(() => assertRequirements(['tos.accepted'], preResolved)).not.toThrow();

    const callsBeforeHandler = contextCalls;
    const result = await publishDef.handler(
      {},
      { title: 'Valid title' },
      reqObj as never,
      {} as never,
    );
    expect(result).toEqual({ ok: 'yes', audience: 2 });
    expect(contextCalls).toBe(callsBeforeHandler);
    expect(sessionCalls).toEqual([{ userId: 'u-1', role: 'user', orgId: 'org-1', maxAudience: 2 }]);
  });

  it('serves serialized CapabilityContext from buildPlatformContextRouteMap and propagates invalid-auth rejections', async () => {
    const fakeDb = makeFakeDb();
    const srv = implementServer(widgetsModule, {
      create: () => ({}),
      context: () => ({
        flags: { 'widgets.beta': true },
        entitlements: ['widgets.pro'],
        authStrategies: ['password', 'google'],
      }),
      handlers: {
        publicStatus: async () => Promise.resolve({ healthy: 'ok' }),
        create: async () => Promise.resolve({ id: '1', name: 'ab' }),
        update: async () => Promise.resolve({ id: '1' }),
        purge: async () => Promise.resolve({ purged: 'ok' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });
    const inst = srv.instantiate(makeKernel(fakeDb.db), {});
    const resolveCapabilities = createCapabilityResolver({ instances: [inst] });

    const opts: PlatformContextRouteOptions = {
      resolveCapabilities,
      authenticateOptional: async (req) => {
        const auth = req.headers['authorization'];
        if (auth === 'Bearer invalid') {
          throw new AuthenticationError('Invalid token');
        }
        if (auth === 'Bearer valid') {
          (
            req as unknown as {
              user?: { userId: string; email: string; role: string };
              actingOrg?: { orgId: string; permissions: bigint };
            }
          ).user = { userId: 'u-42', email: 'u42@example.com', role: 'admin' };
          (
            req as unknown as {
              actingOrg?: { orgId: string; permissions: bigint };
            }
          ).actingOrg = { orgId: 'org-7', permissions: 9n };
        }
        await Promise.resolve();
      },
    };
    const routeMap = buildPlatformContextRouteMap(opts);
    const contextRoute = routeMap.get('platform/context')!;
    expect(contextRoute.isPublic).toBe(true);

    // Anonymous viewer
    const anonPayload = await contextRoute.handler(
      {},
      undefined,
      { headers: {}, params: {}, query: {} } as never,
      {} as never,
    );
    expect(anonPayload).toEqual({
      modules: ['widgets'],
      flags: { 'widgets.beta': true },
      entitlements: ['widgets.pro'],
      eligibility: {
        tosAccepted: false,
        emailVerified: false,
        ageVerifiedFor: null,
        jurisdiction: null,
      },
      viewer: null,
      actingAs: { kind: 'user' },
      maxAudience: 0,
      authStrategies: ['password', 'google'],
    });

    // Authenticated org viewer
    const authedPayload = await contextRoute.handler(
      {},
      undefined,
      { headers: { authorization: 'Bearer valid' }, params: {}, query: {} } as never,
      {} as never,
    );
    expect(authedPayload).toMatchObject({
      viewer: {
        userId: 'u-42',
        role: 'admin',
        actingOrg: { orgId: 'org-7', permissions: '9' },
      },
      actingAs: { kind: 'org', orgId: 'org-7', permissions: '9' },
    });

    // Invalid token -> 401 so client transport can refresh and retry
    await expect(
      contextRoute.handler(
        {},
        undefined,
        { headers: { authorization: 'Bearer invalid' }, params: {}, query: {} } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('seeds manifest flags defaults before module context overrides and enforces disabled flags', async () => {
    const flaggedModule = defineModule({
      id: 'flagged',
      summary: 'Module declaring manifest flags',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        useAlpha: endpoint({
          method: 'GET',
          path: '/api/flagged/alpha',
          auth: 'user',
          requires: ['flag:flagged.alpha'],
          response: object({ ok: boolean() }),
          summary: 'Requires flagged.alpha',
        }),
        useBeta: endpoint({
          method: 'GET',
          path: '/api/flagged/beta',
          auth: 'user',
          requires: ['flag:flagged.beta'],
          response: object({ ok: boolean() }),
          summary: 'Requires flagged.beta',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      flags: {
        'flagged.alpha': { default: true, summary: 'Alpha default on' },
        'flagged.beta': { default: false, summary: 'Beta default off' },
      },
      web: false,
    });

    let runtimeOverrides: Record<string, boolean> = {};
    const fakeDb = makeFakeDb();
    const flaggedSrv = implementServer(flaggedModule, {
      create: () => ({}),
      context: () => ({ flags: runtimeOverrides }),
      handlers: {
        useAlpha: async () => Promise.resolve({ ok: true }),
        useBeta: async () => Promise.resolve({ ok: true }),
      },
    });

    const inst = flaggedSrv.instantiate(makeKernel(fakeDb.db), {});
    const resolveCapabilities = createCapabilityResolver({ instances: [inst] });
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      resolveCapabilities,
    });

    const alphaDef = map.get('flagged/alpha')!;
    const betaDef = map.get('flagged/beta')!;
    const makeReq = () =>
      ({
        user: { userId: 'u-1', email: 'u@example.com', role: 'user' },
        params: {},
        query: {},
      }) as never;

    // 1. Default false rejects with 403 FEATURE_DISABLED when no DB row enables it
    await expect(betaDef.handler({}, undefined, makeReq(), {} as never)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FEATURE_DISABLED',
      details: { requirement: 'flag:flagged.beta' },
    });

    // 2. Default true passes when no DB row disables it
    expect(await alphaDef.handler({}, undefined, makeReq(), {} as never)).toEqual({ ok: true });

    // 3. Explicit false from runtime context overrides manifest default: true -> 403 FEATURE_DISABLED
    runtimeOverrides = { 'flagged.alpha': false };
    await expect(alphaDef.handler({}, undefined, makeReq(), {} as never)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FEATURE_DISABLED',
      details: { requirement: 'flag:flagged.alpha' },
    });
  });

  it('instantiates modules without mounting HTTP endpoints when registerRoutes is false', () => {
    const fakeDb = makeFakeDb();
    const fake = makeFakeServer();
    const widgetsServer = implementServer(widgetsModule, {
      create: () => ({ ready: true }),
      api: (s) => s,
      handlers: {
        publicStatus: async () => Promise.resolve({ healthy: 'ok' }),
        create: async () => Promise.resolve({ id: '1', name: 'ab' }),
        update: async () => Promise.resolve({ id: '1' }),
        purge: async () => Promise.resolve({ purged: 'ok' }),
        orgManage: async () => Promise.resolve({ managed: 'ok' }),
      },
    });

    const instances = registerServerModules(fake.server, { db: fakeDb.db }, [widgetsServer], {
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 'secret',
        authGuardFactory: () => async () => {},
      },
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      registerRoutes: false,
    });

    expect(instances.get('widgets')?.api).toEqual({ ready: true });
    expect(fake.routes.size).toBe(0);
    expect(getRegisteredRoutes()).toHaveLength(0);
  });

  it('sets Cache-Control: public, max-age=<n> when a public endpoint declares cache.public', async () => {
    const cachedModule = defineModule({
      id: 'statusprobe',
      summary: 'Cached public status module',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        getSummary: endpoint({
          method: 'GET',
          path: '/api/statusprobe',
          auth: 'public',
          cache: { public: 30 },
          response: object({ status: string({ min: 1 }) }),
          summary: 'Get public status summary',
        }),
        uncached: endpoint({
          method: 'GET',
          path: '/api/statusprobe/live',
          auth: 'public',
          response: object({ status: string({ min: 1 }) }),
          summary: 'Get uncached status',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });

    let summaryValue = 'healthy';
    const fakeDb = makeFakeDb();
    const cachedServer = implementServer(cachedModule, {
      create: () => ({}),
      handlers: {
        getSummary: async () => Promise.resolve({ status: summaryValue }),
        uncached: async () => Promise.resolve({ status: 'ok' }),
      },
    });
    const inst = cachedServer.instantiate(makeKernel(fakeDb.db), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });

    const headers = new Map<string, string>();
    const reply = {
      header: (key: string, value: string) => {
        headers.set(key.toLowerCase(), value);
        return reply;
      },
    };
    const req = { params: {}, query: {} } as never;

    const out = await map.get('statusprobe')!.handler({}, undefined, req, reply as never);
    expect(out).toEqual({ status: 'healthy' });
    expect(headers.get('cache-control')).toBe('public, max-age=30');

    headers.clear();
    await map.get('statusprobe/live')!.handler({}, undefined, req, reply as never);
    expect(headers.has('cache-control')).toBe(false);

    headers.clear();
    summaryValue = '';
    await expect(
      map.get('statusprobe')!.handler({}, undefined, req, reply as never),
    ).rejects.toThrow(/violated its response schema/u);
    expect(headers.has('cache-control')).toBe(false);
  });

  it('invokes authenticateOptional on uncached public endpoints and skips it on cache.public endpoints', async () => {
    const publicMixedModule = defineModule({
      id: 'pubmix',
      summary: 'Mixed public endpoints',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        ingest: endpoint({
          method: 'POST',
          path: '/api/pubmix/ingest',
          auth: 'public',
          response: object({ viewerId: string() }),
          summary: 'Uncached public ingest',
        }),
        cached: endpoint({
          method: 'GET',
          path: '/api/pubmix/cached',
          auth: 'public',
          cache: { public: 60 },
          response: object({ viewerId: string() }),
          summary: 'Cached public read',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });

    const fakeDb = makeFakeDb();
    const srv = implementServer(publicMixedModule, {
      create: () => ({}),
      handlers: {
        ingest: async (_input, req) => Promise.resolve({ viewerId: req.viewer?.userId ?? 'anon' }),
        cached: async (_input, req) => Promise.resolve({ viewerId: req.viewer?.userId ?? 'anon' }),
      },
    });
    const inst = srv.instantiate(makeKernel(fakeDb.db), {});
    const authSpy = vi.fn(async (req: { headers?: Record<string, string>; user?: unknown }) => {
      if (req.headers?.['authorization'] === 'Bearer u-99') {
        req.user = { userId: 'u-99', email: 'u99@example.com', role: 'user' };
      }
      await Promise.resolve();
    });
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      authenticateOptional: authSpy as never,
    });

    const reply = { header: () => reply };
    const authedIngest = await map
      .get('pubmix/ingest')!
      .handler(
        {},
        undefined,
        { headers: { authorization: 'Bearer u-99' }, params: {}, query: {} } as never,
        reply as never,
      );
    expect(authedIngest).toEqual({ viewerId: 'u-99' });
    expect(authSpy).toHaveBeenCalledTimes(1);

    authSpy.mockClear();
    const cachedRead = await map
      .get('pubmix/cached')!
      .handler(
        {},
        undefined,
        { headers: { authorization: 'Bearer u-99' }, params: {}, query: {} } as never,
        reply as never,
      );
    expect(cachedRead).toEqual({ viewerId: 'anon' });
    expect(authSpy).not.toHaveBeenCalled();
  });

  it('forwards endpoint bodyLimit to RouteDefinition.routeOptions and normalizes multipart upload bodies for combinator schemas', async () => {
    const uploadMod = defineModule({
      id: 'files',
      summary: 'Upload test module',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        upload: endpoint({
          method: 'POST',
          path: '/api/files/upload',
          auth: 'user',
          status: 201,
          bodyLimit: 11_534_336,
          body: object({
            filename: string({ min: 1 }),
            mimeType: string({ min: 1 }),
            dataBase64: string({ min: 1 }),
            sizeBytes: optional(number({ int: true, min: 0 })),
          }),
          response: object({
            filename: string(),
            mimeType: string(),
            byteLength: number(),
          }),
          summary: 'Upload file',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });

    const fakeDb = makeFakeDb();
    const srv = implementServer(uploadMod, {
      create: (k) => ({ provider: k.storage?.providerName ?? 'local' }),
      handlers: {
        upload: async (input) =>
          Promise.resolve({
            filename: input.body.filename,
            mimeType: input.body.mimeType,
            byteLength: Buffer.from(input.body.dataBase64, 'base64').byteLength,
          }),
      },
    });
    const inst = srv.instantiate(makeKernel(fakeDb.db), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });

    const route = map.get('files/upload');
    expect(route?.routeOptions?.bodyLimit).toBe(11_534_336);

    const userReq = {
      user: { userId: 'u-1', email: 'u1@example.com', role: 'user' },
      params: {},
      query: {},
      headers: {},
    } as never;
    const reply = { header: () => reply } as never;

    // 1. Multipart form body (ParsedMultipartFile shape) is normalized cleanly
    const mpRes = await route!.handler(
      {},
      {
        buffer: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimetype: 'image/png',
        filename: 'photo.png',
        size: 4,
      },
      userReq,
      reply,
    );
    expect(mpRes).toEqual({
      status: 201,
      body: { filename: 'photo.png', mimeType: 'image/png', byteLength: 4 },
    });

    // 2. Failure cases (>= 60% failure assertions): empty multipart object, missing mimeType, unauthenticated
    await expect(route!.handler({}, {}, userReq, reply)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      route!.handler(
        {},
        { buffer: new Uint8Array([1, 2]), mimetype: '', filename: 'bad.bin', size: 2 },
        userReq,
        reply,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      route!.handler(
        {},
        { filename: 'a.png', mimeType: 'image/png', dataBase64: 'AQID' },
        { params: {}, query: {}, headers: {} } as never,
        reply,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('registers multiple HTTP methods on the same module path without overwriting', async () => {
    const fakeDb = makeFakeDb();
    const fakeSrv = makeFakeServer();
    const samePathMod = defineModule({
      id: 'avatars',
      summary: 'Same-path GET + POST test module',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        getAvatar: endpoint({
          method: 'GET',
          path: '/api/avatars/current',
          auth: 'public',
          response: object({ url: string({ min: 1 }) }),
          summary: 'Read avatar',
        }),
        setAvatar: endpoint({
          method: 'POST',
          path: '/api/avatars/current',
          auth: 'public',
          body: object({ url: string({ min: 1 }) }),
          response: object({ saved: boolean() }),
          summary: 'Save avatar',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });
    const srv = implementServer(samePathMod, {
      create: () => ({}),
      handlers: {
        getAvatar: async () => Promise.resolve({ url: 'https://cdn.example/a.png' }),
        setAvatar: async () => Promise.resolve({ saved: true }),
      },
    });

    registerServerModules(fakeSrv.server as never, {}, [srv], {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 'test-secret-minimum-32-characters!!',
        authGuardFactory: () => async () => {},
      },
    });

    expect(fakeSrv.routes.has('GET /api/avatars/current')).toBe(true);
    expect(fakeSrv.routes.has('POST /api/avatars/current')).toBe(true);
    expect(fakeSrv.routes.has('DELETE /api/avatars/current')).toBe(false);
    expect(fakeSrv.routes.has('PUT /api/avatars/current')).toBe(false);

    const postRoute = fakeSrv.routes.get('POST /api/avatars/current')!;
    await expect(
      postRoute.handler({ body: {}, params: {}, query: {}, headers: {} }, fakeSrv.reply),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('wires k.actions across modules without dependsOn, fails closed on unknown actions, and enforces moderator auth', async () => {
    const fakeDb = makeFakeDb();
    const fakeSrv = makeFakeServer();
    const quarantined: string[] = [];

    const filesMod = defineModule({
      id: 'files',
      summary: 'Files action provider',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const moderationMod = defineModule({
      id: 'moderation',
      summary: 'Moderation action consumer',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        execute: endpoint({
          method: 'POST',
          path: '/api/moderation/execute',
          auth: 'moderator',
          body: object({ actionKey: string({ min: 1 }), targetId: string({ min: 1 }) }),
          response: object({ executed: boolean() }),
          summary: 'Execute moderation action',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    const filesSrv = implementServer(filesMod, {
      create: () => ({}),
      handlers: {},
      actions: {
        'files.quarantine': async (_s, _tx, input) => {
          const targetId = (input as { readonly targetId: string }).targetId;
          quarantined.push(targetId);
          await Promise.resolve();
        },
      },
    });
    const moderationSrv = implementServer(moderationMod, {
      create: (k) => ({ actions: k.actions }),
      handlers: {
        execute: async (input, req, s) => {
          await req.tx(async (tx) => {
            if (s.actions === undefined) {
              throw new Error('k.actions missing');
            }
            await s.actions.invoke(input.body.actionKey, tx, { targetId: input.body.targetId });
          });
          return { executed: true };
        },
      },
    });

    registerServerModules(fakeSrv.server as never, {}, [filesSrv, moderationSrv], {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 'test-secret-minimum-32-characters!!',
        authGuardFactory: () => async () => {},
      },
    });

    const route = fakeSrv.routes.get('POST /api/moderation/execute')!;

    // Failure 1: unauthenticated -> 401
    await expect(
      route.handler(
        {
          body: { actionKey: 'files.quarantine', targetId: 'f-1' },
          params: {},
          query: {},
          headers: {},
        },
        fakeSrv.reply,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });

    // Failure 2: standard user -> 403
    await expect(
      route.handler(
        {
          user: { userId: 'u-1', email: 'u@test', role: 'user' },
          body: { actionKey: 'files.quarantine', targetId: 'f-1' },
          params: {},
          query: {},
          headers: {},
        },
        fakeSrv.reply,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Failure 3: unknown action key -> fail-closed rejection
    await expect(
      route.handler(
        {
          user: { userId: 'm-1', email: 'm@test', role: 'moderator' },
          body: { actionKey: 'files.nonexistent', targetId: 'f-1' },
          params: {},
          query: {},
          headers: {},
        },
        fakeSrv.reply,
      ),
    ).rejects.toThrow(/unknown action/i);

    // Moderator succeeds and dispatches files.quarantine across modules
    const modOut = await route.handler(
      {
        user: { userId: 'm-1', email: 'm@test', role: 'moderator' },
        body: { actionKey: 'files.quarantine', targetId: 'f-99' },
        params: {},
        query: {},
        headers: {},
      },
      fakeSrv.reply,
    );
    expect(modOut).toEqual({ executed: true });
    expect(quarantined).toEqual(['f-99']);
  });

  it('wires k.privacy across registerServerModules without dependsOn and enforces fail-closed errors', async () => {
    const fakeDb = makeFakeDb();
    const fakeSrv = makeFakeServer();
    const erased: string[] = [];

    const tasksMod = defineModule({
      id: 'tasks',
      summary: 'Tasks privacy provider',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });
    const complianceMod = defineModule({
      id: 'compliance',
      summary: 'Compliance orchestrator',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        exportMe: endpoint({
          method: 'POST',
          path: '/api/compliance/export',
          auth: 'user',
          body: object({}),
          response: object({ modules: object({ tasks: object({ items: number() }) }) }),
          summary: 'Export user data across privacy slot',
        }),
        eraseMe: endpoint({
          method: 'POST',
          path: '/api/compliance/erase',
          auth: 'user',
          body: object({ fail: optional(string()) }),
          response: object({ erased: number() }),
          summary: 'Erase user data across privacy slot',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    const tasksSrv = implementServer(tasksMod, {
      create: () => ({}),
      handlers: {},
      privacy: {
        exportUser: async (_s, userId) => Promise.resolve({ items: userId === 'u-1' ? 3 : 0 }),
        eraseUser: async (_s, _tx, userId) => {
          if (userId === 'u-blocked') {
            throw new Error('erase blocked');
          }
          erased.push(userId);
          await Promise.resolve();
        },
      },
    });
    const complianceSrv = implementServer(complianceMod, {
      create: (k) => ({ privacy: k.privacy }),
      handlers: {
        exportMe: async (_input, req, s) => {
          if (s.privacy === undefined) throw new Error('k.privacy missing');
          const exported = await s.privacy.exportUser(req.viewer.userId);
          return { modules: exported as { tasks: { items: number } } };
        },
        eraseMe: async (_input, req, s) => {
          if (s.privacy === undefined) throw new Error('k.privacy missing');
          await req.tx(async (tx) => {
            await s.privacy!.eraseUser(tx, req.viewer.userId);
          });
          return { erased: s.privacy.modules().length };
        },
      },
    });

    registerServerModules(fakeSrv.server as never, {}, [tasksSrv, complianceSrv], {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 'test-secret-minimum-32-characters!!',
        authGuardFactory: () => async () => {},
      },
    });

    const exportRoute = fakeSrv.routes.get('POST /api/compliance/export')!;
    const eraseRoute = fakeSrv.routes.get('POST /api/compliance/erase')!;

    // Failure 1: unauthenticated export rejected with 401
    await expect(
      exportRoute.handler({ body: {}, params: {}, query: {}, headers: {} }, fakeSrv.reply),
    ).rejects.toMatchObject({ statusCode: 401 });

    // Failure 2: unauthenticated erase rejected with 401
    await expect(
      eraseRoute.handler({ body: {}, params: {}, query: {}, headers: {} }, fakeSrv.reply),
    ).rejects.toMatchObject({ statusCode: 401 });

    // Failure 3: provider erase rejection propagates fail-closed
    await expect(
      eraseRoute.handler(
        {
          user: { userId: 'u-blocked', email: 'b@test', role: 'user' },
          body: {},
          params: {},
          query: {},
          headers: {},
        },
        fakeSrv.reply,
      ),
    ).rejects.toThrow(/erase blocked/);

    // Success: compliance exports & erases tasks rows via k.privacy without dependsOn
    const exported = await exportRoute.handler(
      {
        user: { userId: 'u-1', email: 'u1@test', role: 'user' },
        body: {},
        params: {},
        query: {},
        headers: {},
      },
      fakeSrv.reply,
    );
    expect(exported).toEqual({ modules: { tasks: { items: 3 } } });

    const eraseOut = await eraseRoute.handler(
      {
        user: { userId: 'u-1', email: 'u1@test', role: 'user' },
        body: {},
        params: {},
        query: {},
        headers: {},
      },
      fakeSrv.reply,
    );
    expect(eraseOut).toEqual({ erased: 1 });
    expect(erased).toEqual(['u-1']);
  });

  it('forwards request headers/ip to module context slot, populates req.ip & req.userAgent, and supports validated wire responses', async () => {
    const geoMod = defineModule({
      id: 'compliance',
      summary: 'Geo + wire test',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        restricted: endpoint({
          method: 'GET',
          path: '/api/compliance/restricted',
          auth: 'user',
          requires: ['age.verified:18'],
          response: object({
            jurisdiction: nullable(string()),
            ip: nullable(string()),
            userAgent: nullable(string()),
          }),
          summary: 'Age-gated endpoint',
        }),
        download: endpoint({
          method: 'GET',
          path: '/api/compliance/download',
          auth: 'user',
          query: object({ format: optional(string()) }),
          response: union([
            object({ json: boolean() }),
            object({
              status: literal(200),
              wire: string(),
              headers: record(string(), string()),
            }),
          ]),
          summary: 'Download export',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    const geoSrv = implementServer(geoMod, {
      create: () => ({}),
      context: (_s, viewer, req) => {
        const rawCountry = req?.headers?.['cf-ipcountry'];
        const country = typeof rawCountry === 'string' && rawCountry !== '' ? rawCountry : null;
        return {
          eligibility: {
            jurisdiction: country,
            ageVerifiedFor: viewer?.userId === 'adult-1' ? 21 : null,
          },
        };
      },
      handlers: {
        restricted: async (_input, req) =>
          Promise.resolve({
            jurisdiction: req.caps.eligibility.jurisdiction,
            ip: req.ip ?? null,
            userAgent: req.userAgent ?? null,
          }),
        download: async (input) => {
          if (input.query.format === 'bad') {
            return Promise.resolve({ status: 500, wire: 123 } as never);
          }
          if (input.query.format === 'csv') {
            return Promise.resolve({
              status: 200 as const,
              wire: 'a,b\n1,2\n',
              headers: { 'Content-Type': 'text/csv; charset=utf-8' },
            });
          }
          return Promise.resolve({ json: true });
        },
      },
    });

    const fakeDb = makeFakeDb();
    const fakeSrv = makeFakeServer();
    registerServerModules(fakeSrv.server, {}, [geoSrv], {
      validateResponses: true,
      resolveDb: () => fakeDb.db,
      kernel: makeKernel(fakeDb.db),
      routerOptions: {
        prefix: '/api',
        jwtSecret: 's',
        authGuardFactory: () => async () => {},
      },
    });

    const restricted = fakeSrv.routes.get('GET /api/compliance/restricted')!;
    const download = fakeSrv.routes.get('GET /api/compliance/download')!;

    // Failure 1: unauthenticated rejected
    await expect(
      restricted.handler({ params: {}, query: {}, headers: {} }, fakeSrv.reply),
    ).rejects.toMatchObject({ statusCode: 401 });

    // Failure 2: age.verified:18 denied with 403 AGE_ASSURANCE_REQUIRED when ageVerifiedFor is null
    await expect(
      restricted.handler(
        {
          user: { userId: 'minor-1', email: 'm@test', role: 'user' },
          params: {},
          query: {},
          headers: { 'cf-ipcountry': 'GB' },
        },
        fakeSrv.reply,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AGE_ASSURANCE_REQUIRED' });

    // Failure 3: malformed wire payload rejected by validateResponses
    await expect(
      download.handler(
        {
          user: { userId: 'adult-1', email: 'a@test', role: 'user' },
          params: {},
          query: { format: 'bad' },
          headers: {},
        },
        fakeSrv.reply,
      ),
    ).rejects.toThrow(/violated its response schema/);

    // Success 1: adult passes age gate and receives header-derived jurisdiction + ip/userAgent
    const okRes = await restricted.handler(
      {
        user: { userId: 'adult-1', email: 'a@test', role: 'user' },
        ip: '203.0.113.9',
        params: {},
        query: {},
        headers: { 'cf-ipcountry': 'GB', 'user-agent': 'TestBrowser/1.0' },
      },
      fakeSrv.reply,
    );
    expect(okRes).toEqual({
      jurisdiction: 'GB',
      ip: '203.0.113.9',
      userAgent: 'TestBrowser/1.0',
    });

    // Success 2: CSV wire response applies headers and sends raw wire payload through reply
    await download.handler(
      {
        user: { userId: 'adult-1', email: 'a@test', role: 'user' },
        params: {},
        query: { format: 'csv' },
        headers: {},
      },
      fakeSrv.reply,
    );
    expect(fakeSrv.sent).toEqual({ status: 200, payload: 'a,b\n1,2\n' });
    expect(fakeSrv.headers['Content-Type'] ?? fakeSrv.headers['content-type']).toBe(
      'text/csv; charset=utf-8',
    );
  });

  it('enforces the verifiers slot on auth: { webhook, rawBody: true } endpoints before body schema parsing', async () => {
    const fakeDb = makeFakeDb();
    const webhookMod = defineModule({
      id: 'ingress',
      summary: 'Webhook verifier slot test module',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        stripeHook: endpoint({
          method: 'POST',
          path: '/api/webhooks/stripe',
          auth: { webhook: 'stripe', rawBody: true },
          body: object({ id: string({ min: 1 }) }),
          response: object({ received: boolean(), eventId: string() }),
          summary: 'Receive Stripe webhook',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });

    // Failure 1: missing verifier for declared auth.webhook fails at implementServer
    expect(() =>
      implementServer(webhookMod, {
        create: () => ({}),
        handlers: {
          stripeHook: async () => Promise.resolve({ received: true, eventId: 'evt_1' }),
        },
      }),
    ).toThrow(/stripe.*verifier/i);

    const handlerSpy = vi.fn();
    const stripeVerifier: WebhookVerifier<{ secret: string }> = (
      input: WebhookVerifierInput,
      s,
    ) => {
      const sig = input.headers['stripe-signature'];
      if (sig !== `sig:${s.secret}:${input.rawBody.toString('utf8')}`) {
        throw new BadRequestError('Invalid webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
      }
      return { verifiedId: 'evt_verified_1', sourceIp: input.sourceIp };
    };

    const srv = implementServer(webhookMod, {
      create: () => ({ secret: 'whsec_test' }),
      verifiers: {
        stripe: stripeVerifier,
      },
      handlers: {
        stripeHook: async (input, req) => {
          handlerSpy(input, req.rawBody?.toString('utf8'), req.verifiedWebhook);
          return Promise.resolve({ received: true, eventId: input.body.id });
        },
      },
    });

    const inst = srv.instantiate(makeKernel(fakeDb.db), {});
    const routeMap = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });
    const hookRoute = routeMap.get('webhooks/stripe')!;
    expect(hookRoute.routeOptions).toMatchObject({
      rawBody: true,
      webhookVerified: true,
      skipBodyInjectionFilter: true,
    });

    // Failure 2: missing rawBody on request fails closed with 400 before body schema parsing or handler
    await expect(
      hookRoute.handler(
        {},
        { id: '' },
        { params: {}, query: {}, headers: { 'stripe-signature': 'sig:whsec_test:{}' } } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'MISSING_WEBHOOK_BODY' });
    expect(handlerSpy).not.toHaveBeenCalled();

    // Failure 3: invalid signature fails closed with 400 before body schema parsing (even when body is invalid)
    const rawBytes = Buffer.from('{"id":"evt_123"}', 'utf8');
    await expect(
      hookRoute.handler(
        {},
        { id: '' },
        {
          rawBody: rawBytes,
          params: {},
          query: {},
          headers: { 'stripe-signature': 'forged' },
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'WEBHOOK_SIGNATURE_INVALID' });
    expect(handlerSpy).not.toHaveBeenCalled();

    // Positive: valid signature verifies raw bytes first, parses body, and attaches rawBody + verifiedWebhook
    const ok = await hookRoute.handler(
      {},
      { id: 'evt_123' },
      {
        rawBody: rawBytes,
        ip: '198.51.100.7',
        params: {},
        query: { mode: 'live' },
        headers: { 'stripe-signature': `sig:whsec_test:${rawBytes.toString('utf8')}` },
      } as never,
      {} as never,
    );
    expect(ok).toEqual({ received: true, eventId: 'evt_123' });
    expect(handlerSpy).toHaveBeenCalledWith({ body: { id: 'evt_123' } }, '{"id":"evt_123"}', {
      verifiedId: 'evt_verified_1',
      sourceIp: '198.51.100.7',
    });
  });

  it('exposes request headers/cookies and reply setCookie/clearCookie on RequestContext, degrading safely when absent', async () => {
    const fakeDb = makeFakeDb();
    const sessionMod = defineModule({
      id: 'sessiontest',
      summary: 'Session cookie test module',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        inspect: endpoint({
          method: 'POST',
          path: '/api/sessiontest/inspect',
          auth: 'public',
          body: emptyBodySchema,
          response: object({
            sudo: nullable(string()),
            refresh: nullable(string()),
          }),
          summary: 'Inspect headers and cookies',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
    });

    const srv = implementServer(sessionMod, {
      create: () => ({}),
      handlers: {
        inspect: async (_input, req) => {
          const rawSudo = req.headers?.['x-sudo-token'];
          const sudo = typeof rawSudo === 'string' && rawSudo.length > 0 ? rawSudo : null;
          const refresh = req.cookies?.['refreshToken'] ?? null;
          if (refresh === 'rotate-me') {
            req.setCookie?.('refreshToken', 'rotated-token', { httpOnly: true, path: '/api/auth' });
          } else if (refresh === 'clear-me') {
            req.clearCookie?.('refreshToken', { path: '/api/auth' });
          }
          return Promise.resolve({ sudo, refresh });
        },
      },
    });

    const inst = srv.instantiate(makeKernel(fakeDb.db), {});
    const routeMap = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb.db,
      validateResponses: true,
    });
    const inspectRoute = routeMap.get('sessiontest/inspect')!;

    // Failure / absence cases: missing headers, array header, missing cookies, reply without cookie methods
    const bareRes = await inspectRoute.handler(
      {},
      {},
      { params: {}, query: {} } as never,
      {} as never,
    );
    expect(bareRes).toEqual({ sudo: null, refresh: null });

    const arrayHeaderRes = await inspectRoute.handler(
      {},
      {},
      {
        params: {},
        query: {},
        headers: { 'x-sudo-token': ['a', 'b'] },
        cookies: { refreshToken: 'rotate-me' },
      } as never,
      {} as never,
    );
    expect(arrayHeaderRes).toEqual({ sudo: null, refresh: 'rotate-me' });

    // Positive: forwards headers/cookies and invokes reply.setCookie / reply.clearCookie
    const setCookie = vi.fn();
    const clearCookie = vi.fn();
    const rotateRes = await inspectRoute.handler(
      {},
      {},
      {
        params: {},
        query: {},
        headers: { 'x-sudo-token': 'sudo-jwt-1' },
        cookies: { refreshToken: 'rotate-me' },
      } as never,
      { setCookie, clearCookie } as never,
    );
    expect(rotateRes).toEqual({ sudo: 'sudo-jwt-1', refresh: 'rotate-me' });
    expect(setCookie).toHaveBeenCalledWith('refreshToken', 'rotated-token', {
      httpOnly: true,
      path: '/api/auth',
    });
    expect(clearCookie).not.toHaveBeenCalled();

    await inspectRoute.handler(
      {},
      {},
      {
        params: {},
        query: {},
        headers: {},
        cookies: { refreshToken: 'clear-me' },
      } as never,
      { setCookie, clearCookie } as never,
    );
    expect(clearCookie).toHaveBeenCalledWith('refreshToken', { path: '/api/auth' });
  });

  it('supports setStatus, setHeader (with CRLF/status guards), and comms.sendSms on module handlers', async () => {
    const authMod = defineModule({
      id: 'identity',
      summary: 'Auth status/header/sms test',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        step: endpoint({
          method: 'POST',
          path: '/api/auth/step',
          auth: 'public',
          body: object({ mode: string() }),
          response: union([
            object({ ok: boolean(), smsSent: optional(boolean()) }),
            object({ requiresTotp: literal(true) }),
          ]),
          summary: 'Step auth flow',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    const authSrv = implementServer(authMod, {
      create: (k) => ({ sendSms: k.comms?.sendSms }),
      handlers: {
        step: async (input, req, s) => {
          if (input.body.mode === 'bad-status-low') {
            req.setStatus?.(99);
            return Promise.resolve({ ok: true });
          }
          if (input.body.mode === 'bad-status-nan') {
            req.setStatus?.(Number.NaN);
            return Promise.resolve({ ok: true });
          }
          if (input.body.mode === 'crlf-header') {
            req.setHeader?.('location', 'https://app.example.com\r\nX-Injected: 1');
            return Promise.resolve({ ok: true });
          }
          if (input.body.mode === 'bad-202-body') {
            req.setStatus?.(202);
            return Promise.resolve({ requiresTotp: false } as never);
          }
          if (input.body.mode === 'challenge') {
            req.setStatus?.(202);
            return Promise.resolve({ requiresTotp: true as const });
          }
          if (input.body.mode === 'redirect') {
            req.setStatus?.(302);
            req.setHeader?.('location', 'https://accounts.example.com/oauth');
            return Promise.resolve({ ok: true });
          }
          const smsRes = await s.sendSms?.({ to: '+15551234567', body: 'Code: 123456' });
          return Promise.resolve({ ok: true, smsSent: smsRes?.success ?? false });
        },
      },
    });

    const sendSms = vi.fn().mockResolvedValueOnce({ success: false, error: 'Carrier rejected' });
    const fakeDb = makeFakeDb();
    const fakeSrv = makeFakeServer();
    registerServerModules(fakeSrv.server, {}, [authSrv], {
      validateResponses: true,
      resolveDb: () => fakeDb.db,
      kernel: {
        ...makeKernel(fakeDb.db),
        comms: { sendSms },
      },
      routerOptions: {
        prefix: '/api',
        jwtSecret: 's',
        authGuardFactory: () => async () => Promise.resolve(),
      },
    });

    const stepRoute = fakeSrv.routes.get('POST /api/auth/step')!;
    const makeReply = () => {
      let sentStatus = 200;
      let sentBody: unknown;
      const headers: Record<string, string> = {};
      return {
        get statusValue() {
          return sentStatus;
        },
        get bodyValue() {
          return sentBody;
        },
        headers,
        header: (k: string, v: string) => {
          headers[k.toLowerCase()] = v;
        },
        status: (code: number) => ({
          send: (payload: unknown) => {
            sentStatus = code;
            sentBody = payload;
          },
        }),
      };
    };

    // Failure 1: out-of-range status code
    await expect(
      stepRoute.handler(
        { body: { mode: 'bad-status-low' }, params: {}, query: {} } as never,
        makeReply() as never,
      ),
    ).rejects.toMatchObject({ statusCode: 500 });

    // Failure 2: NaN status code
    await expect(
      stepRoute.handler(
        { body: { mode: 'bad-status-nan' }, params: {}, query: {} } as never,
        makeReply() as never,
      ),
    ).rejects.toMatchObject({ statusCode: 500 });

    // Failure 3: CRLF injection in response header
    await expect(
      stepRoute.handler(
        { body: { mode: 'crlf-header' }, params: {}, query: {} } as never,
        makeReply() as never,
      ),
    ).rejects.toMatchObject({ statusCode: 500 });

    // Failure 4: invalid 202 response payload still caught by validateResponses
    await expect(
      stepRoute.handler(
        { body: { mode: 'bad-202-body' }, params: {}, query: {} } as never,
        makeReply() as never,
      ),
    ).rejects.toMatchObject({ statusCode: 500 });

    // Failure 5: SMS provider failure surfaces `{ smsSent: false }`
    const smsFailRes = await stepRoute.handler(
      { body: { mode: 'sms' }, params: {}, query: {} } as never,
      makeReply() as never,
    );
    expect(smsFailRes).toEqual({ ok: true, smsSent: false });

    // Positive 1: 202 challenge status + body
    const challengeReply = makeReply();
    await stepRoute.handler(
      { body: { mode: 'challenge' }, params: {}, query: {} } as never,
      challengeReply as never,
    );
    expect(challengeReply.statusValue).toBe(202);
    expect(challengeReply.bodyValue).toEqual({ requiresTotp: true });

    // Positive 2: 302 redirect status + location header
    const redirectReply = makeReply();
    await stepRoute.handler(
      { body: { mode: 'redirect' }, params: {}, query: {} } as never,
      redirectReply as never,
    );
    expect(redirectReply.statusValue).toBe(302);
    expect(redirectReply.headers['location']).toBe('https://accounts.example.com/oauth');
  });

  it('rejects malformed query/body/params before resolving capabilities when endpoint has no requires', async () => {
    const searchMod = defineModule({
      id: 'searchprobe',
      summary: 'Search probe',
      status: 'stable',
      dependsOn: [],
      endpoints: {
        search: endpoint({
          method: 'GET',
          path: '/api/searchprobe',
          auth: 'admin',
          query: object({
            q: string({ min: 1 }),
            limit: optional(number({ coerce: true, max: 100 })),
          }),
          response: object({ ok: boolean() }),
          summary: 'Search',
        }),
      },
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    let contextCalls = 0;
    const srv = implementServer(searchMod, {
      create: () => ({}),
      context: () => {
        contextCalls += 1;
        return {};
      },
      handlers: {
        search: async () => Promise.resolve({ ok: true }),
      },
    });

    const fakeDb = {} as unknown as DbClient;
    const inst = srv.instantiate(makeKernel(fakeDb), {});
    const map = buildModuleRouteMap(inst, {
      resolveDb: () => fakeDb,
      validateResponses: true,
    });
    const searchDef = map.get('searchprobe')!;

    // Failure 1: missing `q` rejects with 400 before invoking context contributor
    await expect(
      searchDef.handler(
        {},
        undefined,
        {
          user: { userId: 'admin-1', email: 'a@example.com', role: 'admin' },
          params: {},
          query: {},
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(contextCalls).toBe(0);

    // Failure 2: out-of-range `limit` rejects with 400 before invoking context contributor
    await expect(
      searchDef.handler(
        {},
        undefined,
        {
          user: { userId: 'admin-1', email: 'a@example.com', role: 'admin' },
          params: {},
          query: { q: 'ada', limit: '500' },
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(contextCalls).toBe(0);

    // Positive: valid query invokes context contributor and succeeds
    const res = await searchDef.handler(
      {},
      undefined,
      {
        user: { userId: 'admin-1', email: 'a@example.com', role: 'admin' },
        params: {},
        query: { q: 'ada', limit: '25' },
      } as never,
      {} as never,
    );
    expect(res).toEqual({ ok: true });
    expect(contextCalls).toBe(1);
  });
});
