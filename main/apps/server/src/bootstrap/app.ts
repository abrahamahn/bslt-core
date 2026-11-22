// main/apps/server/src/bootstrap/app.ts
/**
 * Fastify Server Factory + App DI Container
 *
 * HTTP composition root for the server process:
 * - `createServer()` assembles the Fastify instance (plugins, middleware)
 * - `App` delegates all service access to the injected `InfraContext`
 */

import path from 'node:path';

import {
  HTTP_STATUS,
  LIMITS,
  type EmailService,
  type ErrorTracker,
  type NotificationService,
  type StorageClient,
} from '@bslt/contract';
import {
  type DbClient,
  type QueueStore,
  type ServerSearchProvider,
  type SessionContext,
} from '@bslt/db';
import {
  createHttpServer,
  type HttpRequest,
  type HttpServer,
  type HttpServerRequest,
} from '@bslt/server-system/http';
import {
  createKernelEventsService,
  type InstantiatedServerModule,
  type KernelServices,
} from '@bslt/server-system/module';
import {
  startDbHealthSampler,
  startEventLoopLagSampler,
  startOtlpHttpTelemetry,
} from '@bslt/server-system/observability';
import {
  RateLimiter,
  RedisRateLimitStore,
  createIpBlocklistMiddleware,
  type RateLimitInfo,
  type RateLimitStore,
} from '@bslt/server-system/security';

import { registerRoutes, type RegisterRoutesOptions } from '../http/router';
import {
  applyApiCacheHeaders,
  applyCors,
  applySecurityHeaders,
  createGeoBlockMiddleware,
  createGeoProvider,
  getProductionSecurityDefaults,
  handlePreflight,
  registerCompression,
  registerCookies,
  registerCsrf,
  registerInputValidation,
  registerMultipartFormParser,
  registerPrototypePollutionProtection,
  registerStaticServe,
} from '../middleware';
import {
  errorHandlerPlugin,
  loggerPlugin,
  registerCorrelationIdHook,
  registerRawBodyCapture,
  registerRequestInfoHook,
  type CorrelationIdOptions,
} from '../plugin';

import { contextualizeRequest } from './context';

import type {
  AppContext,
  HasContext,
  InfraContext,
  IServiceContainer,
  RequestWithCookies,
} from './context';
import type { SmsProvider } from '@bslt/comms';
import type { SubscriptionManager } from '@bslt/realtime';
import type { AppConfig } from '@bslt/server-system/config';
import type { Logger } from '@bslt/server-system/logger';
import type { HealthCheckCache, HealthCheckQueue } from '@bslt/server-system/runtime';

// ============================================================================
// Types
// ============================================================================

interface ServerDependencies {
  config: AppConfig;
  app: IServiceContainer & HasContext;
  httpMode?: 'full' | 'probes-only' | undefined;
}

/** One route as the HTTP server registered it. */
export interface AppRoute {
  /** Upper-case HTTP method. A route registered for several methods is listed once per method. */
  readonly method: string;
  /** Full path, prefix included, with `:param` placeholders. */
  readonly url: string;
}

const routeRecords = new WeakMap<HttpServer, AppRoute[]>();

/**
 * Record every route registered on `server` from now on, plugin routes
 * included. Called first in `createServer`, before anything can add a route.
 */
function recordRoutes(server: HttpServer): void {
  const routes: AppRoute[] = [];
  routeRecords.set(server, routes);
  server.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      routes.push({ method: method.toUpperCase(), url: route.url });
    }
  });
}

/**
 * The routes registered on a server built by `createServer`, in registration
 * order. Complete once the server is ready (plugins register theirs while it
 * loads).
 */
function listRoutes(server: HttpServer): readonly AppRoute[] {
  return [...(routeRecords.get(server) ?? [])];
}

// ============================================================================
// Private Server Composition Helpers
// ============================================================================

/**
 * Give every request its context: the boot context first (system pool), which
 * the auth guard replaces with the user-session scope once it knows the user.
 *
 * Exported so the real-DB suites install exactly these hooks on their own
 * HTTP server instance instead of imitating them.
 */
function registerContextHooks(
  server: HttpServer,
  app: IServiceContainer & HasContext,
  config: AppConfig,
): void {
  server.addHook('onRequest', (req, _reply, done) => {
    (req as HttpServerRequest & Partial<RequestWithCookies>).context = app.context;
    done();
  });

  // Dev-only: log auth requests for transport debugging (request logging is
  // globally disabled, so auth hits need explicit visibility).
  if (config.env === 'development') {
    server.addHook('onRequest', (req, _reply, done) => {
      if (req.url.startsWith('/api/auth/')) {
        server.log.info(`Auth request ${req.method} ${req.url}`);
      }
      done();
    });

    server.addHook('onResponse', (req, reply, done) => {
      if (req.url.startsWith('/api/auth/')) {
        server.log.info(`Auth response ${String(reply.statusCode)} ${req.method} ${req.url}`);
      }
      done();
    });
  }

  // RLS contextualization for auth systems that attach req.user before route preHandlers.
  // Route-map auth guards also call this after token authentication.
  server.addHook('preHandler', async (req, reply) => {
    await contextualizeRequest(req, reply);
  });
}

