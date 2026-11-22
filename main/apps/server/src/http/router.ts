// main/apps/server/src/http/router.ts
/**
 * App Route Composition
 *
 * App-owned route composition concerns:
 * - auth-strategy filtering
 * - selected OpenAPI annotations
 * - module/prefix orchestration
 * - billing webhook raw Fastify endpoints
 * - the ToS re-acceptance gate on protected routes (with its exempt paths)
 *
 * Canonical Fastify route registration lives in `@bslt/server-system/http`.
 *
 * @module router
 */

import { createAuthGuard } from '@bslt/identity/server';
import { buildRealtimeTicketRouteMap } from '@bslt/realtime';
import { registerRouteMap } from '@bslt/server-system/http';
import {
  assertRequirements,
  buildPlatformContextRouteMap,
  collectModuleNotificationKinds,
  createCapabilityResolver,
  createKernelActionsService,
  createKernelEventsService,
  createKernelJobsService,
  createKernelPrivacyService,
  extractViewerFromRequest,
  probeServiceStatus,
  registerServerModules,
  type AnyServerModule,
  type CapabilityContextResolver,
  type InstantiatedServerModule,
  type KernelServices,
} from '@bslt/server-system/module';
import { buildPlatformErrorsRouteMap } from '@bslt/server-system/observability';

import { contextualizeRequest } from '../bootstrap/context';
import { devOnlyServerModules, installedServerModules } from '../generated/modules';

import { createAppRouteModuleRegistrations } from './route-modules';
import { systemRoutes } from './system-routes';

import type { AppContext } from '../bootstrap/context';
import type { AppConfig } from '@bslt/server-system/config';
import type {
  AuthGuardFactory,
  HttpServer,
  HttpServerReply,
  HttpServerRequest,
  RouterOptions,
} from '@bslt/server-system/http';

// ============================================================================

function createModuleAuthGuardFactory(ctx: Pick<AppContext, 'repos'>): AuthGuardFactory {
  return (secret: string, ...roles: string[]) => {
    const authGuard = createAuthGuard(secret, ctx.repos, ...roles);
    return async (request, reply) => {
      await authGuard(request, reply);
      await contextualizeRequest(request as HttpServerRequest, reply as HttpServerReply);
    };
  };
}

/**
 * The guard app-owned protected routes run: token authentication, RLS
 * contextualization, then generic `CapabilityContext` requirement evaluation
 * (`['tos.accepted']`). Native modules declare `ep.requires: ['tos.accepted']`
 * directly on their endpoints (`auth/tos/status` and `auth/tos/accept` on
 * `@bslt/compliance`, plus `users/me` and `auth/logout-all` on `@bslt/identity`,
 * omit `requires` so gated users can inspect and clear the gate or sign out).
 */
interface AppRouterCapabilitiesOptions {
  readonly resolveCapabilities?: CapabilityContextResolver | undefined;
  readonly instances?:
    ReadonlyMap<string, InstantiatedServerModule> | readonly InstantiatedServerModule[] | undefined;
}

function createAppAuthGuardFactory(
  ctx: Pick<AppContext, 'repos'> & Partial<Pick<AppContext, 'config'>>,
  options?: AppRouterCapabilitiesOptions,
): AuthGuardFactory {
  const resolveCapabilities =
    options?.resolveCapabilities ??
    createCapabilityResolver({
      instances: options?.instances ?? [],
    });

  return (secret: string, ...roles: string[]) => {
    const authGuard = createAuthGuard(secret, ctx.repos, ...roles);
    return async (request, reply) => {
      await authGuard(request, reply);
      await contextualizeRequest(request as HttpServerRequest, reply as HttpServerReply);
      const viewer = extractViewerFromRequest(request);
      const caps = await resolveCapabilities(request, viewer);
      assertRequirements(['tos.accepted'], caps);
    };
  };
}

/** What every app route map is registered with: the `/api` prefix and the guard above. */
type AppRouterOptions = Pick<RouterOptions, 'prefix' | 'jwtSecret' | 'authGuardFactory'>;

/**
 * Router options for app-owned route maps.
 */
