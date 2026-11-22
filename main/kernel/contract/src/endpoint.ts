// main/kernel/contract/src/endpoint.ts
import {
  array,
  bigintString,
  boolean,
  discriminated,
  literal,
  nullable,
  number,
  object,
  optional,
  record,
  string,
  type Infer,
  type Schema,
} from '@bslt/schema';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Auth =
  | 'public'
  | 'user'
  | 'moderator'
  | 'admin'
  | { readonly org: `${string}.${string}` }
  | { readonly webhook: string; readonly rawBody: true };

export type Requirement =
  | 'tos.accepted'
  | 'email.verified'
  | `entitlement:${string}`
  | `flag:${string}`
  | `authStrategy:${string}`
  | `age.verified:${number}`;

export type RequirementCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TOS_ACCEPTANCE_REQUIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'ENTITLEMENT_REQUIRED'
  | 'FEATURE_DISABLED'
  | 'AGE_ASSURANCE_REQUIRED';

export const INTERSTITIAL_REQUIREMENT_CODES = [
  'TOS_ACCEPTANCE_REQUIRED',
  'EMAIL_NOT_VERIFIED',
  'ENTITLEMENT_REQUIRED',
  'FEATURE_DISABLED',
  'AGE_ASSURANCE_REQUIRED',
] as const satisfies readonly RequirementCode[];

export type InterstitialRequirementCode = (typeof INTERSTITIAL_REQUIREMENT_CODES)[number];

const INTERSTITIAL_REQUIREMENT_SET: ReadonlySet<string> = new Set<string>(
  INTERSTITIAL_REQUIREMENT_CODES,
);

export function isInterstitialRequirementCode(
  value: unknown,
): value is InterstitialRequirementCode {
  return typeof value === 'string' && INTERSTITIAL_REQUIREMENT_SET.has(value);
}

export interface Viewer {
  readonly userId: string;
  readonly role: string;
  readonly actingOrg?:
    | {
        readonly orgId: string;
        readonly permissions: bigint;
      }
    | undefined;
}

export interface CapabilityContribution {
  readonly flags?: Readonly<Record<string, boolean>> | undefined;
  readonly entitlements?: Iterable<string> | undefined;
  readonly eligibility?:
    | {
        readonly tosAccepted?: boolean | undefined;
        readonly emailVerified?: boolean | undefined;
        readonly ageVerifiedFor?: number | null | undefined;
        readonly jurisdiction?: string | null | undefined;
      }
    | undefined;
  readonly authStrategies?: readonly string[] | undefined;
  readonly maxAudience?: number | undefined;
  readonly requirementDetails?:
    Partial<Readonly<Record<RequirementCode, Readonly<Record<string, unknown>>>>> | undefined;
}

export interface CapabilityContext {
  readonly modules: ReadonlySet<string>;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly entitlements: ReadonlySet<string>;
  readonly eligibility: {
    readonly tosAccepted: boolean;
    readonly emailVerified: boolean;
    readonly ageVerifiedFor: number | null;
    readonly jurisdiction: string | null;
  };
  readonly viewer: Viewer | null;
  readonly actingAs:
    | { readonly kind: 'user' }
    | { readonly kind: 'org'; readonly orgId: string; readonly permissions: bigint };
  readonly maxAudience: number;
  readonly authStrategies: readonly string[];
  readonly requirementDetails?:
    Partial<Readonly<Record<RequirementCode, Readonly<Record<string, unknown>>>>> | undefined;
}

export interface MergeCapabilityOptions {
  readonly modules: readonly {
    readonly id: string;
    readonly flags?: Readonly<Record<string, { readonly default: boolean }>> | undefined;
  }[];
  readonly viewer: Viewer | null;
  readonly contributions: readonly CapabilityContribution[];
}

const MAX_AUDIENCE_CEILING = 32_767;

