// main/kernel/contract/src/endpoint.test.ts
import { object, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import {
  deserializeCapabilityContext,
  endpoint,
  evaluateAuth,
  evaluateRequirement,
  INTERSTITIAL_REQUIREMENT_CODES,
  isInterstitialRequirementCode,
  mergeCapabilityContributions,
  serializeCapabilityContext,
  serializedCapabilityContextSchema,
  type Auth,
  type CapabilityContext,
  type CapabilityContribution,
  type Endpoint,
  type HttpMethod,
  type InputOf,
  type InterstitialRequirementCode,
  type MergeCapabilityOptions,
  type OutputOf,
  type Requirement,
  type RequirementCode,
  type SerializedCapabilityContext,
  type Viewer,
} from './endpoint';

const itemSchema = object({ id: string({ min: 1 }) });

function makeContext(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    modules: new Set(['tasks']),
    flags: { 'flags.beta': true },
    entitlements: new Set(['billing.pro']),
    eligibility: {
      tosAccepted: true,
      emailVerified: true,
      ageVerifiedFor: 18,
      jurisdiction: 'US',
    },
    viewer: { userId: 'u-1', role: 'user' },
    actingAs: { kind: 'user' },
    maxAudience: 0,
    authStrategies: ['password'],
    ...overrides,
  };
}