export function createAppRouterOptions(
  ctx: Pick<AppContext, 'repos' | 'config'>,
  options?: AppRouterCapabilitiesOptions,
): AppRouterOptions {
  return {
    prefix: '/api',
    jwtSecret: ctx.config.auth.jwt.secret,
    authGuardFactory: createAppAuthGuardFactory(ctx, options),
  };
}

export interface RegisterRoutesOptions {
  readonly modules?: readonly AnyServerModule[] | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly httpMode?: 'full' | 'probes-only' | undefined;
}

function resolveWebPushHandle(ctx: AppContext): NonNullable<KernelServices['comms']>['webPush'] {
  const provider = ctx.notifications?.getWebPushProvider?.();
  if (
    typeof provider === 'object' &&
    provider !== null &&
    'isConfigured' in provider &&
    typeof provider.isConfigured === 'function' &&
    'getPublicKey' in provider &&
    typeof provider.getPublicKey === 'function' &&
    'sendBatch' in provider &&
    typeof provider.sendBatch === 'function'
  ) {
    return provider as NonNullable<KernelServices['comms']>['webPush'];
  }
  return undefined;
}

function resolveKernelStorage(ctx: AppContext): KernelServices['storage'] {
  const raw = ctx.storage;
  if (raw === undefined) {
    return undefined;
  }
  const providerName = ctx.config.storage.provider === 's3' ? 's3' : 'local';
  const rich = raw as unknown as Record<string, unknown>;
  return {
    providerName,
    upload: (key, data, contentType) => raw.upload(key, data, contentType),
    download: (key) => raw.download(key),
    delete: (key) => raw.delete(key),
    getSignedUrl: (key, expiresInSeconds) => raw.getSignedUrl(key, expiresInSeconds ?? 3600),
    ...(typeof rich['getSignedUploadUrl'] === 'function'
      ? {
          getSignedUploadUrl: (key: string, contentType: string, expiresInSeconds?: number) =>
            (
              rich['getSignedUploadUrl'] as (k: string, ct: string, exp?: number) => Promise<string>
            )(key, contentType, expiresInSeconds),
        }
      : {}),
    ...(typeof rich['head'] === 'function'
      ? {
          head: (key: string) =>
            (rich['head'] as NonNullable<NonNullable<KernelServices['storage']>['head']>)(key),
        }
      : {}),
    ...(typeof rich['copy'] === 'function'
      ? {
          copy: (sourceKey: string, destinationKey: string) =>
            (rich['copy'] as (src: string, dst: string) => Promise<void>)(
              sourceKey,
              destinationKey,
            ),
        }
      : {}),
    ...(typeof rich['createMultipartUpload'] === 'function'
      ? {
          createMultipartUpload: (key: string, contentType: string) =>
            (
              rich['createMultipartUpload'] as NonNullable<
                NonNullable<KernelServices['storage']>['createMultipartUpload']
              >
            )(key, contentType),
        }
      : {}),
    ...(typeof rich['getSignedPartUploadUrl'] === 'function'
      ? {
          getSignedPartUploadUrl: (
            key: string,
            uploadId: string,
            partNumber: number,
            expiresInSeconds?: number,
          ) =>
            (
              rich['getSignedPartUploadUrl'] as NonNullable<
                NonNullable<KernelServices['storage']>['getSignedPartUploadUrl']
              >
            )(key, uploadId, partNumber, expiresInSeconds),
        }
      : {}),
    ...(typeof rich['uploadPart'] === 'function'
      ? {
          uploadPart: (
            key: string,
            uploadId: string,
            partNumber: number,
            data: Buffer | Uint8Array,
          ) =>
            (
              rich['uploadPart'] as NonNullable<
                NonNullable<KernelServices['storage']>['uploadPart']
              >
            )(key, uploadId, partNumber, data),
        }
      : {}),
    ...(typeof rich['listUploadedParts'] === 'function'
      ? {
          listUploadedParts: (key: string, uploadId: string) =>
            (
              rich['listUploadedParts'] as NonNullable<
                NonNullable<KernelServices['storage']>['listUploadedParts']
              >
            )(key, uploadId),
        }
      : {}),
    ...(typeof rich['completeMultipartUpload'] === 'function'
      ? {
          completeMultipartUpload: (
            key: string,
            uploadId: string,
            parts: ReadonlyArray<{ readonly partNumber: number; readonly etag: string }>,
          ) =>
            (
              rich['completeMultipartUpload'] as NonNullable<
                NonNullable<KernelServices['storage']>['completeMultipartUpload']
              >
            )(key, uploadId, parts),
        }
      : {}),
    ...(typeof rich['abortMultipartUpload'] === 'function'
      ? {
          abortMultipartUpload: (key: string, uploadId: string) =>
            (rich['abortMultipartUpload'] as (k: string, id: string) => Promise<void>)(
              key,
              uploadId,
            ),
        }
      : {}),
  };
}

