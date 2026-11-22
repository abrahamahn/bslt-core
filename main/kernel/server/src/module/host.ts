// main/kernel/server/src/module/host.ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  AppError,
  AuthenticationError,
  BadRequestError,
  createOrgBitLookup,
  evaluateAuth,
  evaluateRequirement,
  ForbiddenError,
  InternalError,
  lookupErrorCode,
  mergeCapabilityContributions,
  parsePermissionLockfile,
  serializeCapabilityContext,
  validateModules,
  type Auth,
  type CapabilityContext,
  type CapabilityContribution,
  type Requirement,
  type RequirementCode,
  type Viewer,
} from '@bslt/contract';
import { SchemaValidationError, type Schema } from '@bslt/schema';

import { getAuthenticatedUser } from '../http/request-context';
import {
  createRouteMap,
  publicRoute,
  registerRouteMap,
  type HandlerContext,
  type RouteDefinition,
  type RouteMap,
  type RouterOptions,
} from '../http/routing';

import {
  createKernelActionsService,
  createKernelEventsService,
  createKernelJobsService,
  createKernelPrivacyService,
  type AnyServerModule,
  type InstantiatedServerModule,
  type KernelServices,
  type RequestContext,
} from './server-module';

import type { CronScheduler } from '../cron/scheduler';
import type { HttpReply, HttpRequest } from '../http/http';
import type { DbClient, QueueServerJobSpec, TaskHandlers } from '@bslt/db';

export type CapabilityContextResolver = (
  req: HttpRequest,
  viewer: Viewer | null,
) => Promise<CapabilityContext>;

export type ExtraCapabilityContributor = (
  viewer: Viewer | null,
  req: HttpRequest,
) => Promise<CapabilityContribution> | CapabilityContribution;

interface BuildModuleRouteMapOptions {
  readonly resolveDb: (ctx: HandlerContext) => DbClient;
  readonly validateResponses: boolean;
  readonly orgBitLookup?: ((permission: string) => number | undefined) | undefined;
  readonly resolveCapabilities?: CapabilityContextResolver | undefined;
  readonly authenticateOptional?:
    ((req: HttpRequest, reply: HttpReply) => Promise<void>) | undefined;
}

export interface ModuleHostOptions extends BuildModuleRouteMapOptions {
  readonly kernel: Omit<KernelServices, 'jobs' | 'events'> &
    Partial<Pick<KernelServices, 'jobs' | 'events'>>;
  readonly routerOptions: Omit<RouterOptions, 'module'>;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly extraContextContributions?: readonly ExtraCapabilityContributor[] | undefined;
  readonly registerRoutes?: boolean | undefined;
}

export interface PlatformContextRouteOptions {
  readonly resolveCapabilities: CapabilityContextResolver;
  readonly authenticateOptional?:
    ((req: HttpRequest, reply: HttpReply) => Promise<void>) | undefined;
}

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function humanizeErrorName(name: string): string {
  const lowered = name.toLowerCase().replaceAll('_', ' ').trim();
  if (lowered.length === 0) return 'Request failed';
  return `${lowered.charAt(0).toUpperCase()}${lowered.slice(1)}`;
}

function stripApiPrefix(fullPath: string): string {
  return fullPath.replace(/^\/api\/+/u, '');
}

function routeAuthProps(auth: Auth): {
  readonly isPublic: boolean;
  readonly roles: string[];
  readonly auth?: string;
} {
  if (auth === 'public') {
    return { isPublic: true, roles: [] };
  }
  if (typeof auth === 'object' && 'webhook' in auth) {
    return { isPublic: true, roles: [] };
  }
  if (auth === 'admin') {
    return { isPublic: false, roles: ['admin'], auth: 'admin' };
  }
  if (auth === 'moderator') {
    return { isPublic: false, roles: ['moderator'], auth: 'moderator' };
  }
  return { isPublic: false, roles: ['user'], auth: 'user' };
}

function parseSlot(schema: Schema, raw: unknown, slot: 'params' | 'query' | 'body'): unknown {
  try {
    return schema.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : `Invalid request ${slot}`;
    const issues =
      err instanceof SchemaValidationError
        ? [
            {
              message: err.message,
              path: err.path.length > 0 ? [slot, ...err.path] : [slot],
            },
          ]
        : [{ message, path: [slot] }];
    throw new BadRequestError(message, 'VALIDATION_ERROR', { issues });
  }
}