function registerCorePlugins(server: HttpServer, appLog: Logger): void {
  registerCompression(server);
  registerPrototypePollutionProtection(server);
  registerMultipartFormParser(server);
  registerRawBodyCapture(server);

  const correlationOptions: CorrelationIdOptions = {};
  registerCorrelationIdHook(server, correlationOptions);
  registerRequestInfoHook(server);

  // server.appLog must be decorated BEFORE registering loggerPlugin —
  // loggerPlugin throws on startup if the decoration is absent, and it should
  // run after the correlation-id hook so request logging uses the canonical ID.
  server.decorate('appLog', appLog);
  loggerPlugin(server);
}

function createRateLimitStore(config: AppConfig): RateLimitStore | undefined {
  if (!config.cache.useExternalProvider) {
    if (config.env === 'production') {
      throw new Error(
        'Production rate limiting requires an external cache provider. Set CACHE_PROVIDER=redis and configure Redis.',
      );
    }
    return undefined;
  }

  const redis = config.cache.externalConfig;
  if (redis === undefined) {
    throw new Error('CACHE_PROVIDER=redis requires Redis connection settings.');
  }

  return new RedisRateLimitStore({
    host: redis.host,
    port: redis.port,
    ...(redis.password !== undefined ? { password: redis.password } : {}),
    ...(redis.db !== undefined ? { db: redis.db } : {}),
    ...(redis.tls !== undefined ? { tls: redis.tls } : {}),
    keyPrefix: 'bslt:rate-limit',
    recordTtlMs: config.server.rateLimit.windowMs * 2,
  });
}