export function mergeCapabilityContributions(options: MergeCapabilityOptions): CapabilityContext {
  const modules = new Set<string>(options.modules.map((m) => m.id));
  const flags: Record<string, boolean> = {};
  for (const mod of options.modules) {
    if (mod.flags !== undefined) {
      for (const [flagKey, flagDef] of Object.entries(mod.flags)) {
        flags[flagKey] = flagDef.default;
      }
    }
  }

  const entitlements = new Set<string>();
  let tosAccepted = options.viewer !== null;
  let emailVerified = false;
  let ageVerifiedFor: number | null = null;
  let jurisdiction: string | null = null;
  let maxAudience = 0;
  let authStrategies: readonly string[] = [];
  const requirementDetails: Partial<Record<RequirementCode, Readonly<Record<string, unknown>>>> =
    {};

  for (const contrib of options.contributions) {
    if (contrib.flags !== undefined) {
      for (const [flagKey, flagValue] of Object.entries(contrib.flags)) {
        flags[flagKey] = flagValue;
      }
    }
    if (contrib.entitlements !== undefined) {
      for (const ent of contrib.entitlements) {
        entitlements.add(ent);
      }
    }
    if (contrib.eligibility !== undefined) {
      if (contrib.eligibility.tosAccepted !== undefined) {
        tosAccepted = contrib.eligibility.tosAccepted;
      }
      if (contrib.eligibility.emailVerified !== undefined) {
        emailVerified = contrib.eligibility.emailVerified;
      }
      if (contrib.eligibility.ageVerifiedFor !== undefined) {
        ageVerifiedFor = contrib.eligibility.ageVerifiedFor;
      }
      if (contrib.eligibility.jurisdiction !== undefined) {
        jurisdiction = contrib.eligibility.jurisdiction;
      }
    }
    if (contrib.authStrategies !== undefined) {
      authStrategies = [...contrib.authStrategies];
    }
    if (contrib.maxAudience !== undefined) {
      if (
        !Number.isInteger(contrib.maxAudience) ||
        contrib.maxAudience < 0 ||
        contrib.maxAudience > MAX_AUDIENCE_CEILING
      ) {
        throw new Error(
          `Capability maxAudience must be a whole number from 0 to ${String(MAX_AUDIENCE_CEILING)}`,
        );
      }
      maxAudience = contrib.maxAudience;
    }
    if (contrib.requirementDetails !== undefined) {
      for (const [code, details] of Object.entries(contrib.requirementDetails) as Array<
        [RequirementCode, Readonly<Record<string, unknown>> | undefined]
      >) {
        if (details !== undefined) {
          requirementDetails[code] = {
            ...(requirementDetails[code] ?? {}),
            ...details,
          };
        }
      }
    }
  }

  const actingAs: CapabilityContext['actingAs'] =
    options.viewer?.actingOrg !== undefined
      ? {
          kind: 'org',
          orgId: options.viewer.actingOrg.orgId,
          permissions: options.viewer.actingOrg.permissions,
        }
      : { kind: 'user' };

  const hasRequirementDetails = Object.keys(requirementDetails).length > 0;

  return {
    modules,
    flags,
    entitlements,
    eligibility: {
      tosAccepted,
      emailVerified,
      ageVerifiedFor,
      jurisdiction,
    },
    viewer: options.viewer,
    actingAs,
    maxAudience,
    authStrategies,
    ...(hasRequirementDetails ? { requirementDetails } : {}),
  };
}

const serializedActingOrgSchema = object({
  orgId: string({ min: 1 }),
  permissions: bigintString({ nonNegative: true }),
});

const serializedViewerSchema = object({
  userId: string({ min: 1 }),
  role: string({ min: 1 }),
  actingOrg: optional(serializedActingOrgSchema),
});

const serializedActingAsSchema = discriminated('kind', [
  object({ kind: literal('user') }),
  object({
    kind: literal('org'),
    orgId: string({ min: 1 }),
    permissions: bigintString({ nonNegative: true }),
  }),
] as const);

export const serializedCapabilityContextSchema = object({
  modules: array(string({ min: 1 })),
  flags: record(boolean(), string({ min: 1 })),
  entitlements: array(string({ min: 1 })),
  eligibility: object({
    tosAccepted: boolean(),
    emailVerified: boolean(),
    ageVerifiedFor: nullable(number({ int: true, min: 0 })),
    jurisdiction: nullable(string({ min: 1 })),
  }),
  viewer: nullable(serializedViewerSchema),
  actingAs: serializedActingAsSchema,
  maxAudience: number({ int: true, min: 0, max: MAX_AUDIENCE_CEILING }),
  authStrategies: array(string({ min: 1 })),
});

export type SerializedCapabilityContext = Infer<typeof serializedCapabilityContextSchema>;

