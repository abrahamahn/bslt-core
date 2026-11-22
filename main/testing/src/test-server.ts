// main/testing/src/test-server.ts
/**
 * `buildTestServer`: the production HTTP server without a database.
 *
 * For the suites that drive one route map against mock repositories. The
 * server is the one `createServer` builds for production (context hooks, core
 * plugins, compression, security middleware, CSRF, cookies, error handler); nothing
 * of it is assembled here. What the suite supplies is the container the server
 * reads its context from, and the route maps it registers with its own mocks.
 *
 * A suite that needs the database uses `buildTestApp` instead, which also runs
 * the production route registration.
 */

import { createAuthGuard } from '@bslt/identity/server';
import { createServer } from '@bslt/server/bootstrap/app';
import {
  registerRouteMap,
  type HttpServer,
  type InjectOptions,
  type InjectResponse,
  type RouteMap,
  type RouterOptions,
} from '@bslt/server-system/http';

import { createTestConfig, type DeepPartial } from './config';
import { createMockLogger, type MockLogger } from './fakes/logger';
import {
  createMockDb,
  createMockStorageProvider,
  type MockDbClient,
  type MockStorageProvider,
} from './fakes/mock-db';
import {
  createFakeEmailService,
  createFakeErrorTracker,
  type FakeEmailService,
  type FakeErrorTracker,
} from './fakes/ports';
import { getCsrfToken, withCsrf, type CsrfTokenPair } from './http';

import type { AppConfig } from '@bslt/server-system/config';

/**
 * How `inject` handles CSRF.
 *
 * - `auto`: a state-changing request is sent with the token and cookie a
 *   browser would send, unless the test set an `x-csrf-token` header itself.
 * - `manual`: requests go out exactly as written; the suite tests CSRF.
 */
export type CsrfMode = 'auto' | 'manual';

export interface TestServerOptions {
  /** Overrides on the test config (`createTestConfig`). */
  config?: DeepPartial<AppConfig>;
  db?: MockDbClient;
  email?: FakeEmailService;
  storage?: MockStorageProvider;
  /** Default: `auto`. */
  csrf?: CsrfMode;
  /**
   * Run with `env: 'production'`: production security headers, encrypted
   * strict CSRF cookies, production error bodies.
   */
  production?: boolean;
}

export interface TestServer {
  server: HttpServer;
  db: MockDbClient;
  email: FakeEmailService;
  storage: MockStorageProvider;
  log: MockLogger;
  errorTracker: FakeErrorTracker;
  config: AppConfig;
  inject: (options: InjectOptions) => Promise<InjectResponse>;
  close: () => Promise<void>;
  getCsrfToken: () => Promise<CsrfTokenPair>;
  ready: () => Promise<void>;
}

/** Router options; the auth guard defaults to the production `createAuthGuard`. */
export type TestRouteRegistrationOptions = Omit<RouterOptions, 'authGuardFactory'> &
  Partial<Pick<RouterOptions, 'authGuardFactory'>>;

/**
 * The context a route map is being registered with, per test server. The
 * server's `onRoute` hook reads it to bind each route to its suite's context.
 */
const registrations = new WeakMap<HttpServer, { context?: object }>();

/**
 * Give a suite's mock context the one method the request lifecycle calls on a
 * production context. A mock context has one scope: itself.
 */
function asRequestContext(ctx: object): object {
  if (!('contextualize' in ctx)) {
    Object.defineProperty(ctx, 'contextualize', { value: () => ctx, enumerable: false });
  }
  return ctx;
}

/**
 * Bind the routes registered from now on to the context they are registered
 * with. In production every request gets the container's context
 * (`registerContextHooks`), and a handler runs on the request's context, not on
 * the one its route map was registered with. A suite registers each route map
 * with its own mock context, so each route's own `onRequest` hook, which runs
 * after the server's, makes that context the request's.
 */
function bindRouteContexts(server: HttpServer): void {
  const slot: { context?: object } = {};
  registrations.set(server, slot);
  server.addHook('onRoute', (route) => {
    const context = slot.context;
    if (context === undefined) return;
    const bind = (request: unknown, _reply: unknown, done: () => void): void => {
      (request as { context?: object }).context = context;
      done();
    };
    const existing = route.onRequest;
    const rest = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
    route.onRequest = [bind as never, ...rest];
  });
}

/**
 * Register a route map on a test server with the suite's mock context. The
 * guard is the production `createAuthGuard` unless the suite passes its own
 * `authGuardFactory`.
 */
export function registerTestRouteMap(
  app: HttpServer,
  ctx: object,
  routes: RouteMap,
  options: TestRouteRegistrationOptions,
): void {
  const slot = registrations.get(app);
  if (slot !== undefined) slot.context = asRequestContext(ctx);
  try {
    registerRouteMap(app, ctx, routes, {
      authGuardFactory: createAuthGuard,
      ...options,
    });
  } finally {
    if (slot !== undefined) delete slot.context;
  }
}

/**
 * Build the production server over mock services. `ready()` is not called, so
 * the suite can register its route maps first.
 */
export async function buildTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const {
    db = createMockDb(),
    email = createFakeEmailService(),
    storage = createMockStorageProvider(),
    csrf = 'auto',
    production = false,
  } = options;

  const config = createTestConfig({
    ...options.config,
    env: production ? 'production' : 'test',
  });
  const log = createMockLogger();
  const errorTracker = createFakeErrorTracker();

  // The container `createServer` reads: the request context and the tracker.
  const context = { config, db, email, storage, errorTracker, log };
  const container = { config, context, errorTracker } as unknown as Parameters<
    typeof createServer
  >[0]['app'];

  const server = await createServer({ config, app: container });
  bindRouteContexts(server);

  let csrfPair: Promise<CsrfTokenPair> | undefined;
  const csrfFor = (): Promise<CsrfTokenPair> => (csrfPair ??= getCsrfToken(server));

  return {
    server,
    db,
    email,
    storage,
    log,
    errorTracker,
    config,
    inject: async (opts: InjectOptions) => {
      await server.ready();
      return server.inject(csrf === 'auto' ? withCsrf(opts, await csrfFor()) : opts);
    },
    close: async () => {
      await server.close();
    },
    getCsrfToken: async () => {
      await server.ready();
      return getCsrfToken(server);
    },
    ready: async () => {
      await server.ready();
    },
  };
}
