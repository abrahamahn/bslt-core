// main/kernel/server/src/module/server-module.ts
import { insertOutboxEvent, PostgresQueueStore, type DbClient } from '@bslt/db';
import {
  describe,
  SchemaValidationError,
  type Infer,
  type Schema,
  type SchemaNode,
} from '@bslt/schema';

import { parseCron } from '../cron/cron-parser';

import { sealEventPayload } from './sealed';

import type { Logger } from '../logger/types';
import type {
  Auth,
  BsltConfig,
  CapabilityContext,
  CapabilityContribution,
  EventDef,
  InputOf,
  JobDef,
  ModuleDefinition,
  OutputOf,
  Viewer,
} from '@bslt/contract';

export type Tx = DbClient;

export interface Clock {
  now(): Date;
}

interface EnqueueJobOptions {
  readonly idempotencyKey?: string | undefined;
  readonly scheduledAt?: Date | undefined;
  readonly priority?: number | undefined;
}

interface KernelJobsService {
  enqueue<N extends string, S extends Schema>(
    tx: Tx,
    def: JobDef<N, S>,
    payload: Infer<S>,
    options?: EnqueueJobOptions,
  ): Promise<string>;
}

export function createKernelJobsService(clock: Clock): KernelJobsService {
  return {
    async enqueue<N extends string, S extends Schema>(
      tx: Tx,
      def: JobDef<N, S>,
      payload: Infer<S>,
      options?: EnqueueJobOptions,
    ): Promise<string> {
      const parsed = def.payload.parse(payload);
      const id = crypto.randomUUID();
      const nowIso = clock.now().toISOString();
      const store = new PostgresQueueStore(tx);
      await store.enqueue({
        id,
        name: def.name,
        queue: def.queue,
        priority: options?.priority ?? 0,
        args: parsed,
        scheduledAt:
          options?.scheduledAt !== undefined ? options.scheduledAt.toISOString() : nowIso,
        attempts: 0,
        maxAttempts: def.maxAttempts,
        createdAt: nowIso,
        ...(options?.idempotencyKey !== undefined
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
      });
      return id;
    },
  };
}

interface PublishEventOptions {
  readonly actorUserId?: string | null | undefined;
  readonly orgId?: string | null | undefined;
}

interface KernelEventsService {
  publish<N extends string, S extends Schema>(
    tx: Tx,
    def: EventDef<N, S>,
    payload: Infer<S>,
    options?: PublishEventOptions,
  ): Promise<void>;
}

export function createKernelEventsService(options: {
  readonly sealSecret: string;
  readonly clock: Clock;
}): KernelEventsService {
  return {
    async publish<N extends string, S extends Schema>(
      tx: Tx,
      def: EventDef<N, S>,
      payload: Infer<S>,
      publishOptions?: PublishEventOptions,
    ): Promise<void> {
      const version = def.version ?? 1;
      const aad = `${def.name}:v${String(version)}`;
      const sealedResult = sealEventPayload(def.payload, payload, options.sealSecret, aad);
      const occurredAt = options.clock.now().toISOString();
      const explicitActor =
        publishOptions?.actorUserId !== undefined ? publishOptions.actorUserId : null;
      const explicitOrg = publishOptions?.orgId !== undefined ? publishOptions.orgId : null;

      await insertOutboxEvent(tx, {
        name: def.name,
        version,
        payloadJson: JSON.stringify(sealedResult.payload),
        sealed: sealedResult.sealed,
        actorUserId: explicitActor,
        orgId: explicitOrg,
        occurredAt,
      });
    },
  };
}

export interface DeliveredEvent<P = unknown> {
  readonly eventId: string;
  readonly name: string;
  readonly version: number;
  readonly payload: P;
  readonly actorUserId: string | null;
  readonly orgId: string | null;
  readonly occurredAt: string;
  readonly def?: EventDef | undefined;
}

type ProjectionFlag = 'webhook' | 'audit' | 'activity' | 'notify' | 'analytics';

interface DirectSubscription<S = unknown, N extends string = string, PS extends Schema = Schema> {
  readonly kind: 'direct';
  readonly id: string;
  readonly event: EventDef<N, PS>;
  readonly handle: (event: DeliveredEvent<Infer<PS>>, service: S) => Promise<void>;
}

interface FlaggedSubscription<S = unknown, F extends ProjectionFlag = ProjectionFlag> {
  readonly kind: 'flagged';
  readonly id: string;
  readonly flag: F;
  readonly handle: (event: DeliveredEvent<Record<string, unknown>>, service: S) => Promise<void>;
}

// Bivariant method wrapper allows typed DirectSubscription<S, N, PS> to widen cleanly to Subscription<S>.
interface SubscriptionMethod<S> {
  bivarianceHack(event: DeliveredEvent<never>, service: S): Promise<void>;
}

interface ErasedSubscriptionBase<S> {
  readonly id: string;
  readonly handle: SubscriptionMethod<S>['bivarianceHack'];
}

type ErasedDirectSubscription<S> = ErasedSubscriptionBase<S> & {
  readonly kind: 'direct';
  readonly event: EventDef;
};

type ErasedFlaggedSubscription<S> = ErasedSubscriptionBase<S> & {
  readonly kind: 'flagged';
  readonly flag: ProjectionFlag;
};

type Subscription<S = unknown> = ErasedDirectSubscription<S> | ErasedFlaggedSubscription<S>;

const SUBSCRIBER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

function assertValidSubscriberId(id: string): void {
  if (!SUBSCRIBER_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid subscriber id "${id}": expected lowercase slug matching /^[a-z][a-z0-9_-]*$/`,
    );
  }
}

export function on<N extends string, PS extends Schema, S = unknown>(
  eventDef: EventDef<N, PS>,
  spec: {
    readonly id: string;
    readonly handle: (event: DeliveredEvent<Infer<PS>>, service: S) => Promise<void>;
  },
): Subscription<S> {
  assertValidSubscriberId(spec.id);
  const typed: DirectSubscription<S, N, PS> = {
    kind: 'direct',
    id: spec.id,
    event: eventDef,
    handle: spec.handle,
  };
  return typed;
}

export function onFlagged<S = unknown>(
  flag: ProjectionFlag,
  spec: {
    readonly id: string;
    readonly handle: (event: DeliveredEvent<Record<string, unknown>>, service: S) => Promise<void>;
  },
): Subscription<S> {
  assertValidSubscriberId(spec.id);
  const typed: FlaggedSubscription<S> = {
    kind: 'flagged',
    id: spec.id,
    flag,
    handle: spec.handle,
  };
  return typed;
}

interface KernelDbService {
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  viewer<T>(viewer: Viewer | null, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

type KernelComponentName = 'database' | 'cache' | 'queue' | 'storage' | 'email';
type KernelComponentState = 'up' | 'down' | 'unknown';

interface KernelHealthService {
  probeComponents(): Promise<Readonly<Record<KernelComponentName, KernelComponentState>>>;
  uptimeSeconds?: (() => number) | undefined;
  queueStats?:
    (() => Promise<{ readonly pending: number; readonly failed: number } | null>) | undefined;
}

function hasHealthCheck(value: unknown): value is { healthCheck: () => Promise<boolean> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'healthCheck' in value &&
    typeof (value as { healthCheck?: unknown }).healthCheck === 'function'
  );
}

/**
 * Probe a service handle for liveness without leaking provider names, latencies,
 * or error internals. Shared by kernel health wiring and status/admin probes.
 */
export async function probeServiceStatus(value: unknown): Promise<KernelComponentState> {
  if (value === null || value === undefined) {
    return 'unknown';
  }
  if (!hasHealthCheck(value)) {
    return 'up';
  }
  try {
    const healthy = await value.healthCheck();
    return healthy ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export type NotificationTemplate<P = Readonly<Record<string, unknown>>> = (payload: P) => {
  readonly title?: string | undefined;
  readonly message: string;
  readonly level?: 'info' | 'success' | 'warning' | 'error' | undefined;
  readonly emailSubject?: string | undefined;
  readonly emailText?: string | undefined;
  readonly emailHtml?: string | undefined;
  readonly url?: string | undefined;
  readonly data?: Readonly<Record<string, unknown>> | undefined;
};

export interface KernelStorageService {
  readonly providerName: 'local' | 's3';
  upload(key: string, data: Buffer | Uint8Array, contentType: string): Promise<string>;
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getSignedUploadUrl?(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  head?(key: string): Promise<
    | { readonly exists: false }
    | {
        readonly exists: true;
        readonly sizeBytes: number;
        readonly contentType?: string | undefined;
        readonly etag?: string | undefined;
      }
  >;
  copy?(sourceKey: string, destinationKey: string): Promise<void>;
  createMultipartUpload?(key: string, contentType: string): Promise<{ readonly uploadId: string }>;
  getSignedPartUploadUrl?(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds?: number,
  ): Promise<string>;
  uploadPart?(
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer | Uint8Array,
  ): Promise<{ readonly etag: string }>;
  listUploadedParts?(
    key: string,
    uploadId: string,
  ): Promise<
    ReadonlyArray<{ readonly partNumber: number; readonly etag: string; readonly size: number }>
  >;
  completeMultipartUpload?(
    key: string,
    uploadId: string,
    parts: ReadonlyArray<{ readonly partNumber: number; readonly etag: string }>,
  ): Promise<{ readonly etag: string }>;
  abortMultipartUpload?(key: string, uploadId: string): Promise<void>;
}

export type ModuleActionHandler<S = unknown, R = unknown> = (
  s: S,
  tx: Tx,
  input: unknown,
) => Promise<R>;

interface KernelActionsService {
  invoke<R = unknown>(actionKey: string, tx: Tx, input: unknown): Promise<R>;
  has(actionKey: string): boolean;
  list(): readonly string[];
}

export interface ModulePrivacyHooks<S = unknown> {
  exportUser(s: S, userId: string): Promise<Readonly<Record<string, unknown>>>;
  eraseUser(s: S, tx: Tx, userId: string): Promise<void>;
}

export interface KernelPrivacyService {
  exportUser(userId: string): Promise<Readonly<Record<string, Readonly<Record<string, unknown>>>>>;
  eraseUser(tx: Tx, userId: string): Promise<void>;
  modules(): readonly string[];
}

export interface KernelServices {
  readonly db: {
    system<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
    /**
     * Runs `fn` with the viewer's own database reach. `null` is an anonymous
     * end user, never the system role. Required for any module that calls
     * `k.db.viewer`: without it the call rejects.
     */
    viewer?: (<T>(viewer: Viewer | null, fn: (tx: Tx) => Promise<T>) => Promise<T>) | undefined;
  };
  readonly jobs: KernelJobsService;
  readonly events: KernelEventsService;
  readonly log: Logger;
  readonly clock: Clock;
  readonly health?: KernelHealthService | undefined;
  readonly storage?: KernelStorageService | undefined;
  readonly actions?: KernelActionsService | undefined;
  readonly privacy?: KernelPrivacyService | undefined;
  readonly comms?:
    | {
        readonly appBaseUrl?: string | undefined;
        readonly hmacSecret?: string | undefined;
        readonly sendEmail?:
          | ((options: {
              readonly to: string;
              readonly subject: string;
              readonly text: string;
              readonly html?: string | undefined;
              readonly headers?: Readonly<Record<string, string>> | undefined;
            }) => Promise<{ readonly success: boolean; readonly error?: string | undefined }>)
          | undefined;
        readonly emailTemplates?: Readonly<Record<string, unknown>> | undefined;
        readonly sendSms?:
          | ((options: {
              readonly to: string;
              readonly body: string;
            }) => Promise<{ readonly success: boolean; readonly error?: string | undefined }>)
          | undefined;
        readonly webPush?:
          | {
              isConfigured(): boolean;
              getPublicKey(): string | undefined;
              sendBatch(
                subscriptions: ReadonlyArray<{
                  readonly id: string;
                  readonly subscription: {
                    readonly endpoint: string;
                    readonly expirationTime: number | null;
                    readonly keys: { readonly p256dh: string; readonly auth: string };
                  };
                }>,
                payload: {
                  readonly title: string;
                  readonly body: string;
                  readonly url?: string | undefined;
                  readonly data?: Record<string, unknown> | undefined;
                },
              ): Promise<{ readonly expiredSubscriptions: readonly string[] }>;
            }
          | undefined;
        readonly resolveNotificationKind?:
          ((kind: string) => NotificationTemplate | undefined) | undefined;
        readonly publishRealtimeInvalidation?: ((key: string, version: number) => void) | undefined;
      }
    | undefined;
}

export interface ContextRequestMetadata {
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>> | undefined;
  readonly ip?: string | undefined;
}

export interface WebhookVerifierInput {
  readonly rawBody: Buffer;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly sourceIp: string | null;
}

export type WebhookVerifier<S = unknown> = (input: WebhookVerifierInput, service: S) => unknown;

export interface RequestContext<
  Errors extends readonly string[] = readonly string[],
  A extends Auth = Auth,
> {
  readonly viewer: A extends 'public' | { readonly webhook: string; readonly rawBody: true }
    ? Viewer | null
    : Viewer;
  readonly caps: CapabilityContext;
  readonly ip?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>> | undefined;
  readonly cookies?: Readonly<Record<string, string | undefined>> | undefined;
  readonly setCookie?:
    ((name: string, value: string, opts?: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly clearCookie?:
    ((name: string, opts?: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly setStatus?: ((statusCode: number) => void) | undefined;
  readonly setHeader?: ((name: string, value: string) => void) | undefined;
  readonly rawBody?: Buffer | undefined;
  readonly verifiedWebhook?: unknown;
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  fail(code: Errors[number] | string, message?: string, details?: Record<string, unknown>): never;
}

export type DepApis<D extends readonly ModuleDefinition[]> = Partial<
  Readonly<Record<D[number]['id'], unknown>>
>;

interface ModuleCronEntry<JobKey extends string = string> {
  readonly job: JobKey;
  readonly schedule: string;
  readonly catchUp?: boolean | undefined;
}

interface ResolvedModuleCron {
  readonly name: string;
  readonly jobDef: JobDef;
  readonly schedule: string;
  readonly catchUp: boolean;
}

export interface InstantiatedServerModule<M extends ModuleDefinition = ModuleDefinition> {
  readonly module: M;
  readonly api: unknown;
  readonly subscribers: readonly Subscription[];
  readonly cron: readonly ResolvedModuleCron[];
  readonly actionKeys?: readonly string[] | undefined;
  readonly hasPrivacy?: boolean | undefined;
  readonly notificationKinds?: Readonly<Record<string, NotificationTemplate>> | undefined;
  invokeHandler(endpointName: string, input: unknown, req: RequestContext): Promise<unknown>;
  invokeJob(jobKey: string, payload: unknown): Promise<void>;
  invokeSubscriber(subscriberId: string, event: DeliveredEvent): Promise<void>;
  invokeAction(actionKey: string, tx: Tx, input: unknown): Promise<unknown>;
  verifyWebhook(verifierName: string, input: WebhookVerifierInput): Promise<unknown>;
  readonly exportUserPrivacy?:
    ((userId: string) => Promise<Readonly<Record<string, unknown>>>) | undefined;
  readonly eraseUserPrivacy?: ((tx: Tx, userId: string) => Promise<void>) | undefined;
  resolveContext(
    viewer: Viewer | null,
    req?: ContextRequestMetadata,
  ): Promise<CapabilityContribution>;
}

export interface AnyServerModule<M extends ModuleDefinition = ModuleDefinition> {
  readonly module: M;
  readonly migrations?: URL | undefined;
  instantiate(
    kernel: KernelServices,
    depApis: Readonly<Record<string, unknown>>,
    rawEnv?: Readonly<Record<string, string | undefined>>,
  ): InstantiatedServerModule<M>;
}

type ModuleEnvOf<M extends ModuleDefinition> = M['env'] extends Schema<infer E> ? E : undefined;

type KernelServicesWithEnv<M extends ModuleDefinition> = Omit<KernelServices, 'db'> & {
  readonly db: KernelDbService;
  readonly env: ModuleEnvOf<M>;
};

type JobPayloadOf<J> = J extends JobDef<string, infer PS> ? Infer<PS> : never;

type ModuleJobsHandlers<M extends ModuleDefinition, S> = {
  readonly [K in keyof M['jobs']]: (payload: JobPayloadOf<M['jobs'][K]>, s: S) => Promise<void>;
};

type ModuleJobsSlot<M extends ModuleDefinition, S> = [keyof M['jobs']] extends [never]
  ? { readonly jobs?: ModuleJobsHandlers<M, NoInfer<S>> | undefined }
  : { readonly jobs: ModuleJobsHandlers<M, NoInfer<S>> };

interface ServerModuleSpecBase<M extends ModuleDefinition, S, A = never> {
  readonly migrations?: URL | undefined;
  readonly create: (k: KernelServicesWithEnv<M>, deps: DepApis<M['dependsOn']>) => S;
  readonly handlers: {
    readonly [K in keyof M['endpoints']]: (
      input: InputOf<M['endpoints'][K]>,
      req: RequestContext<NonNullable<M['endpoints'][K]['errors']>, M['endpoints'][K]['auth']>,
      s: NoInfer<S>,
    ) => Promise<OutputOf<M['endpoints'][K]>>;
  };
  readonly api?: ((s: NoInfer<S>) => A) | undefined;
  readonly subscribers?: readonly Subscription<NoInfer<S>>[] | undefined;
  readonly cron?: readonly ModuleCronEntry<keyof M['jobs'] & string>[] | undefined;
  readonly context?:
    | ((
        s: NoInfer<S>,
        viewer: Viewer | null,
        req?: ContextRequestMetadata,
      ) => Promise<CapabilityContribution> | CapabilityContribution)
    | undefined;
  readonly actions?: Readonly<Record<string, ModuleActionHandler<NoInfer<S>>>> | undefined;
  readonly verifiers?: Readonly<Record<string, WebhookVerifier<NoInfer<S>>>> | undefined;
  readonly privacy?: ModulePrivacyHooks<NoInfer<S>> | undefined;
  readonly notificationKinds?: Readonly<Record<string, NotificationTemplate>> | undefined;
}

type ServerModuleSpec<M extends ModuleDefinition, S, A = never> = ServerModuleSpecBase<M, S, A> &
  ModuleJobsSlot<M, S>;

export interface ServerModule<M extends ModuleDefinition = ModuleDefinition, S = unknown, A = never>
  extends AnyServerModule<M>, ServerModuleSpecBase<M, S, A> {
  readonly jobs?: ModuleJobsHandlers<M, S> | undefined;
}

function validateServerSubscribers<S>(
  module: ModuleDefinition,
  subscribers: readonly Subscription<S>[] | undefined,
): void {
  if (subscribers === undefined || subscribers.length === 0) return;

  const allowedDeps = new Set(module.dependsOn.map((d) => d.id));
  const seenIds = new Set<string>();

  for (const sub of subscribers) {
    assertValidSubscriberId(sub.id);
    if (seenIds.has(sub.id)) {
      throw new Error(`Module "${module.id}" declares duplicate subscriber id "${sub.id}"`);
    }
    seenIds.add(sub.id);

    if (sub.kind === 'direct') {
      const producerId = sub.event.name.split('.')[0] ?? '';
      if (!allowedDeps.has(producerId)) {
        throw new Error(
          `Module "${module.id}" subscriber "${sub.id}" cannot subscribe directly to "${sub.event.name}": producer "${producerId}" is not in "${module.id}" dependsOn`,
        );
      }
    }
  }
}

function resolveServerCron(
  module: ModuleDefinition,
  entries: readonly ModuleCronEntry[] | undefined,
): readonly ResolvedModuleCron[] {
  if (entries === undefined || entries.length === 0) return [];

  const seenJobs = new Set<string>();
  const resolved: ResolvedModuleCron[] = [];

  for (const entry of entries) {
    const jobDef = Object.hasOwn(module.jobs, entry.job) ? module.jobs[entry.job] : undefined;
    if (jobDef === undefined) {
      throw new Error(`Module "${module.id}" cron references unknown job "${entry.job}"`);
    }
    if (seenJobs.has(entry.job)) {
      throw new Error(`Module "${module.id}" declares duplicate cron for job "${entry.job}"`);
    }
    seenJobs.add(entry.job);

    const parsed = parseCron(entry.schedule);
    try {
      jobDef.payload.parse({});
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Module "${module.id}" cron job "${entry.job}" must accept an empty payload {}: ${reason}`,
      );
    }

    resolved.push({
      name: jobDef.name,
      jobDef,
      schedule: parsed.expression,
      catchUp: entry.catchUp ?? false,
    });
  }

  return resolved;
}