export function extractViewerFromRequest(req: HttpRequest): Viewer | null {
  const user = getAuthenticatedUser(req);
  if (user === undefined) {
    return null;
  }
  const actingOrgCandidate = (
    req as HttpRequest & {
      actingOrg?: { readonly orgId?: unknown; readonly permissions?: unknown };
    }
  ).actingOrg;
  const actingOrg =
    actingOrgCandidate !== undefined &&
    typeof actingOrgCandidate.orgId === 'string' &&
    typeof actingOrgCandidate.permissions === 'bigint'
      ? {
          orgId: actingOrgCandidate.orgId,
          permissions: actingOrgCandidate.permissions,
        }
      : undefined;

  return {
    userId: user.userId,
    role: user.role,
    ...(actingOrg !== undefined ? { actingOrg } : {}),
  };
}

const REQUIREMENT_ERROR_MESSAGES: Readonly<Record<RequirementCode, string>> = {
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  TOS_ACCEPTANCE_REQUIRED: 'You must accept the latest Terms of Service to continue.',
  EMAIL_NOT_VERIFIED: 'You must verify your email address to continue.',
  ENTITLEMENT_REQUIRED: 'An active entitlement is required to access this resource.',
  FEATURE_DISABLED: 'This feature is currently disabled.',
  AGE_ASSURANCE_REQUIRED: 'Age verification is required to access this resource.',
};

export function assertRequirements(
  requirements: readonly Requirement[],
  caps: CapabilityContext,
): void {
  for (const req of requirements) {
    const result = evaluateRequirement(req, caps);
    if (!result.ok) {
      const message = REQUIREMENT_ERROR_MESSAGES[result.code];
      const extraDetails = caps.requirementDetails?.[result.code];
      throw new AppError({
        code: result.code,
        kind: 'authorization',
        statusCode: 403,
        message,
        publicMessage: message,
        retryable: false,
        details: {
          requirement: req,
          ...(extraDetails ?? {}),
        },
      });
    }
  }
}

export function createCapabilityResolver(options: {
  readonly instances:
    ReadonlyMap<string, InstantiatedServerModule> | readonly InstantiatedServerModule[];
  readonly extraContributions?: readonly ExtraCapabilityContributor[] | undefined;
}): CapabilityContextResolver {
  const cache = new WeakMap<object, Promise<CapabilityContext>>();

  const compute = async (req: HttpRequest, viewer: Viewer | null): Promise<CapabilityContext> => {
    const list: readonly InstantiatedServerModule[] = Array.isArray(options.instances)
      ? options.instances
      : [...(options.instances as ReadonlyMap<string, InstantiatedServerModule>).values()];
    const manifestFlagDefaults: Record<string, boolean> = {};
    let hasManifestFlags = false;
    for (const inst of list) {
      if (inst.module.flags !== undefined) {
        for (const [flagKey, flagDef] of Object.entries(inst.module.flags)) {
          manifestFlagDefaults[flagKey] = flagDef.default;
          hasManifestFlags = true;
        }
      }
    }
    const moduleContribs = await Promise.all(list.map((inst) => inst.resolveContext(viewer, req)));
    const extraContribs =
      options.extraContributions !== undefined
        ? await Promise.all(
            options.extraContributions.map((fn) => Promise.resolve(fn(viewer, req))),
          )
        : [];
    return mergeCapabilityContributions({
      modules: list.map((inst) => inst.module),
      viewer,
      contributions: [
        ...(hasManifestFlags ? [{ flags: manifestFlagDefaults }] : []),
        ...moduleContribs,
        ...extraContribs,
      ],
    });
  };

  return (req: HttpRequest, viewer: Viewer | null): Promise<CapabilityContext> => {
    const existing = cache.get(req);
    if (existing !== undefined) {
      return existing;
    }
    const promise = compute(req, viewer);
    cache.set(req, promise);
    return promise;
  };
}

export function buildPlatformContextRouteMap(options: PlatformContextRouteOptions): RouteMap {
  return createRouteMap([
    [
      'platform/context',
      publicRoute(
        'GET',
        async (_ctx, _body, req, reply) => {
          if (options.authenticateOptional !== undefined) {
            await options.authenticateOptional(req, reply);
          }
          const viewer = extractViewerFromRequest(req);
          const caps = await options.resolveCapabilities(req, viewer);
          return serializeCapabilityContext(caps);
        },
        undefined,
        {
          summary: 'Load runtime capability context for the current viewer',
          tags: ['System'],
        },
      ),
    ],
  ]);
}