describe('endpoint and authorization evaluators', () => {
  it('constructs valid endpoints and infers InputOf and OutputOf accurately', () => {
    const method: HttpMethod = 'POST';
    const ep = endpoint({
      method,
      path: '/api/tasks/:id/update',
      auth: 'user',
      params: object({ id: string({ min: 1 }) }),
      body: object({ title: string({ min: 1 }) }),
      response: itemSchema,
      summary: 'Update task',
      invalidates: ['list'],
    });

    const typedEndpoint: Endpoint = ep;
    expect(typedEndpoint.path).toBe('/api/tasks/:id/update');

    const validInput: InputOf<typeof ep> = {
      params: { id: '1' },
      body: { title: 'Write tests' },
    };
    const validOutput: OutputOf<typeof ep> = { id: '1' };
    expect(validInput.body.title).toBe('Write tests');
    expect(validOutput.id).toBe('1');

    const publicCached = endpoint({
      method: 'GET',
      path: '/api/status',
      auth: 'public',
      response: itemSchema,
      cache: { public: 60 },
      summary: 'Public status',
    });
    expect(publicCached.cache).toEqual({ public: 60 });
  });

  it('rejects paths outside /api/, whitespace, or empty parameter names', () => {
    expect(() =>
      endpoint({
        method: 'GET',
        path: '/tasks' as `/api/${string}`,
        auth: 'user',
        response: itemSchema,
        summary: 'Bad prefix',
      }),
    ).toThrow(/\/api\//);

    expect(() =>
      endpoint({
        method: 'GET',
        path: '/api/tasks list',
        auth: 'user',
        response: itemSchema,
        summary: 'Whitespace path',
      }),
    ).toThrow(/path/i);

    expect(() =>
      endpoint({
        method: 'GET',
        path: '/api/tasks/:/edit',
        auth: 'user',
        response: itemSchema,
        summary: 'Empty param',
      }),
    ).toThrow(/param/i);
  });

  it('rejects cache on non-public endpoints, negative cache durations, blank summaries, and bad rateLimits', () => {
    expect(() =>
      endpoint({
        method: 'GET',
        path: '/api/tasks',
        auth: 'user',
        response: itemSchema,
        cache: { public: 30 },
        summary: 'Private cached',
      }),
    ).toThrow(/cache\.public/i);

    expect(() =>
      endpoint({
        method: 'GET',
        path: '/api/status',
        auth: 'public',
        response: itemSchema,
        cache: { public: -1 },
        summary: 'Negative cache',
      }),
    ).toThrow(/cache\.public/i);

    expect(() =>
      endpoint({
        method: 'GET',
        path: '/api/tasks',
        auth: 'user',
        response: itemSchema,
        summary: '   ',
      }),
    ).toThrow(/summary/i);

    expect(() =>
      endpoint({
        method: 'POST',
        path: '/api/tasks',
        auth: 'user',
        response: itemSchema,
        rateLimit: { perMinute: 0 },
        summary: 'Zero rateLimit',
      }),
    ).toThrow(/rateLimit/i);
  });

  it('rejects malformed org permission or webhook auth descriptors', () => {
    expect(() =>
      endpoint({
        method: 'POST',
        path: '/api/orgs/invite',
        auth: { org: 'InvalidPerm' as `${string}.${string}` },
        response: itemSchema,
        summary: 'Bad org perm',
      }),
    ).toThrow(/org permission/i);

    expect(() =>
      endpoint({
        method: 'POST',
        path: '/api/webhooks/stripe',
        auth: { webhook: '', rawBody: true },
        response: itemSchema,
        summary: 'Empty webhook verifier',
      }),
    ).toThrow(/webhook/i);
  });

  it('evaluates auth levels and org bitmasks fail-closed', () => {
    const anon: Viewer | null = null;
    const user: Viewer = { userId: 'u-1', role: 'user' };
    const admin: Viewer = { userId: 'a-1', role: 'admin' };
    const orgMember: Viewer = {
      userId: 'u-2',
      role: 'user',
      actingOrg: { orgId: 'o-1', permissions: 0b10n },
    };

    expect(evaluateAuth('public', anon)).toEqual({ ok: true });
    expect(evaluateAuth('user', anon)).toEqual({ ok: false, status: 401, code: 'UNAUTHORIZED' });
    expect(evaluateAuth('user', user)).toEqual({ ok: true });
    expect(evaluateAuth('user', admin)).toEqual({ ok: true });
    expect(evaluateAuth('admin', user)).toEqual({ ok: false, status: 403, code: 'FORBIDDEN' });
    expect(evaluateAuth('admin', admin)).toEqual({ ok: true });

    const orgAuth: Auth = { org: 'orgs.manage' };
    expect(evaluateAuth(orgAuth, anon)).toEqual({ ok: false, status: 401, code: 'UNAUTHORIZED' });
    expect(evaluateAuth(orgAuth, user, () => 1)).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(evaluateAuth(orgAuth, orgMember, () => undefined)).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(evaluateAuth(orgAuth, orgMember, () => 0)).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(evaluateAuth(orgAuth, orgMember, () => 1)).toEqual({ ok: true });
  });

  it('evaluates runtime requirements and returns exact RequirementCodes on denial', () => {
    const ctx = makeContext();
    const okReqs: readonly Requirement[] = [
      'tos.accepted',
      'email.verified',
      'entitlement:billing.pro',
      'flag:flags.beta',
      'authStrategy:password',
      'age.verified:18',
    ];
    for (const req of okReqs) {
      expect(evaluateRequirement(req, ctx)).toEqual({ ok: true });
    }

    const deniedCases: ReadonlyArray<readonly [Requirement, CapabilityContext, RequirementCode]> = [
      [
        'tos.accepted',
        makeContext({
          eligibility: { ...ctx.eligibility, tosAccepted: false },
        }),
        'TOS_ACCEPTANCE_REQUIRED',
      ],
      [
        'email.verified',
        makeContext({
          eligibility: { ...ctx.eligibility, emailVerified: false },
        }),
        'EMAIL_NOT_VERIFIED',
      ],
      ['entitlement:billing.enterprise', ctx, 'ENTITLEMENT_REQUIRED'],
      ['flag:flags.missing', ctx, 'FEATURE_DISABLED'],
      ['authStrategy:magic', ctx, 'FEATURE_DISABLED'],
      ['authStrategy:', ctx, 'FEATURE_DISABLED'],
      [
        'age.verified:21',
        makeContext({
          eligibility: { ...ctx.eligibility, ageVerifiedFor: 18 },
        }),
        'AGE_ASSURANCE_REQUIRED',
      ],
      [
        'age.verified:18',
        makeContext({
          eligibility: { ...ctx.eligibility, ageVerifiedFor: null },
        }),
        'AGE_ASSURANCE_REQUIRED',
      ],
    ];
    for (const [req, badCtx, code] of deniedCases) {
      expect(evaluateRequirement(req, badCtx)).toEqual({ ok: false, code });
    }
  });

  it('merges capability contributions from module flag defaults and runtime slots while rejecting invalid maxAudience', () => {
    const contributions: readonly CapabilityContribution[] = [
      {
        flags: { 'tasks.v2': true, 'flags.experimental': false },
        entitlements: ['billing.pro'],
        eligibility: { emailVerified: true, jurisdiction: 'KR' },
        authStrategies: ['password', 'google'],
      },
      {
        entitlements: new Set(['billing.audit']),
        eligibility: { tosAccepted: false, ageVerifiedFor: 21 },
        maxAudience: 2,
        requirementDetails: {
          TOS_ACCEPTANCE_REQUIRED: { documentId: 'doc-9', requiredVersion: 4 },
        },
      },
    ];
    const mergeOpts: MergeCapabilityOptions = {
      modules: [
        {
          id: 'tasks',
          flags: {
            'tasks.v2': { default: false, summary: 'Tasks v2' },
            'tasks.compact': { default: true, summary: 'Compact list' },
          },
        },
        { id: 'webhooks' },
      ],
      viewer: {
        userId: 'u-7',
        role: 'user',
        actingOrg: { orgId: 'org-3', permissions: 5n },
      },
      contributions,
    };

    const merged = mergeCapabilityContributions(mergeOpts);
    expect([...merged.modules]).toEqual(['tasks', 'webhooks']);
    expect(merged.flags).toEqual({
      'tasks.v2': true,
      'tasks.compact': true,
      'flags.experimental': false,
    });
    expect([...merged.entitlements]).toEqual(['billing.pro', 'billing.audit']);
    expect(merged.eligibility).toEqual({
      tosAccepted: false,
      emailVerified: true,
      ageVerifiedFor: 21,
      jurisdiction: 'KR',
    });
    expect(merged.actingAs).toEqual({ kind: 'org', orgId: 'org-3', permissions: 5n });
    expect(merged.maxAudience).toBe(2);
    expect(merged.authStrategies).toEqual(['password', 'google']);
    expect(merged.requirementDetails?.TOS_ACCEPTANCE_REQUIRED).toEqual({
      documentId: 'doc-9',
      requiredVersion: 4,
    });

    // Anonymous viewer defaults fail-closed on tosAccepted and emailVerified
    const anon = mergeCapabilityContributions({
      modules: [{ id: 'tasks' }],
      viewer: null,
      contributions: [],
    });
    expect(anon.eligibility).toEqual({
      tosAccepted: false,
      emailVerified: false,
      ageVerifiedFor: null,
      jurisdiction: null,
    });
    expect(anon.actingAs).toEqual({ kind: 'user' });

    // Failure cases: invalid maxAudience ceilings are refused
    for (const badCeiling of [-1, 1.5, 32_768, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        mergeCapabilityContributions({
          modules: [],
          viewer: null,
          contributions: [{ maxAudience: badCeiling }],
        }),
      ).toThrow(/maxAudience/i);
    }
  });

  it('round-trips CapabilityContext across JSON wire and rejects malformed serialized payloads', () => {
    const orgCtx = makeContext({
      modules: new Set(['webhooks', 'tasks']),
      entitlements: new Set(['billing.enterprise', 'billing.pro']),
      viewer: {
        userId: 'u-99',
        role: 'admin',
        actingOrg: { orgId: 'org-99', permissions: (1n << 62n) | 3n },
      },
      actingAs: { kind: 'org', orgId: 'org-99', permissions: (1n << 62n) | 3n },
      maxAudience: 3,
      authStrategies: ['password', 'passkey'],
    });

    const wire: SerializedCapabilityContext = serializeCapabilityContext(orgCtx);
    expect(serializedCapabilityContextSchema.parse(wire)).toEqual(wire);
    const jsonRoundTrip = JSON.parse(JSON.stringify(wire)) as unknown;
    const restored = deserializeCapabilityContext(jsonRoundTrip);
    expect(restored).toEqual(orgCtx);

    // Failure 1: negative or non-canonical bigint permissions string
    expect(() =>
      deserializeCapabilityContext({
        ...wire,
        actingAs: { kind: 'org', orgId: 'org-99', permissions: '-1' },
      }),
    ).toThrow();
    expect(() =>
      deserializeCapabilityContext({
        ...wire,
        actingAs: { kind: 'org', orgId: 'org-99', permissions: '01' },
      }),
    ).toThrow();

    // Failure 2: unknown actingAs kind
    expect(() =>
      deserializeCapabilityContext({
        ...wire,
        actingAs: { kind: 'team' },
      }),
    ).toThrow();

    // Failure 3: unknown extra top-level property
    expect(() =>
      deserializeCapabilityContext({
        ...wire,
        injected: true,
      }),
    ).toThrow();

    // Failure 4: negative maxAudience
    expect(() =>
      deserializeCapabilityContext({
        ...wire,
        maxAudience: -2,
      }),
    ).toThrow();
  });

  it('classifies interstitial 403 requirement codes and rejects non-interstitial values', () => {
    for (const code of INTERSTITIAL_REQUIREMENT_CODES) {
      const typed: InterstitialRequirementCode = code;
      expect(isInterstitialRequirementCode(typed)).toBe(true);
    }
    expect(isInterstitialRequirementCode('UNAUTHORIZED')).toBe(false);
    expect(isInterstitialRequirementCode('FORBIDDEN')).toBe(false);
    expect(isInterstitialRequirementCode('VALIDATION_ERROR')).toBe(false);
    expect(isInterstitialRequirementCode('')).toBe(false);
    expect(isInterstitialRequirementCode(null)).toBe(false);
    expect(isInterstitialRequirementCode(123)).toBe(false);
  });

  it('accepts a positive integer bodyLimit on endpoint() and rejects invalid limits', () => {
    const valid = endpoint({
      method: 'POST',
      path: '/api/files/upload',
      auth: 'user',
      bodyLimit: 11_534_336,
      response: object({ id: string() }),
      summary: 'Upload file',
    });
    expect(valid.bodyLimit).toBe(11_534_336);

    for (const invalidLimit of [0, -1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        endpoint({
          method: 'POST',
          path: '/api/files/upload',
          auth: 'user',
          bodyLimit: invalidLimit,
          response: object({ id: string() }),
          summary: 'Upload file',
        }),
      ).toThrow(/bodyLimit must be a positive integer/);
    }
  });

  it('evaluates moderator auth: permits moderator and admin, denies anonymous and standard user', () => {
    expect(evaluateAuth('moderator', null)).toEqual({
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(evaluateAuth('moderator', { userId: 'u-1', role: 'user' })).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(evaluateAuth('moderator', { userId: 'u-2', role: 'guest' })).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(evaluateAuth('moderator', { userId: 'm-1', role: 'moderator' })).toEqual({ ok: true });
    expect(evaluateAuth('moderator', { userId: 'a-1', role: 'admin' })).toEqual({ ok: true });
  });
});