function registerSecurityMiddleware(
  server: HttpServer,
  config: AppConfig,
  errorTracker: ErrorTracker,
  httpMode: 'full' | 'probes-only' = 'full',
): void {
  const isProd = config.env === 'production';
  const isDev = config.env === 'development';

  // IP blocklist runs first so denied addresses are rejected before any other
  // work (rate-limit, CORS, handlers). Stays inert unless a list is configured.
  const { blocklist, strictBlocklist, allowlist } = config.server.ipBlocklist;
  if (blocklist.length > 0 || strictBlocklist.length > 0) {
    const ipBlocklistHook = createIpBlocklistMiddleware({
      globalBlocklist: blocklist,
      strictBlocklist,
      allowlist,
      onBlocked: (ip, reason) => {
        server.log.warn({ ip, reason }, 'Request rejected by IP blocklist');
      },
    });
    // Bridge Fastify's request/reply to the framework-agnostic middleware shape.
    server.addHook('onRequest', async (req, res) => {
      await ipBlocklistHook(req as unknown as HttpRequest, res);
    });
  }

  const corsOrigin = config.server.cors.origin.join(',');
  const corsCredentials = config.server.cors.credentials;
  const corsMethods = config.server.cors.methods;
  const cookieSecret = config.auth.cookie.secret;
  const rateLimitStore = createRateLimitStore(config);
  const rateLimiter = new RateLimiter({
    ...config.server.rateLimit,
    ...(rateLimitStore !== undefined ? { store: rateLimitStore } : {}),
  });
  const RATE_LIMIT_CHECK_TIMEOUT_MS = 1500;

  server.addHook('onClose', async () => {
    await rateLimiter.destroy();
  });

  server.addHook('onRequest', async (req, res) => {
    applySecurityHeaders(res, isProd ? getProductionSecurityDefaults() : {});

    if (typeof req.url === 'string' && req.url.startsWith('/api/')) {
      applyApiCacheHeaders(res);
    }

    applyCors(req, res, {
      origin: corsOrigin,
      credentials: corsCredentials,
      allowedMethods: corsMethods,
    });

    if (handlePreflight(req, res)) return;

    const rateLimitStart = Date.now();
    let rateLimitInfo: RateLimitInfo = {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      limit: Number.MAX_SAFE_INTEGER,
      resetMs: 0,
    };

    try {
      const timeoutPromise = new Promise<RateLimitInfo>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Rate limiter check timed out'));
        }, RATE_LIMIT_CHECK_TIMEOUT_MS);
      });
      rateLimitInfo = await Promise.race([rateLimiter.check(req.ip), timeoutPromise]);
    } catch (error) {
      server.log.error({ err: error, path: req.url, ip: req.ip }, 'Rate limiter check failed');
      if (!isDev) {
        res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).send({
          error: 'Service Unavailable',
          message: 'Rate limiter unavailable. Please try again shortly.',
        });
        return;
      }
    }

    const rateLimitDurationMs = Date.now() - rateLimitStart;
    if (rateLimitDurationMs > 250) {
      server.log.warn(
        { path: req.url, ip: req.ip, rateLimitDurationMs },
        'Rate limiter check latency',
      );
    }

    res.header('X-RateLimit-Limit', String(rateLimitInfo.limit));
    res.header('X-RateLimit-Remaining', String(rateLimitInfo.remaining));
    res.header('X-RateLimit-Reset', String(Math.ceil(rateLimitInfo.resetMs / 1000)));

    if (!rateLimitInfo.allowed) {
      res.status(HTTP_STATUS.TOO_MANY_REQUESTS).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(rateLimitInfo.resetMs / 1000),
      });
      return;
    }
  });

  // Jurisdiction gate. Inert by default — the starter blocks nowhere; it fires
  // only when BLOCKED_REGIONS is configured. It can only see what the CDN tells
  // it: an unknown location is never blocked.
  //
  // Registered AFTER the CORS hook on purpose: the 403 is meant to be READ by
  // the browser (the SPA branches on `JURISDICTION_BLOCKED` and can route to
  // the unavailable page). Sent before CORS headers were applied, it would
  // reach the SPA as an opaque network error instead — a block nobody could
  // explain to the person blocked.
  const { blockedRegions, countryHeader, regionHeaders } = config.server.geo;
  if (blockedRegions.length > 0) {
    const geoProvider = createGeoProvider({ countryHeader, regionHeaders });
    const geoBlockHook = createGeoBlockMiddleware({
      blockedRegions,
      provider: geoProvider,
      onBlocked: (jurisdiction, request) => {
        server.log.warn(
          { jurisdiction, path: request.url },
          'Request rejected: blocked jurisdiction',
        );
      },
    });

    server.log.info(
      { blockedRegions, geoProvider: geoProvider.name, countryHeader },
      geoProvider.name === 'null'
        ? 'Geo blocking configured with NO location source — no request can be blocked by region'
        : 'Geo blocking active',
    );

    // Bridge Fastify's request/reply to the framework-agnostic middleware shape.
    // `done()` runs only when the gate did not answer the request — sending and
    // continuing the lifecycle are mutually exclusive in Fastify.
    server.addHook('onRequest', (req, res, done) => {
      const blocked = geoBlockHook(req as unknown as HttpRequest, res);
      if (!blocked) done();
    });
  }

  registerCookies(server, { secret: cookieSecret });

  registerCsrf(server, {
    secret: cookieSecret,
    encrypted: isProd,
    cookieOpts: {
      signed: true,
      sameSite: isProd ? 'strict' : 'lax',
      httpOnly: true,
      secure: isProd,
    },
  });

  if (httpMode !== 'probes-only') {
    server.get('/api/csrf-token', (_req, reply) => {
      const token = reply.generateCsrf();
      return { token };
    });
  }

  void server.register(errorHandlerPlugin, { isProduction: isProd, errorTracker });

  if (httpMode !== 'probes-only' && config.storage.provider === 'local') {
    // Serves only URLs signed by the local provider (same secret), never bare paths.
    registerStaticServe(server, {
      root: path.resolve(config.storage.rootPath),
      prefix: '/uploads/',
      signingSecret: config.storage.signingSecret,
    });
  }
}

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure a Fastify server instance.
 *
 * @param deps.app - Optional DI container. When provided, the Hybrid Context hook
 *                   attaches `app.context` to every request, enabling RLS scoping.
 * @returns Configured Fastify instance (ready for `listen`).
 */
export async function createServer(deps: ServerDependencies): Promise<HttpServer> {
  const { config, app, httpMode = 'full' } = deps;
  const appLog: Logger = app.context.log;

  const server = createHttpServer({
    loggerInstance: app.context.log,
    disableRequestLogging: true,
    trustProxy: config.server.trustProxy,
    bodyLimit: LIMITS.HTTP_BODY_LIMIT_BYTES,
  });

  recordRoutes(server);
  registerContextHooks(server, app, config);
  registerCorePlugins(server, appLog);
  registerSecurityMiddleware(server, config, app.errorTracker, httpMode);
  registerInputValidation(server);
  // Load the plugins queued above (the error handler) before returning, so the
  // routes and hooks the caller adds next land on a configured server in both
  // HTTP modes, not on one whose plugins load later, at ready().
  await server.after();

  return server;
}