function buildModuleKernel(
  ctx: AppContext,
  moduleInstances: ReadonlyMap<string, InstantiatedServerModule>,
): KernelServices {
  const clock = { now: () => new Date() };
  const emailService = ctx.email;
  const smsService = ctx.sms;
  const kernelStorage = resolveKernelStorage(ctx);
  return {
    ...(kernelStorage !== undefined ? { storage: kernelStorage } : {}),
    db: {
      system: <T>(fn: Parameters<AppContext['db']['transaction']>[0]): Promise<T> =>
        ctx.system.db.transaction(fn) as Promise<T>,
      viewer: <T>(
        viewer: Parameters<NonNullable<KernelServices['db']['viewer']>>[0],
        fn: Parameters<AppContext['db']['transaction']>[0],
      ): Promise<T> => {
        if (viewer === null) {
          // An anonymous viewer reads as the app role with no user id, so only rows
          // every viewer may read qualify; it never borrows the worker's reach.
          return ctx.contextualize({}).db.transaction(fn) as Promise<T>;
        }
        const scoped = ctx.contextualize({
          userId: viewer.userId,
          role: viewer.role,
          ...(viewer.actingOrg !== undefined ? { tenantId: viewer.actingOrg.orgId } : {}),
        }).db;
        return scoped.transaction(fn) as Promise<T>;
      },
    },
    jobs: createKernelJobsService(clock),
    actions: createKernelActionsService(() => moduleInstances.values()),
    privacy: createKernelPrivacyService(() => moduleInstances.values()),
    events:
      ctx.events ??
      createKernelEventsService({
        sealSecret: ctx.config.auth.jwt.secret,
        clock,
      }),
    log: ctx.log,
    clock,
    health: {
      probeComponents: async () => {
        const [database, cache, queue, storage, email] = await Promise.all([
          probeServiceStatus(ctx.db),
          probeServiceStatus(ctx.cache),
          probeServiceStatus(ctx.queue),
          probeServiceStatus(ctx.storage),
          probeServiceStatus(ctx.email),
        ]);
        return { database, cache, queue, storage, email };
      },
      uptimeSeconds: () => Math.round(process.uptime()),
      queueStats: async () => {
        const queueServer = ctx.queue as
          { getStats?: () => Promise<{ pending: number; failed: number }> } | undefined;
        if (queueServer?.getStats === undefined) {
          return null;
        }
        try {
          return await queueServer.getStats();
        } catch {
          return null;
        }
      },
    },
    comms: {
      appBaseUrl: ctx.config.server.appBaseUrl,
      hmacSecret: ctx.config.auth.jwt.secret,
      ...(emailService !== undefined
        ? {
            sendEmail: async (emailOpts) => {
              const res = await emailService.send({
                to: emailOpts.to,
                subject: emailOpts.subject,
                text: emailOpts.text,
                ...(emailOpts.html !== undefined ? { html: emailOpts.html } : {}),
                ...(emailOpts.headers !== undefined ? { headers: { ...emailOpts.headers } } : {}),
              });
              return {
                success: res.success,
                ...(res.error !== undefined ? { error: res.error } : {}),
              };
            },
          }
        : {}),
      ...((ctx as Partial<AppContext>).emailTemplates !== undefined
        ? { emailTemplates: ctx.emailTemplates as unknown as Readonly<Record<string, unknown>> }
        : {}),
      ...(smsService !== undefined
        ? {
            sendSms: async (smsOpts) => {
              const res = await smsService.send({ to: smsOpts.to, body: smsOpts.body });
              return {
                success: res.success,
                ...(res.error !== undefined ? { error: res.error } : {}),
              };
            },
          }
        : {}),
      webPush: resolveWebPushHandle(ctx),
      resolveNotificationKind: (kind) =>
        collectModuleNotificationKinds(moduleInstances.values()).get(kind),
      publishRealtimeInvalidation: (key, version) => {
        if (key.startsWith('record:')) {
          try {
            ctx.pubsub.publish(key as `record:${string}:${string}`, version);
          } catch (err: unknown) {
            ctx.log.warn({ err, key }, 'Failed to publish realtime invalidation');
          }
        }
      },
    },
  };
}