export function serializeCapabilityContext(ctx: CapabilityContext): SerializedCapabilityContext {
  return {
    modules: [...ctx.modules].sort(),
    flags: { ...ctx.flags },
    entitlements: [...ctx.entitlements].sort(),
    eligibility: { ...ctx.eligibility },
    viewer:
      ctx.viewer === null
        ? null
        : {
            userId: ctx.viewer.userId,
            role: ctx.viewer.role,
            ...(ctx.viewer.actingOrg !== undefined
              ? {
                  actingOrg: {
                    orgId: ctx.viewer.actingOrg.orgId,
                    permissions: ctx.viewer.actingOrg.permissions.toString(),
                  },
                }
              : {}),
          },
    actingAs:
      ctx.actingAs.kind === 'user'
        ? { kind: 'user' }
        : {
            kind: 'org',
            orgId: ctx.actingAs.orgId,
            permissions: ctx.actingAs.permissions.toString(),
          },
    maxAudience: ctx.maxAudience,
    authStrategies: [...ctx.authStrategies],
  };
}

export function deserializeCapabilityContext(raw: unknown): CapabilityContext {
  const parsed = serializedCapabilityContextSchema.parse(raw);
  const viewer: Viewer | null =
    parsed.viewer === null
      ? null
      : {
          userId: parsed.viewer.userId,
          role: parsed.viewer.role,
          ...(parsed.viewer.actingOrg !== undefined
            ? {
                actingOrg: {
                  orgId: parsed.viewer.actingOrg.orgId,
                  permissions: BigInt(parsed.viewer.actingOrg.permissions),
                },
              }
            : {}),
        };
  const actingAs: CapabilityContext['actingAs'] =
    parsed.actingAs.kind === 'user'
      ? { kind: 'user' }
      : {
          kind: 'org',
          orgId: parsed.actingAs.orgId,
          permissions: BigInt(parsed.actingAs.permissions),
        };

  return {
    modules: new Set(parsed.modules),
    flags: { ...parsed.flags },
    entitlements: new Set(parsed.entitlements),
    eligibility: { ...parsed.eligibility },
    viewer,
    actingAs,
    maxAudience: parsed.maxAudience,
    authStrategies: [...parsed.authStrategies],
  };
}

export interface Endpoint {
  readonly method: HttpMethod;
  readonly path: `/api/${string}`;
  readonly auth: Auth;
  readonly params?: Schema;
  readonly query?: Schema;
  readonly body?: Schema;
  readonly response: Schema;
  readonly status?: 200 | 201 | 202 | 204;
  readonly bodyLimit?: number;
  readonly errors?: readonly string[];
  readonly requires?: readonly Requirement[];
  readonly invalidates?: readonly string[];
  readonly cache?: { readonly public: number };
  readonly persist?: true;
  readonly rateLimit?: { readonly perMinute: number };
  readonly summary: string;
}

const VALID_METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

const ORG_PERMISSION_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_.]*$/;
const PARAM_SEGMENT_PATTERN = /^:[A-Za-z][A-Za-z0-9_]*$/;

export function endpoint<const E extends Endpoint>(def: E): E {
  if (!VALID_METHODS.has(def.method)) {
    throw new Error(`Invalid endpoint HTTP method "${def.method}"`);
  }
  if (!def.path.startsWith('/api/') || /\s/.test(def.path)) {
    throw new Error(
      `Endpoint path "${def.path}" must start with "/api/" and contain no whitespace`,
    );
  }
  const segments = def.path.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment.startsWith(':') && !PARAM_SEGMENT_PATTERN.test(segment)) {
      throw new Error(
        `Endpoint path "${def.path}" has malformed param segment "${segment}" (expected :paramName)`,
      );
    }
  }
  if (def.summary.trim().length === 0) {
    throw new Error(`Endpoint "${def.method} ${def.path}" must declare a non-empty summary`);
  }
  if (def.cache !== undefined) {
    if (def.auth !== 'public') {
      throw new Error(
        `Endpoint "${def.method} ${def.path}" declares cache.public, which is only legal when auth is "public"`,
      );
    }
    if (!Number.isInteger(def.cache.public) || def.cache.public < 0) {
      throw new Error(
        `Endpoint "${def.method} ${def.path}" cache.public must be a non-negative integer`,
      );
    }
  }
  if (
    def.rateLimit !== undefined &&
    (!Number.isInteger(def.rateLimit.perMinute) || def.rateLimit.perMinute < 1)
  ) {
    throw new Error(
      `Endpoint "${def.method} ${def.path}" rateLimit.perMinute must be a positive integer`,
    );
  }
  if (def.bodyLimit !== undefined && (!Number.isInteger(def.bodyLimit) || def.bodyLimit < 1)) {
    throw new Error(`Endpoint "${def.method} ${def.path}" bodyLimit must be a positive integer`);
  }
  if (typeof def.auth === 'object') {
    if ('org' in def.auth) {
      if (!ORG_PERMISSION_PATTERN.test(def.auth.org)) {
        throw new Error(
          `Endpoint "${def.method} ${def.path}" has invalid org permission "${def.auth.org}"`,
        );
      }
    } else if (def.auth.webhook.trim().length === 0) {
      throw new Error(
        `Endpoint "${def.method} ${def.path}" webhook auth must name a non-empty verifier`,
      );
    }
  }

  return def;
}