/**
 * Returns true if the error indicates the TCP port is already bound.
 */
export function isAddrInUse(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'EADDRINUSE'
  );
}

// ============================================================================
// App — DI container (composition root for the server process)
// ============================================================================

export class App implements IServiceContainer {
  readonly config: AppConfig;
  readonly events: KernelServices['events'];

  /** Shared pub/sub manager composed during infra bootstrap. */
  public get pubsub(): SubscriptionManager {
    return this.infraContext.pubsub;
  }

  private _server: HttpServer | null = null;
  private _moduleInstances: ReadonlyMap<string, InstantiatedServerModule> = new Map();

  constructor(
    config: AppConfig,
    private readonly infraContext: InfraContext,
    private readonly routeOptions: RegisterRoutesOptions = {},
  ) {
    this.config = config;
    this.events = createKernelEventsService({
      sealSecret: config.auth.jwt.secret,
      clock: { now: () => new Date() },
    });
  }

  async init(): Promise<void> {
    if (this._server) return;
    this._server = await createServer({
      config: this.config,
      app: this,
      ...(this.routeOptions.httpMode !== undefined ? { httpMode: this.routeOptions.httpMode } : {}),
    });
    this._moduleInstances = await registerRoutes(this._server, this.context, this.routeOptions);
    startDbHealthSampler(this._server, this.db);
    startEventLoopLagSampler(this._server);
    startOtlpHttpTelemetry(this._server);
  }

  get moduleInstances(): ReadonlyMap<string, InstantiatedServerModule> {
    return this._moduleInstances;
  }

  async start(port: number, host: string): Promise<void> {
    await this.server.ready();
    await this.server.listen({ port, host });
  }

  async stop(): Promise<void> {
    if (this._server) {
      await this._server.close();
      this._server = null;
    }
  }

  get context(): AppContext {
    return {
      config: this.config,
      db: this.db,
      repos: this.repos,
      system: this.system,
      email: this.email,
      storage: this.storage,
      notifications: this.notifications,
      search: this.search,
      queue: this.queue,
      queueStore: this.queueStore,
      pubsub: this.pubsub,
      cache: this.cache,
      emailTemplates: this.emailTemplates,
      sms: this.sms,
      errorTracker: this.errorTracker,
      events: this.events,
      log: this.log,
      contextualize: this.contextualize.bind(this),
    };
  }

  get server(): HttpServer {
    if (this._server === null) throw new Error('App not initialized — call init() first');
    return this._server;
  }

  contextualize(session: SessionContext): AppContext {
    const { db, repos } = this.infraContext.contextualize(session);
    return { ...this.context, db, repos };
  }

  get log(): Logger {
    if (this._server) return this._server.log;
    return this.infraContext.log;
  }

  get db(): DbClient {
    return this.infraContext.db;
  }
  get repos(): IServiceContainer['repos'] {
    return this.infraContext.repos;
  }
  /** Always the boot handles: `contextualize` replaces `db`/`repos`, never these. */
  get system(): IServiceContainer['system'] {
    return { db: this.infraContext.db, repos: this.infraContext.repos };
  }
  get email(): EmailService | undefined {
    return this.infraContext.email;
  }
  get storage(): StorageClient | undefined {
    return this.infraContext.storage;
  }
  get notifications(): NotificationService | undefined {
    return this.infraContext.notifications;
  }
  get search(): ServerSearchProvider {
    return this.infraContext.search;
  }
  get queue(): HealthCheckQueue {
    return this.infraContext.queue;
  }
  get queueStore(): QueueStore {
    return this.infraContext.queueStore;
  }
  get cache(): HealthCheckCache {
    return this.infraContext.cache;
  }
  get emailTemplates(): IServiceContainer['emailTemplates'] {
    return this.infraContext.emailTemplates;
  }
  get sms(): SmsProvider | undefined {
    return this.infraContext.sms;
  }
  get errorTracker(): ErrorTracker {
    return this.infraContext.errorTracker;
  }

  /** Every route registered on the server so far (see `listRoutes`). */
  routes(): readonly AppRoute[] {
    return this._server === null ? [] : listRoutes(this._server);
  }

  countRegisteredRoutes(): number {
    if (this._server === null) return 0;
    const printRoutes = (this._server as { printRoutes?: () => unknown }).printRoutes;
    if (typeof printRoutes !== 'function') return 0;
    const routes = printRoutes();
    if (typeof routes !== 'string') return 0;
    return routes
      .split('\n')
      .filter((line) => line.trim().startsWith('│') || line.trim().startsWith('└')).length;
  }
}