function billingEnvFromConfig(
  billing: AppConfig['billing'] | undefined,
): Record<string, string | undefined> {
  if (billing === undefined) {
    return {};
  }
  return {
    BILLING_ENABLED: String(billing.enabled),
    BILLING_PROVIDER: billing.provider,
    ...(billing.currency.length === 3 ? { BILLING_CURRENCY: billing.currency } : {}),
    STRIPE_SECRET_KEY: billing.stripe.secretKey,
    STRIPE_PUBLISHABLE_KEY: billing.stripe.publishableKey,
    STRIPE_WEBHOOK_SECRET: billing.stripe.webhookSecret,
    PAYPAL_CLIENT_ID: billing.paypal.clientId,
    PAYPAL_CLIENT_SECRET: billing.paypal.clientSecret,
    PAYPAL_WEBHOOK_ID: billing.paypal.webhookId,
    PAYPAL_MODE: billing.paypal.sandbox ? 'sandbox' : 'production',
    PAYPAL_BRAND_NAME: billing.paypal.brandName,
    BILLING_PORTAL_RETURN_URL: billing.urls.portalReturnUrl,
    BILLING_CHECKOUT_SUCCESS_URL: billing.urls.checkoutSuccessUrl,
    BILLING_CHECKOUT_CANCEL_URL: billing.urls.checkoutCancelUrl,
  };
}