type MergeIntersection<T> = { readonly [K in keyof T]: T[K] };

type RawInputOf<E extends Endpoint> = (E['params'] extends Schema
  ? { readonly params: Infer<E['params']> }
  : object) &
  (E['query'] extends Schema ? { readonly query: Infer<E['query']> } : object) &
  (E['body'] extends Schema ? { readonly body: Infer<E['body']> } : object);

export type InputOf<E extends Endpoint> = keyof RawInputOf<E> extends never
  ? Record<string, never>
  : MergeIntersection<RawInputOf<E>>;

export type OutputOf<E extends Endpoint> = Infer<E['response']>;

export function evaluateAuth(
  auth: Auth,
  viewer: Viewer | null,
  orgBitLookup?: (permission: string) => number | undefined,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 401 | 403;
      readonly code: 'UNAUTHORIZED' | 'FORBIDDEN';
    } {
  if (auth === 'public') {
    return { ok: true };
  }
  if (typeof auth === 'object' && 'webhook' in auth) {
    // Webhook signature verification executes on raw bytes before auth evaluation.
    return { ok: true };
  }
  if (viewer === null) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED' };
  }
  if (auth === 'user') {
    return { ok: true };
  }
  if (auth === 'moderator') {
    return viewer.role === 'moderator' || viewer.role === 'admin'
      ? { ok: true }
      : { ok: false, status: 403, code: 'FORBIDDEN' };
  }
  if (auth === 'admin') {
    return viewer.role === 'admin' ? { ok: true } : { ok: false, status: 403, code: 'FORBIDDEN' };
  }

  const actingOrg = viewer.actingOrg;
  if (actingOrg === undefined || orgBitLookup === undefined) {
    return { ok: false, status: 403, code: 'FORBIDDEN' };
  }
  const bit = orgBitLookup(auth.org);
  if (bit === undefined || !Number.isInteger(bit) || bit < 0) {
    return { ok: false, status: 403, code: 'FORBIDDEN' };
  }
  const mask = 1n << BigInt(bit);
  return (actingOrg.permissions & mask) === mask
    ? { ok: true }
    : { ok: false, status: 403, code: 'FORBIDDEN' };
}

export function evaluateRequirement(
  req: Requirement,
  ctx: CapabilityContext,
): { readonly ok: true } | { readonly ok: false; readonly code: RequirementCode } {
  if (req === 'tos.accepted') {
    return ctx.eligibility.tosAccepted
      ? { ok: true }
      : { ok: false, code: 'TOS_ACCEPTANCE_REQUIRED' };
  }
  if (req === 'email.verified') {
    return ctx.eligibility.emailVerified ? { ok: true } : { ok: false, code: 'EMAIL_NOT_VERIFIED' };
  }
  if (req.startsWith('entitlement:')) {
    const key = req.slice('entitlement:'.length);
    return ctx.entitlements.has(key) ? { ok: true } : { ok: false, code: 'ENTITLEMENT_REQUIRED' };
  }
  if (req.startsWith('flag:')) {
    const key = req.slice('flag:'.length);
    return ctx.flags[key] === true ? { ok: true } : { ok: false, code: 'FEATURE_DISABLED' };
  }
  if (req.startsWith('authStrategy:')) {
    const key = req.slice('authStrategy:'.length);
    return key.length > 0 && ctx.authStrategies.includes(key)
      ? { ok: true }
      : { ok: false, code: 'FEATURE_DISABLED' };
  }

  const minAge = Number(req.slice('age.verified:'.length));
  const verifiedAge = ctx.eligibility.ageVerifiedFor;
  if (verifiedAge === null || !Number.isFinite(minAge) || verifiedAge < minAge) {
    return { ok: false, code: 'AGE_ASSURANCE_REQUIRED' };
  }
  return { ok: true };
}
