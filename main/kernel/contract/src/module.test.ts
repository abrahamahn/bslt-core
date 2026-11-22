// main/kernel/contract/src/module.test.ts
import { object, string } from '@bslt/schema';
import { describe, expect, it } from 'vitest';

import { endpoint } from './endpoint';
import { defineErrors } from './errors';
import { event } from './event';
import { job } from './job';
import {
  defineConfig,
  defineModule,
  mergeModuleCspNeeds,
  PROJECTION_MODULE_IDS,
  validateModule,
  validateModules,
  type BsltConfig,
  type CspNeeds,
  type FlagDef,
  type ModuleDefinition,
  type ModuleId,
} from './module';

const payload = object({ id: string({ min: 1 }) });
const modErrors = defineErrors('sample', { NOT_FOUND: 404 });

describe('module manifests and graph validation', () => {
  it('validates well-formed modules, topological dependsOn, and BsltConfig', () => {
    const id: ModuleId = 'identity';
    const identityMod = defineModule({
      id,
      summary: 'Identity shell',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      web: false,
    });

    const flag: FlagDef = { default: false, summary: 'Enable beta view' };
    const csp: CspNeeds = { 'img-src': ['https://cdn.example.com'] };
    const sampleMod = defineModule({
      id: 'sample',
      summary: 'Sample module',
      status: 'beta',
      dependsOn: [identityMod],
      endpoints: {
        list: endpoint({
          method: 'GET',
          path: '/api/sample',
          auth: 'user',
          response: payload,
          summary: 'List items',
        }),
        remove: endpoint({
          method: 'POST',
          path: '/api/sample/:id/delete',
          auth: 'user',
          response: payload,
          errors: [modErrors.NOT_FOUND],
          invalidates: ['list'],
          summary: 'Remove item',
        }),
      },
      events: {
        created: event('sample.item.created', payload),
      },
      jobs: {
        cleanup: job('sample.cleanup', payload, {
          queue: 'default',
          maxAttempts: 3,
          timeoutMs: 5000,
        }),
      },
      tables: ['sample', 'sample_items'],
      permissions: ['sample.manage'],
      flags: { 'sample.beta': flag },
      entitlements: ['sample.pro'],
      env: object({ SAMPLE_TIMEOUT_MS: string({ min: 1 }) }),
      csp,
    });

    expect(() => validateModule(sampleMod)).not.toThrow();
    const cfg: BsltConfig = defineConfig({
      name: 'BSLT',
      installedModules: [identityMod, sampleMod],
      devOnly: [],
      locales: ['en-US'],
      brand: { accent: 'oklch(0.62 0.19 264)', logo: '/brand/logo.svg' },
    });
    expect(cfg.installedModules).toHaveLength(2);
    expect(PROJECTION_MODULE_IDS).toEqual(['audit', 'notifications', 'webhooks', 'analytics']);
  });

  it('rejects invalid module ids, blank summaries, and unprefixed tables/events/jobs/flags/permissions/entitlements', () => {
    expect(() =>
      defineModule({
        id: 'bad_id',
        summary: 'Bad id',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
      }),
    ).toThrow(/module id/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: '  ',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        jobs: {},
        events: {},
        tables: [],
      }),
    ).toThrow(/summary/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Bad table prefix',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: ['other_table' as 'alpha'],
      }),
    ).toThrow(/table/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Mismatched event prefix',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: { wrong: event('beta.item.created', payload) },
        jobs: {},
        tables: [],
      }),
    ).toThrow(/event/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Mismatched job prefix',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {
          wrong: job('beta.work', payload, { queue: 'default', maxAttempts: 1, timeoutMs: 1000 }),
        },
        tables: [],
      }),
    ).toThrow(/job/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Mismatched permission prefix',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
        permissions: ['beta.manage' as 'alpha.manage'],
      }),
    ).toThrow(/permission/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Mismatched flag prefix',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
        flags: { ['beta.flag' as 'alpha.flag']: { default: false, summary: 'Wrong' } },
      }),
    ).toThrow(/flag/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Mismatched entitlement prefix',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
        entitlements: ['beta.pro' as 'alpha.pro'],
      }),
    ).toThrow(/entitlement/i);

    expect(() =>
      defineModule({
        id: 'alpha',
        summary: 'Scalar env schema instead of object',
        status: 'stable',
        dependsOn: [],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
        env: string({ min: 1 }),
      }),
    ).toThrow(/env.*object/i);
  });

  it('rejects endpoints referencing unregistered/foreign error codes or unknown sibling invalidates', () => {
    expect(() =>
      defineModule({
        id: 'sample',
        summary: 'Unregistered error',
        status: 'stable',
        dependsOn: [],
        endpoints: {
          get: endpoint({
            method: 'GET',
            path: '/api/sample/:id',
            auth: 'user',
            response: payload,
            errors: ['sample.NEVER_REGISTERED'],
            summary: 'Get',
          }),
        },
        events: {},
        jobs: {},
        tables: [],
      }),
    ).toThrow(/error code/i);

    defineErrors('other', { MISSING: 404 });
    expect(() =>
      defineModule({
        id: 'sample',
        summary: 'Foreign error code',
        status: 'stable',
        dependsOn: [],
        endpoints: {
          get: endpoint({
            method: 'GET',
            path: '/api/sample/:id',
            auth: 'user',
            response: payload,
            errors: ['other.MISSING'],
            summary: 'Get',
          }),
        },
        events: {},
        jobs: {},
        tables: [],
      }),
    ).toThrow(/error code/i);

    expect(() =>
      defineModule({
        id: 'sample',
        summary: 'Unknown invalidation sibling',
        status: 'stable',
        dependsOn: [],
        endpoints: {
          create: endpoint({
            method: 'POST',
            path: '/api/sample',
            auth: 'user',
            response: payload,
            invalidates: ['nonExistentList'],
            summary: 'Create',
          }),
        },
        events: {},
        jobs: {},
        tables: [],
      }),
    ).toThrow(/invalidates/i);
  });

  it('rejects duplicate module ids, missing dependsOn closure, out-of-order topological install, cycles, and projection dependsOn', () => {
    const base = defineModule({
      id: 'base',
      summary: 'Base',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    const dup = defineModule({
      id: 'base',
      summary: 'Duplicate base',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    expect(() => validateModules([base, dup])).toThrow(/duplicate module/i);

    const leaf = defineModule({
      id: 'leaf',
      summary: 'Leaf',
      status: 'stable',
      dependsOn: [base],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    expect(() => validateModules([leaf])).toThrow(/dependsOn.*not installed/i);
    expect(() => validateModules([leaf, base])).toThrow(/topological/i);

    const auditMod = defineModule({
      id: 'audit',
      summary: 'Audit projection',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    });
    expect(() =>
      defineModule({
        id: 'consumer',
        summary: 'Depends on projection',
        status: 'stable',
        dependsOn: [auditMod],
        endpoints: {},
        events: {},
        jobs: {},
        tables: [],
      }),
    ).toThrow(/projection module/i);

    const rawIllegalConsumer: ModuleDefinition = {
      id: 'consumer',
      summary: 'Depends on projection',
      status: 'stable',
      dependsOn: [auditMod],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    };
    expect(() => validateModules([auditMod, rawIllegalConsumer])).toThrow(/projection module/i);

    const cycleA: ModuleDefinition = {
      id: 'cyclea',
      summary: 'Cycle A',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    };
    const cycleB: ModuleDefinition = {
      id: 'cycleb',
      summary: 'Cycle B',
      status: 'stable',
      dependsOn: [cycleA],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
    };
    (cycleA as { dependsOn: readonly ModuleDefinition[] }).dependsOn = [cycleB];
    expect(() => validateModules([cycleA, cycleB])).toThrow(/cycle|topological/i);
  });

  it('rejects unsafe, wildcard, empty, whitespace-injected, or unknown module csp directives and merges valid needs deterministically', () => {
    const makeWithCsp = (csp: CspNeeds): ModuleDefinition => ({
      id: 'files',
      summary: 'Files module',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      csp,
    });

    expect(() => validateModule(makeWithCsp({ 'img-src': ['*'] }))).toThrow(/wildcard|unsafe/i);
    expect(() => validateModule(makeWithCsp({ 'img-src': ["'unsafe-inline'"] }))).toThrow(
      /unsafe/i,
    );
    expect(() => validateModule(makeWithCsp({ 'worker-src': ["'unsafe-eval'"] }))).toThrow(
      /unsafe/i,
    );
    expect(() => validateModule(makeWithCsp({ 'media-src': [''] }))).toThrow(/empty/i);
    expect(() =>
      validateModule(makeWithCsp({ 'media-src': ['https://a.test https://b.test'] })),
    ).toThrow(/whitespace|semicolon/i);
    expect(() =>
      validateModule(makeWithCsp({ 'media-src': ['https://a.test;script-src'] })),
    ).toThrow(/whitespace|semicolon/i);
    expect(() =>
      validateModule(makeWithCsp({ 'script-src': ['https://evil.test'] } as unknown as CspNeeds)),
    ).toThrow(/directive/i);

    const validFiles = defineModule({
      id: 'files',
      summary: 'Files module',
      status: 'stable',
      dependsOn: [],
      endpoints: {},
      events: {},
      jobs: {},
      tables: [],
      csp: {
        'img-src': ["'self'", 'blob:', 'https://cdn.bslt.dev'],
        'media-src': ["'self'", 'blob:'],
      },
    });

    const merged = mergeModuleCspNeeds(
      {
        'default-src': "'self'",
        'img-src': "'self' data: blob:",
        'object-src': "'none'",
      },
      [validFiles],
    );
    expect(merged).toEqual({
      'default-src': "'self'",
      'img-src': "'self' data: blob: https://cdn.bslt.dev",
      'object-src': "'none'",
      'media-src': "'self' blob:",
    });
  });
});