function createFailFn(moduleId: string): RequestContext['fail'] {
  return (code: string, message?: string, details?: Record<string, unknown>): never => {
    const fullCode = code.includes('.') ? code : `${moduleId}.${code}`;
    const registered = lookupErrorCode(fullCode);
    if (registered === undefined) {
      throw new InternalError(
        message ?? `Unregistered module error: ${fullCode}`,
        fullCode,
        details,
      );
    }
    const resolvedMessage = message ?? humanizeErrorName(registered.name);
    throw new AppError({
      code: registered.code,
      kind: registered.kind,
      statusCode: registered.status,
      message: resolvedMessage,
      publicMessage: resolvedMessage,
      ...(details !== undefined ? { details } : {}),
    });
  };
}

function normalizeBodyForSlot(rawBody: unknown): unknown {
  if (
    typeof rawBody === 'object' &&
    rawBody !== null &&
    'buffer' in rawBody &&
    rawBody.buffer instanceof Uint8Array &&
    'mimetype' in rawBody &&
    typeof rawBody.mimetype === 'string'
  ) {
    const mp = rawBody as {
      buffer: Uint8Array;
      mimetype: string;
      filename?: unknown;
      originalName?: unknown;
      size?: unknown;
    };
    const resolvedName =
      typeof mp.originalName === 'string' && mp.originalName.length > 0
        ? mp.originalName
        : typeof mp.filename === 'string' && mp.filename.length > 0
          ? mp.filename
          : 'upload.bin';
    return {
      filename: resolvedName,
      mimeType: mp.mimetype,
      dataBase64: Buffer.from(mp.buffer).toString('base64'),
      ...(typeof mp.size === 'number' ? { sizeBytes: mp.size } : {}),
    };
  }
  return rawBody;
}

let cachedDefaultOrgBitLookup: ((permission: string) => number | undefined) | null = null;

function resolveDefaultOrgBitLookup(): ((permission: string) => number | undefined) | undefined {
  if (cachedDefaultOrgBitLookup !== null) {
    return cachedDefaultOrgBitLookup;
  }
  const candidates = [
    new URL('../../../../../bslt.lock.json', import.meta.url),
    new URL('../../../../../../bslt.lock.json', import.meta.url),
    new URL('../../../../bslt.lock.json', import.meta.url),
    new URL('../../../bslt.lock.json', import.meta.url),
  ];
  for (const url of candidates) {
    if (url.protocol !== 'file:') {
      continue;
    }
    const filePath = fileURLToPath(url);
    if (existsSync(filePath)) {
      const parsed = parsePermissionLockfile(JSON.parse(readFileSync(filePath, 'utf8')));
      cachedDefaultOrgBitLookup = createOrgBitLookup(parsed);
      return cachedDefaultOrgBitLookup;
    }
  }
  return undefined;
}