function identityEnvFromConfig(config: AppConfig): Record<string, string | undefined> {
  const auth = config.auth as Partial<AppConfig['auth']>;
  const argon2 = auth.argon2;
  const cookie = auth.cookie;
  const totp = auth.totp;
  const webauthn = auth.webauthn;
  const lockout = auth.lockout;
  const captcha = auth.captcha;
  const magicLink = auth.magicLink;
  const oauth = auth.oauth;
  const appName = (config as Partial<AppConfig>).app?.name;
  return {
    ...(typeof appName === 'string' && appName.length > 0 ? { APP_NAME: appName } : {}),
    JWT_SECRET: config.auth.jwt.secret,
    JWT_ACCESS_EXPIRY: String(config.auth.jwt.accessTokenExpiry),
    APP_BASE_URL: config.server.appBaseUrl,
    ...(typeof config.server.apiBaseUrl === 'string' && config.server.apiBaseUrl.length > 0
      ? { API_BASE_URL: config.server.apiBaseUrl }
      : {}),
    ...(argon2 !== undefined
      ? {
          ARGON2_TYPE: String(argon2.type),
          ARGON2_MEMORY_COST: String(argon2.memoryCost),
          ARGON2_TIME_COST: String(argon2.timeCost),
          ARGON2_PARALLELISM: String(argon2.parallelism),
        }
      : {}),
    ...(auth.refreshToken?.expiryDays !== undefined
      ? { REFRESH_EXPIRY_DAYS: String(auth.refreshToken.expiryDays) }
      : {}),
    ...(auth.refreshToken?.gracePeriodSeconds !== undefined
      ? { REFRESH_GRACE_PERIOD_SECONDS: String(auth.refreshToken.gracePeriodSeconds) }
      : {}),
    ...(auth.sessions?.maxConcurrentSessions !== undefined
      ? { MAX_CONCURRENT_SESSIONS: String(auth.sessions.maxConcurrentSessions) }
      : {}),
    ...(auth.autoVerifyEmail !== undefined
      ? { AUTH_AUTO_VERIFY_EMAIL: String(auth.autoVerifyEmail) }
      : {}),
    ...(lockout !== undefined
      ? {
          LOCKOUT_MAX_ATTEMPTS: String(lockout.maxAttempts),
          LOCKOUT_DURATION_MS: String(lockout.lockoutDurationMs),
          LOCKOUT_PROGRESSIVE_DELAY: String(lockout.progressiveDelay),
          LOCKOUT_BASE_DELAY_MS: String(lockout.baseDelayMs),
        }
      : {}),
    ...(captcha !== undefined
      ? {
          CAPTCHA_ENABLED: String(captcha.enabled),
          CAPTCHA_SECRET_KEY: captcha.secretKey,
        }
      : {}),
    ...(magicLink !== undefined
      ? {
          MAGIC_LINK_EXPIRY_MINUTES: String(magicLink.tokenExpiryMinutes),
          MAGIC_LINK_MAX_ATTEMPTS: String(magicLink.maxAttempts),
        }
      : {}),
    ...(cookie !== undefined
      ? {
          COOKIE_HTTP_ONLY: String(cookie.httpOnly),
          COOKIE_SECURE: String(cookie.secure),
          COOKIE_SAME_SITE: cookie.sameSite,
          COOKIE_PATH: cookie.path,
          ...(typeof cookie.secret === 'string' && cookie.secret.length > 0
            ? { COOKIE_SECRET: cookie.secret }
            : {}),
        }
      : {}),
    ...(oauth !== undefined
      ? {
          GOOGLE_CLIENT_ID: oauth.google?.clientId,
          GOOGLE_CLIENT_SECRET: oauth.google?.clientSecret,
          GOOGLE_CALLBACK_URL: oauth.google?.callbackUrl,
          GITHUB_CLIENT_ID: oauth.github?.clientId,
          GITHUB_CLIENT_SECRET: oauth.github?.clientSecret,
          GITHUB_CALLBACK_URL: oauth.github?.callbackUrl,
          KAKAO_CLIENT_ID: oauth.kakao?.clientId,
          KAKAO_CLIENT_SECRET: oauth.kakao?.clientSecret,
          KAKAO_CALLBACK_URL: oauth.kakao?.callbackUrl,
          APPLE_CLIENT_ID: oauth.apple?.clientId,
          APPLE_CALLBACK_URL: oauth.apple?.callbackUrl,
          APPLE_TEAM_ID: oauth.apple?.teamId,
          APPLE_KEY_ID: oauth.apple?.keyId,
          APPLE_PRIVATE_KEY: oauth.apple?.privateKey,
          APPLE_PRIVATE_KEY_BASE64: undefined,
        }
      : {}),
    ...(typeof auth.oauthTokenEncryptionKey === 'string' &&
    auth.oauthTokenEncryptionKey.length >= 32
      ? { OAUTH_TOKEN_ENCRYPTION_KEY: auth.oauthTokenEncryptionKey }
      : {}),
    ...(totp !== undefined
      ? {
          TOTP_ISSUER: totp.issuer,
          TOTP_WINDOW: String(totp.window),
        }
      : {}),
    ...(Array.isArray(auth.strategies) ? { AUTH_STRATEGIES: auth.strategies.join(',') } : {}),
    ...(webauthn !== undefined
      ? {
          WEBAUTHN_RP_NAME: webauthn.rpName,
          WEBAUTHN_RP_ID: webauthn.rpId,
          WEBAUTHN_ORIGIN: webauthn.origin,
          ...(webauthn.attestation !== undefined
            ? { WEBAUTHN_ATTESTATION: webauthn.attestation }
            : {}),
        }
      : {}),
  };
}