function unwrapObjectProperties(node: SchemaNode): Readonly<Record<string, SchemaNode>> | null {
  if (node.kind === 'object') {
    return node.properties;
  }
  if (node.kind === 'refine') {
    return unwrapObjectProperties(node.inner);
  }
  return null;
}

function parseModuleEnv(
  moduleId: string,
  envSchema: Schema,
  rawEnv: Readonly<Record<string, string | undefined>>,
): unknown {
  const props = unwrapObjectProperties(describe(envSchema));
  const picked: Record<string, unknown> = {};
  if (props !== null) {
    for (const key of Object.keys(props)) {
      const val = rawEnv[key];
      if (val !== undefined && val !== '') {
        picked[key] = val;
      } else if (val === '' && props[key]?.kind !== 'optional') {
        picked[key] = val;
      }
    }
  } else {
    for (const [key, val] of Object.entries(rawEnv)) {
      if (val !== undefined) {
        picked[key] = val;
      }
    }
  }
  try {
    return envSchema.parse(picked);
  } catch (err) {
    const pathPrefix =
      err instanceof SchemaValidationError && err.path.length > 0 ? `${err.path.join('.')}: ` : '';
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid environment configuration for module "${moduleId}": ${pathPrefix}${reason}`,
      { cause: err },
    );
  }
}

function validateNotificationKinds(
  module: ModuleDefinition,
  kinds: Readonly<Record<string, NotificationTemplate>> | undefined,
): void {
  if (kinds === undefined) return;
  const prefix = `${module.id}.`;
  for (const key of Object.keys(kinds)) {
    if (!key.startsWith(prefix) || key.length <= prefix.length) {
      throw new Error(
        `Module "${module.id}" notificationKinds key "${key}" must be prefixed with "${prefix}"`,
      );
    }
  }
}

export function collectModuleNotificationKinds(
  instances: Iterable<InstantiatedServerModule>,
): ReadonlyMap<string, NotificationTemplate> {
  const collected = new Map<string, NotificationTemplate>();
  for (const inst of instances) {
    const kinds = inst.notificationKinds;
    if (kinds === undefined) continue;
    for (const [key, template] of Object.entries(kinds)) {
      if (collected.has(key)) {
        throw new Error(`Duplicate notificationKind "${key}" registered across server modules`);
      }
      collected.set(key, template);
    }
  }
  return collected;
}

function validateModuleActions<S>(
  module: ModuleDefinition,
  actions: Readonly<Record<string, ModuleActionHandler<S>>> | undefined,
): void {
  if (actions === undefined) return;
  const prefix = `${module.id}.`;
  for (const key of Object.keys(actions)) {
    if (!key.startsWith(prefix) || key.length <= prefix.length) {
      throw new Error(
        `Module "${module.id}" actions key "${key}" must be prefixed with "${prefix}"`,
      );
    }
  }
}

export function collectModuleActions(
  instances: Iterable<InstantiatedServerModule>,
): ReadonlyMap<string, (tx: Tx, input: unknown) => Promise<unknown>> {
  const collected = new Map<string, (tx: Tx, input: unknown) => Promise<unknown>>();
  for (const inst of instances) {
    const keys = inst.actionKeys;
    if (keys === undefined) continue;
    for (const key of keys) {
      if (collected.has(key)) {
        throw new Error(`Duplicate action "${key}" registered across server modules`);
      }
      collected.set(key, (tx, input) => inst.invokeAction(key, tx, input));
    }
  }
  return collected;
}

export function createKernelActionsService(
  getInstances: () => Iterable<InstantiatedServerModule>,
): KernelActionsService {
  return {
    async invoke<R = unknown>(actionKey: string, tx: Tx, input: unknown): Promise<R> {
      const fn = collectModuleActions(getInstances()).get(actionKey);
      if (fn === undefined) {
        throw new Error(`Unknown action "${actionKey}"`);
      }
      return (await fn(tx, input)) as R;
    },
    has(actionKey: string): boolean {
      return collectModuleActions(getInstances()).has(actionKey);
    },
    list(): readonly string[] {
      return [...collectModuleActions(getInstances()).keys()].sort();
    },
  };
}

interface CollectedModulePrivacyEntry {
  readonly moduleId: string;
  exportUser(userId: string): Promise<Readonly<Record<string, unknown>>>;
  eraseUser(tx: Tx, userId: string): Promise<void>;
}

function assertValidPrivacyUserId(userId: string): string {
  const trimmed = userId.trim();
  if (trimmed.length === 0) {
    throw new Error('Privacy hook requires a non-empty userId');
  }
  return trimmed;
}

export function collectModulePrivacy(
  instances: Iterable<InstantiatedServerModule>,
): readonly CollectedModulePrivacyEntry[] {
  const seen = new Set<string>();
  const collected: CollectedModulePrivacyEntry[] = [];
  for (const inst of instances) {
    if (
      inst.hasPrivacy !== true ||
      inst.exportUserPrivacy === undefined ||
      inst.eraseUserPrivacy === undefined
    ) {
      continue;
    }
    const moduleId = inst.module.id;
    if (seen.has(moduleId)) {
      throw new Error(`Duplicate privacy hooks registered for module "${moduleId}"`);
    }
    seen.add(moduleId);
    const exportFn = inst.exportUserPrivacy;
    const eraseFn = inst.eraseUserPrivacy;
    collected.push({
      moduleId,
      exportUser: (uid) => exportFn(uid),
      eraseUser: (tx, uid) => eraseFn(tx, uid),
    });
  }
  return collected;
}

export function createKernelPrivacyService(
  getInstances: () => Iterable<InstantiatedServerModule>,
): KernelPrivacyService {
  return {
    async exportUser(
      userId: string,
    ): Promise<Readonly<Record<string, Readonly<Record<string, unknown>>>>> {
      const normalizedUserId = assertValidPrivacyUserId(userId);
      const entries = collectModulePrivacy(getInstances());
      const out: Record<string, Readonly<Record<string, unknown>>> = {};
      for (const entry of entries) {
        const exported: unknown = await entry.exportUser(normalizedUserId);
        if (typeof exported !== 'object' || exported === null || Array.isArray(exported)) {
          throw new Error(
            `Module "${entry.moduleId}" privacy.exportUser must return a plain object`,
          );
        }
        out[entry.moduleId] = exported as Readonly<Record<string, unknown>>;
      }
      return out;
    },
    async eraseUser(tx: Tx, userId: string): Promise<void> {
      const normalizedUserId = assertValidPrivacyUserId(userId);
      const entries = [...collectModulePrivacy(getInstances())].reverse();
      for (const entry of entries) {
        await entry.eraseUser(tx, normalizedUserId);
      }
    },
    modules(): readonly string[] {
      return collectModulePrivacy(getInstances()).map((entry) => entry.moduleId);
    },
  };
}

function validateModuleVerifiers<S>(
  module: ModuleDefinition,
  verifiers: Readonly<Record<string, WebhookVerifier<S>>> | undefined,
): void {
  const provided = new Set<string>();
  if (verifiers !== undefined) {
    for (const [key, fn] of Object.entries(verifiers)) {
      if (key.trim().length === 0 || typeof fn !== 'function') {
        throw new Error(`Module "${module.id}" declares invalid webhook verifier "${key}"`);
      }
      provided.add(key);
    }
  }
  for (const [endpointKey, ep] of Object.entries(module.endpoints)) {
    if (typeof ep.auth === 'object' && 'webhook' in ep.auth && !provided.has(ep.auth.webhook)) {
      throw new Error(
        `Module "${module.id}" endpoint "${endpointKey}" declares auth.webhook "${ep.auth.webhook}" without a matching verifier in server.verifiers`,
      );
    }
  }
}

export function implementServer<M extends ModuleDefinition, S, A = never>(
  module: M,
  impl: ServerModuleSpec<M, S, A>,
): ServerModule<M, S, A> {
  validateServerSubscribers(module, impl.subscribers);
  validateModuleActions(module, impl.actions);
  validateModuleVerifiers(module, impl.verifiers);
  validateNotificationKinds(module, impl.notificationKinds);
  const resolvedCron = resolveServerCron(module, impl.cron);

  return {
    module,
    ...impl,
    instantiate(
      kernel: KernelServices,
      depApis: Readonly<Record<string, unknown>>,
      rawEnv: Readonly<Record<string, string | undefined>> = process.env,
    ): InstantiatedServerModule<M> {
      const parsedEnv =
        module.env !== undefined ? parseModuleEnv(module.id, module.env, rawEnv) : undefined;
      const viewerRunner = kernel.db.viewer;
      const dbService: KernelDbService = {
        system: (fn) => kernel.db.system(fn),
        viewer:
          viewerRunner !== undefined
            ? (viewer, fn) => viewerRunner(viewer, fn)
            : () => Promise.reject(new Error('k.db.viewer needs a viewer runner from the host')),
      };
      const kernelWithEnv: KernelServicesWithEnv<M> = {
        ...kernel,
        db: dbService,
        env: parsedEnv as ModuleEnvOf<M>,
      };
      const service = impl.create(kernelWithEnv, depApis as DepApis<M['dependsOn']>);
      const apiValue: unknown = impl.api !== undefined ? impl.api(service) : undefined;
      const handlersRecord = impl.handlers as Readonly<
        Record<
          string,
          ((input: unknown, req: RequestContext, s: S) => Promise<unknown>) | undefined
        >
      >;
      const jobsRecord = (impl.jobs ?? {}) as Readonly<
        Record<string, ((payload: unknown, s: S) => Promise<void>) | undefined>
      >;
      const actionsRecord = (impl.actions ?? {}) as Readonly<
        Record<string, ModuleActionHandler<S> | undefined>
      >;
      const verifiersRecord = (impl.verifiers ?? {}) as Readonly<
        Record<string, WebhookVerifier<S> | undefined>
      >;
      const actionKeys =
        impl.actions !== undefined ? Object.freeze(Object.keys(impl.actions)) : undefined;
      const subscriberList: readonly Subscription<S>[] = impl.subscribers ?? [];
      const subscriberMap = new Map<string, Subscription<S>>(
        subscriberList.map((sub) => [sub.id, sub]),
      );

      const privacyHooks = impl.privacy;

      return {
        module,
        api: apiValue,
        subscribers: subscriberList,
        cron: resolvedCron,
        ...(actionKeys !== undefined ? { actionKeys } : {}),
        ...(privacyHooks !== undefined
          ? {
              hasPrivacy: true,
              exportUserPrivacy: (userId: string) => privacyHooks.exportUser(service, userId),
              eraseUserPrivacy: (tx: Tx, userId: string) =>
                privacyHooks.eraseUser(service, tx, userId),
            }
          : {}),
        ...(impl.notificationKinds !== undefined
          ? { notificationKinds: impl.notificationKinds }
          : {}),
        async invokeHandler(
          endpointName: string,
          input: unknown,
          req: RequestContext,
        ): Promise<unknown> {
          if (!Object.hasOwn(handlersRecord, endpointName)) {
            throw new Error(`Unknown endpoint "${endpointName}" on module "${module.id}"`);
          }
          const fn = handlersRecord[endpointName];
          if (fn === undefined) {
            throw new Error(`Unknown endpoint "${endpointName}" on module "${module.id}"`);
          }
          return fn(input, req, service);
        },
        async invokeJob(jobKey: string, payload: unknown): Promise<void> {
          if (!Object.hasOwn(module.jobs, jobKey) || !Object.hasOwn(jobsRecord, jobKey)) {
            throw new Error(`Unknown job "${jobKey}" on module "${module.id}"`);
          }
          const jobDef = module.jobs[jobKey];
          const jobFn = jobsRecord[jobKey];
          if (jobDef === undefined || jobFn === undefined) {
            throw new Error(`Unknown job "${jobKey}" on module "${module.id}"`);
          }
          const parsedPayload = jobDef.payload.parse(payload);
          await jobFn(parsedPayload, service);
        },
        async invokeSubscriber(subscriberId: string, event: DeliveredEvent): Promise<void> {
          const sub = subscriberMap.get(subscriberId);
          if (sub === undefined) {
            throw new Error(`Unknown subscriber "${subscriberId}" on module "${module.id}"`);
          }
          await sub.handle(event as DeliveredEvent<never>, service);
        },
        async invokeAction(actionKey: string, tx: Tx, input: unknown): Promise<unknown> {
          if (!Object.hasOwn(actionsRecord, actionKey)) {
            throw new Error(`Unknown action "${actionKey}" on module "${module.id}"`);
          }
          const actionFn = actionsRecord[actionKey];
          if (actionFn === undefined) {
            throw new Error(`Unknown action "${actionKey}" on module "${module.id}"`);
          }
          return actionFn(service, tx, input);
        },
        async verifyWebhook(verifierName: string, input: WebhookVerifierInput): Promise<unknown> {
          if (!Object.hasOwn(verifiersRecord, verifierName)) {
            throw new Error(`Unknown webhook verifier "${verifierName}" on module "${module.id}"`);
          }
          const verifierFn = verifiersRecord[verifierName];
          if (verifierFn === undefined) {
            throw new Error(`Unknown webhook verifier "${verifierName}" on module "${module.id}"`);
          }
          return await Promise.resolve(verifierFn(input, service));
        },
        async resolveContext(
          viewer: Viewer | null,
          req?: ContextRequestMetadata,
        ): Promise<CapabilityContribution> {
          if (impl.context === undefined) {
            return {};
          }
          return impl.context(service, viewer, req);
        },
      };
    },
  };
}

type MapServerModules<Ms extends readonly ModuleDefinition[]> = {
  readonly [K in keyof Ms]: Ms[K] extends ModuleDefinition ? AnyServerModule<Ms[K]> : never;
};

type ExtractInstalledModules<T extends BsltConfig | readonly ModuleDefinition[]> =
  T extends BsltConfig<infer Ms> ? Ms : T extends readonly ModuleDefinition[] ? T : never;

export type ServerImpls<T extends BsltConfig | readonly ModuleDefinition[]> = MapServerModules<
  ExtractInstalledModules<T>
>;
