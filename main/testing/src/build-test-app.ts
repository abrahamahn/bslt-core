// main/testing/src/build-test-app.ts
/**
 * `buildTestApp`: the production `buildApp()` on a test database.
 *
 * A suite gets the server `main.ts` boots: the same phases, pools (`bslt_app`
 * for user sessions, `bslt_worker` for system work), route registration, guard
 * chain and middleware. Only two things differ, both through `buildApp`'s own
 * seams: the config points at the suite's isolated database, and the external
 * ports are fakes (email, SMS, storage, push, error tracker, logger), so
 * nothing leaves the process and a test can assert on what would have.
 */

import { buildApp, type BuiltApp, type ProcessRole } from '@bslt/server/bootstrap/build-app';
import { createAppRouterOptions } from '@bslt/server/http';
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
  createFakeEmailService,
  createFakeErrorTracker,
  createFakeNotificationService,
  createFakeSmsProvider,
  createFakeStorage,
  type FakeEmailService,
  type FakeErrorTracker,
  type FakeNotificationService,
  type FakeSmsProvider,
  type FakeStorage,
} from './fakes/ports';
import { getCsrfToken, withCsrf, type CsrfTokenPair } from './http';

import type { TestDatabase } from './database';
import type { CsrfMode } from './test-server';
import type { App, AppRoute } from '@bslt/server/bootstrap/app';
import type { AppContext, AppPorts } from '@bslt/server/bootstrap/context';
import type { AppConfig } from '@bslt/server-system/config';

/** The replaceable ports (`AppPorts`), each as whatever double the suite has. */
export type TestPorts = Readonly<Partial<Record<keyof AppPorts, unknown>>>;

/** A route map a suite adds to the production routes (a probe, a fixture). */
export interface ExtraRoutes {
  readonly routes: RouteMap;
  readonly options?: Partial<Pick<RouterOptions, 'prefix' | 'module'>>;
}

export interface BuildTestAppOptions {
  /** The suite's isolated database (`describeRealDb`). */
  readonly database: TestDatabase;
  /** Overrides on the test config (`createTestConfig`). */
  readonly config?: DeepPartial<AppConfig>;
  /**
   * Ports to use in place of the kit's fakes. A named key wins, `undefined`
   * included (`{ storage: undefined }` runs the app without storage). Test
   * doubles are accepted as they are: a suite's double implements what its
   * tests reach, not the whole port.
   */
  readonly ports?: TestPorts;
  /** Route maps registered after the production ones, with the production guard. */
  readonly extraRoutes?: readonly ExtraRoutes[];
  /** Anything else to do to the composed app before it is ready. */
  readonly extend?: (app: App) => void | Promise<void>;
  /** Default: `auto` (see `CsrfMode`). */
  readonly csrf?: CsrfMode;
  /** Default: `all`. */
  readonly role?: ProcessRole;
  /** Module `env` map (defaults to `{}` so `process.env` never leaks into test apps). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Start background runtimes (QueueServer, outbox dispatcher, cron) for end-to-end async suites. */
  readonly workers?: boolean;
}

/** The fakes a test app runs on unless the suite replaced them. */
export interface TestAppFakes {
  readonly log: MockLogger;
  readonly email: FakeEmailService;
  readonly sms: FakeSmsProvider;
  readonly storage: FakeStorage;
  readonly notifications: FakeNotificationService;
  readonly errorTracker: FakeErrorTracker;
}

export interface TestApp extends TestAppFakes {
  /** What `buildApp` returned. */
  readonly built: BuiltApp;
  /** The composed HTTP server. Ready; not listening. */
  readonly server: HttpServer;
  /**
   * The boot context: system pool (`bslt_worker`). It is what public routes and
   * the guard see; a protected request's handler gets a session-scoped copy.
   */
  readonly ctx: AppContext;
  readonly config: AppConfig;
  /** Every route the app registered. */
  routes(): readonly AppRoute[];
  inject(options: InjectOptions): Promise<InjectResponse>;
  getCsrfToken(): Promise<CsrfTokenPair>;
  /** Kept for suites written against the two-step server; the app is already ready. */
  ready(): Promise<void>;
  /** Stop the app and close its pools. The database stays (the suite owns it). */
  close(): Promise<void>;
}

let appSequence = 0;

/** `url` with an `application_name`, so every test app gets pools of its own. */
function namedConnection(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', name);
  return parsed.toString();
}

/**
 * Boot the production app on `database` and return it ready for `inject()`.
 *
 * @param options - The database, and what the suite changes.
 * @returns The app, its fakes, and `inject`.
 */
export async function buildTestApp(options: BuildTestAppOptions): Promise<TestApp> {
  const { database, csrf = 'auto' } = options;

  // In test mode the server caches pools by connection string. Two apps of one
  // suite (two configs on one database) must not share, and so close, a pool.
  appSequence += 1;
  const name = `bslt-test-app-${String(process.pid)}-${String(appSequence)}`;
  const config = createTestConfig({
    ...options.config,
    database: {
      ...options.config?.database,
      connectionString: namedConnection(database.appConnectionString, name),
      workerConnectionString: namedConnection(database.connectionString, name),
      listenConnectionString: namedConnection(database.connectionString, `${name}-listen`),
    },
  });

  const fakes: TestAppFakes = {
    log: createMockLogger(),
    email: createFakeEmailService(),
    sms: createFakeSmsProvider(),
    storage: createFakeStorage(),
    notifications: createFakeNotificationService(),
    errorTracker: createFakeErrorTracker(),
  };

  const built = await buildApp(config, {
    ...(options.role !== undefined ? { role: options.role } : {}),
    env: options.env ?? {},
    ports: { ...fakes, ...options.ports } as AppPorts,
    extend: async (app) => {
      const routerOptions = createAppRouterOptions(app.context, {
        instances: app.moduleInstances,
      });
      for (const extra of options.extraRoutes ?? []) {
        registerRouteMap(app.server, app.context, extra.routes, {
          ...routerOptions,
          ...extra.options,
        });
      }
      await options.extend?.(app);
    },
  });

  try {
    await built.ready();
    if (options.workers === true) {
      await built.startWorkers();
    }
  } catch (error) {
    await built.stop();
    throw error;
  }

  let csrfPair: Promise<CsrfTokenPair> | undefined;
  const csrfFor = (): Promise<CsrfTokenPair> => (csrfPair ??= getCsrfToken(built.server));

  return {
    ...fakes,
    built,
    server: built.server,
    ctx: built.context,
    config,
    routes: () => built.routes(),
    inject: async (opts) =>
      built.server.inject(csrf === 'auto' ? withCsrf(opts, await csrfFor()) : opts),
    getCsrfToken: () => getCsrfToken(built.server),
    ready: () => built.ready(),
    close: () => built.stop(),
  };
}