export function buildModuleRouteMap(
  instantiated: InstantiatedServerModule,
  options: BuildModuleRouteMapOptions,
): RouteMap {
  const mod = instantiated.module;
  const fail = createFailFn(mod.id);
  const tag = capitalize(mod.id);
  const map: RouteMap = new Map<string, RouteDefinition>();
  const resolveCaps =
    options.resolveCapabilities ?? createCapabilityResolver({ instances: [instantiated] });
  const orgBitLookup = options.orgBitLookup ?? resolveDefaultOrgBitLookup();

  for (const [endpointName, ep] of Object.entries(mod.endpoints)) {
    const relativePath = stripApiPrefix(ep.path);
    const authProps = routeAuthProps(ep.auth);
    const isWebhookAuth = typeof ep.auth === 'object' && 'webhook' in ep.auth;
    const routeOptions: RouteDefinition['routeOptions'] =
      ep.bodyLimit !== undefined || isWebhookAuth
        ? {
            ...(ep.bodyLimit !== undefined ? { bodyLimit: ep.bodyLimit } : {}),
            ...(isWebhookAuth
              ? { rawBody: true, webhookVerified: true, skipBodyInjectionFilter: true }
              : {}),
          }
        : undefined;

    const def: RouteDefinition = {
      method: ep.method,
      isPublic: authProps.isPublic,
      roles: authProps.roles,
      ...(authProps.auth !== undefined ? { auth: authProps.auth } : {}),
      ...(ep.body !== undefined ? { schema: ep.body, skipBodyValidation: true } : {}),
      ...(routeOptions !== undefined ? { routeOptions } : {}),
      openapi: {
        summary: ep.summary,
        tags: [tag],
      },
      handler: async (handlerCtx, rawBody, req, reply) => {
        if (
          ep.auth === 'public' &&
          ep.cache === undefined &&
          options.authenticateOptional !== undefined
        ) {
          await options.authenticateOptional(req, reply);
        }

        const rawUa = (req as Partial<HttpRequest>).headers?.['user-agent'];
        const resolvedUserAgent = Array.isArray(rawUa) ? (rawUa[0] ?? null) : (rawUa ?? null);
        const rawReqRecord = req as unknown as {
          readonly ip?: unknown;
          readonly rawBody?: unknown;
          readonly requestInfo?: { readonly ipAddress?: unknown; readonly ip?: unknown };
        };
        const resolvedIp =
          typeof rawReqRecord.requestInfo?.ipAddress === 'string' &&
          rawReqRecord.requestInfo.ipAddress.length > 0
            ? rawReqRecord.requestInfo.ipAddress
            : typeof rawReqRecord.requestInfo?.ip === 'string' &&
                rawReqRecord.requestInfo.ip.length > 0
              ? rawReqRecord.requestInfo.ip
              : typeof rawReqRecord.ip === 'string' && rawReqRecord.ip.length > 0
                ? rawReqRecord.ip
                : null;

        let verifiedRawBytes: Buffer | undefined;
        let verifiedWebhook: unknown;
        if (typeof ep.auth === 'object' && 'webhook' in ep.auth) {
          const candidateRaw = rawReqRecord.rawBody;
          if (Buffer.isBuffer(candidateRaw)) {
            verifiedRawBytes = candidateRaw;
          } else if (candidateRaw instanceof Uint8Array) {
            verifiedRawBytes = Buffer.from(candidateRaw);
          } else if (typeof candidateRaw === 'string') {
            verifiedRawBytes = Buffer.from(candidateRaw, 'utf8');
          } else {
            throw new BadRequestError('Missing raw webhook request body', 'MISSING_WEBHOOK_BODY');
          }

          try {
            const queryObj: Readonly<Record<string, unknown>> =
              (req as Partial<HttpRequest>).query ?? {};
            const headersObj: Readonly<Record<string, string | readonly string[] | undefined>> =
              (req as Partial<HttpRequest>).headers ?? {};
            verifiedWebhook = await instantiated.verifyWebhook(ep.auth.webhook, {
              rawBody: verifiedRawBytes,
              query: queryObj,
              headers: headersObj,
              sourceIp: resolvedIp,
            });
            if (verifiedWebhook === false) {
              throw new BadRequestError('Invalid webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
            }
          } catch (err: unknown) {
            if (err instanceof AppError) {
              throw err;
            }
            const message = err instanceof Error ? err.message : 'Invalid webhook signature';
            throw new BadRequestError(message, 'WEBHOOK_SIGNATURE_INVALID');
          }
        }

        const viewer = extractViewerFromRequest(req);
        const authResult = evaluateAuth(ep.auth, viewer, orgBitLookup);
        if (!authResult.ok) {
          if (authResult.status === 401) {
            throw new AuthenticationError('Unauthorized', authResult.code);
          }
          throw new ForbiddenError('Forbidden', authResult.code);
        }

        const hasRequirements = ep.requires !== undefined && ep.requires.length > 0;
        let caps: CapabilityContext | undefined;
        if (hasRequirements) {
          caps = await resolveCaps(req, viewer);
          assertRequirements(ep.requires, caps);
        }

        const parsedInput: Record<string, unknown> = {};
        if (ep.params !== undefined) {
          parsedInput['params'] = parseSlot(ep.params, req.params, 'params');
        }
        if (ep.query !== undefined) {
          parsedInput['query'] = parseSlot(ep.query, req.query, 'query');
        }
        if (ep.body !== undefined) {
          parsedInput['body'] = parseSlot(ep.body, normalizeBodyForSlot(rawBody), 'body');
        }

        caps ??= await resolveCaps(req, viewer);

        const rawHeaders = (req as Partial<HttpRequest>).headers;
        const rawCookies = (
          req as unknown as { readonly cookies?: Readonly<Record<string, string | undefined>> }
        ).cookies;
        const replyCookies = reply as unknown as {
          readonly setCookie?: (
            name: string,
            value: string,
            opts?: Record<string, unknown>,
          ) => void;
          readonly clearCookie?: (name: string, opts?: Record<string, unknown>) => void;
        } | null;

        let customStatus: number | undefined;
        const pendingHeaders: Array<readonly [string, string]> = [];

        const reqCtx: RequestContext = {
          viewer,
          caps,
          ip: resolvedIp,
          userAgent: resolvedUserAgent,
          ...(rawHeaders !== undefined ? { headers: rawHeaders } : {}),
          ...(rawCookies !== undefined ? { cookies: rawCookies } : {}),
          ...(typeof replyCookies?.setCookie === 'function'
            ? {
                setCookie: (name, value, opts) => {
                  replyCookies.setCookie?.(name, value, opts ? { ...opts } : undefined);
                },
              }
            : {}),
          ...(typeof replyCookies?.clearCookie === 'function'
            ? {
                clearCookie: (name, opts) => {
                  replyCookies.clearCookie?.(name, opts ? { ...opts } : undefined);
                },
              }
            : {}),
          setStatus: (statusCode) => {
            if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
              throw new InternalError(
                `Invalid HTTP status code ${String(statusCode)} on endpoint "${mod.id}.${endpointName}"`,
              );
            }
            customStatus = statusCode;
          },
          setHeader: (headerName, headerValue) => {
            if (
              headerName.trim().length === 0 ||
              /[\r\n]/u.test(headerName) ||
              /[\r\n]/u.test(headerValue)
            ) {
              throw new InternalError(
                `Invalid HTTP header on endpoint "${mod.id}.${endpointName}"`,
              );
            }
            pendingHeaders.push([headerName, headerValue]);
          },
          ...(verifiedRawBytes !== undefined ? { rawBody: verifiedRawBytes } : {}),
          ...(verifiedWebhook !== undefined ? { verifiedWebhook } : {}),
          tx: <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => {
            const baseDb = options.resolveDb(handlerCtx);
            const scopedDb =
              caps.maxAudience > 0 &&
              typeof (baseDb as Partial<DbClient>).withSession === 'function'
                ? baseDb.withSession({
                    ...(viewer !== null ? { userId: viewer.userId, role: viewer.role } : {}),
                    ...(viewer?.actingOrg !== undefined ? { orgId: viewer.actingOrg.orgId } : {}),
                    maxAudience: caps.maxAudience,
                  })
                : baseDb;
            return scopedDb.transaction(fn);
          },
          fail,
        };

        const out = await instantiated.invokeHandler(endpointName, parsedInput, reqCtx);

        if (options.validateResponses) {
          try {
            ep.response.parse(out);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            throw new InternalError(
              `Endpoint "${mod.id}.${endpointName}" violated its response schema: ${reason}`,
            );
          }
        }

        if (
          ep.cache !== undefined &&
          typeof (reply as Partial<HttpReply> | undefined)?.header === 'function'
        ) {
          reply.header('cache-control', `public, max-age=${String(ep.cache.public)}`);
        }

        if (
          typeof out === 'object' &&
          out !== null &&
          'wire' in out &&
          typeof (out as Record<string, unknown>)['status'] === 'number'
        ) {
          const wireOut = out as {
            readonly status: number;
            readonly wire: unknown;
            readonly headers?: Readonly<Record<string, string>> | undefined;
          };
          if (
            wireOut.headers !== undefined &&
            typeof (reply as Partial<HttpReply> | undefined)?.header === 'function'
          ) {
            for (const [headerName, headerVal] of Object.entries(wireOut.headers)) {
              reply.header(headerName, headerVal);
            }
          }
          return { status: wireOut.status, wire: wireOut.wire };
        }

        if (
          pendingHeaders.length > 0 &&
          typeof (reply as Partial<HttpReply> | undefined)?.header === 'function'
        ) {
          for (const [headerName, headerVal] of pendingHeaders) {
            reply.header(headerName, headerVal);
          }
        }

        const finalStatus = customStatus ?? ep.status;
        if (finalStatus !== undefined && finalStatus !== 200) {
          return { status: finalStatus, body: out };
        }
        return out;
      },
    };

    const mapKey = map.has(relativePath) ? `${ep.method} ${relativePath}` : relativePath;
    map.set(mapKey, def);
  }

  return map;
}