function buildModuleEnv(
  ctx: AppContext,
  explicitEnv: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string | undefined>> {
  return {
    ...process.env,
    ...identityEnvFromConfig(ctx.config),
    ...billingEnvFromConfig(ctx.config.billing),
    ...(explicitEnv ?? {}),
  };
}

export async function registerRoutes(
  app: HttpServer,
  ctx: AppContext,
  options: RegisterRoutesOptions = {},
): Promise<ReadonlyMap<string, InstantiatedServerModule>> {
  const moduleInstances = new Map<string, InstantiatedServerModule>();
  const resolveCapabilities = createCapabilityResolver({
    instances: moduleInstances,
  });
  const appRouterOptions: AppRouterOptions = createAppRouterOptions(ctx, {
    resolveCapabilities,
  });
  const moduleRouterOptions: AppRouterOptions = {
    prefix: '/api',
    jwtSecret: ctx.config.auth.jwt.secret,
    authGuardFactory: createModuleAuthGuardFactory(ctx),
  };
  const routeServer = app as Parameters<typeof registerRouteMap>[0];
  const modules =
    options.modules ??
    (ctx.config.env === 'production'
      ? installedServerModules
      : [...installedServerModules, ...devOnlyServerModules]);
  const moduleEnv = buildModuleEnv(ctx, options.env);

  if (options.httpMode === 'probes-only') {
    registerRouteMap(routeServer, ctx, systemRoutes, {
      ...appRouterOptions,
      prefix: '',
      module: 'system',
    });
    if (modules.length > 0) {
      const registered = registerServerModules(routeServer, ctx, modules, {
        kernel: buildModuleKernel(ctx, moduleInstances),
        routerOptions: moduleRouterOptions,
        resolveDb: (handlerCtx) => (handlerCtx as AppContext).db,
        resolveCapabilities,
        validateResponses: ctx.config.env !== 'production',
        registerRoutes: false,
        env: moduleEnv,
      });
      for (const [id, inst] of registered) {
        moduleInstances.set(id, inst);
      }
    }
    return moduleInstances;
  }

  const appRouteModules = await createAppRouteModuleRegistrations(ctx.config.auth.strategies);

  const optionalViewerAuthGuard = createAuthGuard(ctx.config.auth.jwt.secret, ctx.repos);
  const authenticateOptional = async (
    req: Parameters<typeof optionalViewerAuthGuard>[0],
    reply: Parameters<typeof optionalViewerAuthGuard>[1],
  ): Promise<void> => {
    const authHeader = req.headers['authorization'];
    const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (typeof raw !== 'string' || raw.trim() === '') {
      return;
    }
    await optionalViewerAuthGuard(req, reply);
    await contextualizeRequest(req as HttpServerRequest, reply as HttpServerReply);
  };
  const platformContextRoutes = buildPlatformContextRouteMap({
    resolveCapabilities,
    authenticateOptional,
  });
  registerRouteMap(routeServer, ctx, platformContextRoutes, {
    ...moduleRouterOptions,
    module: 'system',
  });
  registerRouteMap(routeServer, ctx, buildPlatformErrorsRouteMap(), {
    ...moduleRouterOptions,
    module: 'system',
  });
  registerRouteMap(routeServer, ctx, buildRealtimeTicketRouteMap({ authenticateOptional }), {
    ...moduleRouterOptions,
    module: 'realtime',
  });

  for (const { module, routes, prefix } of appRouteModules) {
    registerRouteMap(routeServer, ctx, routes, {
      ...appRouterOptions,
      ...(prefix !== undefined ? { prefix } : {}),
      module,
    });
  }

  if (modules.length > 0) {
    const registered = registerServerModules(routeServer, ctx, modules, {
      kernel: buildModuleKernel(ctx, moduleInstances),
      routerOptions: moduleRouterOptions,
      resolveDb: (handlerCtx) => (handlerCtx as AppContext).db,
      resolveCapabilities,
      authenticateOptional,
      validateResponses: ctx.config.env !== 'production',
      env: moduleEnv,
    });
    for (const [id, inst] of registered) {
      moduleInstances.set(id, inst);
    }
  }

  return moduleInstances;
}