export function registerServerModules(
  server: Parameters<typeof registerRouteMap>[0],
  ctx: HandlerContext,
  modules: readonly AnyServerModule[],
  options: ModuleHostOptions,
): ReadonlyMap<string, InstantiatedServerModule> {
  validateModules(modules.map((m) => m.module));

  const depApis: Record<string, unknown> = {};
  const instances = new Map<string, InstantiatedServerModule>();
  const resolveCapabilities =
    options.resolveCapabilities ??
    createCapabilityResolver({
      instances,
      extraContributions: options.extraContextContributions,
    });
  const resolvedKernel: KernelServices = {
    ...options.kernel,
    actions: options.kernel.actions ?? createKernelActionsService(() => instances.values()),
    privacy: options.kernel.privacy ?? createKernelPrivacyService(() => instances.values()),
    jobs: options.kernel.jobs ?? createKernelJobsService(options.kernel.clock),
    events:
      options.kernel.events ??
      createKernelEventsService({
        sealSecret:
          options.routerOptions.jwtSecret !== ''
            ? options.routerOptions.jwtSecret
            : 'bslt-dev-outbox-seal',
        clock: options.kernel.clock,
      }),
  };

  for (const serverMod of modules) {
    const mod = serverMod.module;
    const scopedDeps: Record<string, unknown> = {};
    for (const dep of mod.dependsOn) {
      if (Object.hasOwn(depApis, dep.id)) {
        scopedDeps[dep.id] = depApis[dep.id];
      }
    }

    const instance = serverMod.instantiate(resolvedKernel, scopedDeps, options.env ?? process.env);
    instances.set(mod.id, instance);
    if (instance.api !== undefined) {
      depApis[mod.id] = instance.api;
    }

    if (options.registerRoutes !== false && Object.keys(mod.endpoints).length > 0) {
      const routeMap = buildModuleRouteMap(instance, {
        ...options,
        resolveCapabilities,
      });
      registerRouteMap(server, ctx, routeMap, {
        ...options.routerOptions,
        module: mod.id,
      });
    }
  }

  return instances;
}

export function collectModuleJobs(
  instances: ReadonlyMap<string, InstantiatedServerModule> | readonly InstantiatedServerModule[],
): {
  readonly handlers: TaskHandlers;
  readonly jobSpecs: Readonly<Record<string, QueueServerJobSpec>>;
} {
  const list: Iterable<InstantiatedServerModule> = Array.isArray(instances)
    ? instances
    : (instances as ReadonlyMap<string, InstantiatedServerModule>).values();
  const handlers: TaskHandlers = {};
  const jobSpecs: Record<string, QueueServerJobSpec> = {};

  for (const inst of list) {
    for (const [jobKey, jobDef] of Object.entries(inst.module.jobs)) {
      handlers[jobDef.name] = async (rawArgs: unknown): Promise<void> => {
        await inst.invokeJob(jobKey, rawArgs);
      };
      jobSpecs[jobDef.name] = {
        queue: jobDef.queue,
        maxAttempts: jobDef.maxAttempts,
        timeoutMs: jobDef.timeoutMs,
      };
    }
  }

  return { handlers, jobSpecs };
}

export function registerModuleCrons(
  scheduler: Pick<CronScheduler, 'register'>,
  instances: ReadonlyMap<string, InstantiatedServerModule> | readonly InstantiatedServerModule[],
  deps: {
    readonly db: DbClient;
    readonly jobs: KernelServices['jobs'];
  },
): void {
  const list: Iterable<InstantiatedServerModule> = Array.isArray(instances)
    ? instances
    : (instances as ReadonlyMap<string, InstantiatedServerModule>).values();

  for (const inst of list) {
    for (const entry of inst.cron) {
      scheduler.register(
        entry.name,
        entry.schedule,
        async ({ cron, scheduledFor }) => {
          await deps.jobs.enqueue(
            deps.db,
            entry.jobDef,
            {},
            { idempotencyKey: `${cron}:${scheduledFor}` },
          );
        },
        { catchUp: entry.catchUp },
      );
    }
  }
}
