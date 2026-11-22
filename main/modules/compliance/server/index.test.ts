// main/modules/compliance/server/index.test.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { identityModule } from '@bslt/identity/module';
import {
  buildModuleRouteMap,
  createCapabilityResolver,
  implementServer,
  registerServerModules,
} from '@bslt/server-system/module';

import { DOCUMENT_TYPES } from '../contract';

import { complianceServer } from './index';

import type { DbClient } from '@bslt/db';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const HOLD_ID = '33333333-3333-4333-8333-333333333333';

function makeFakeDb(): DbClient {
  const client: Partial<DbClient> = {
    query: vi.fn(async () => Promise.resolve([])),
    queryOne: vi.fn(async () => Promise.resolve(null)),
    execute: vi.fn(async () => Promise.resolve(0)),
    raw: vi.fn(async () => Promise.resolve([])),
    transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(client as DbClient),
    withSession: () => client as DbClient,
  };
  return client as DbClient;
}

describe('complianceServer module binding', () => {
  it('mounts all compliance endpoints, enforces 401/403/400/404 failure paths, and registers cron & privacy hooks', async () => {
    const db = makeFakeDb();
    const identityStub = implementServer(identityModule, {
      create: () => ({}),
      handlers: {} as never,
      jobs: {} as never,
    });
    const fakeServer = { route: vi.fn() };

    const instances = registerServerModules(
      fakeServer as never,
      { db } as never,
      [identityStub, complianceServer],
      {
        kernel: {
          db: {
            system: <T>(fn: (tx: DbClient) => Promise<T>) => fn(db),
            viewer: <T>(_v: unknown, fn: (tx: DbClient) => Promise<T>) => fn(db),
          },
          jobs: { enqueue: vi.fn(async () => Promise.resolve('j-1')) },
          events: { publish: vi.fn(async () => Promise.resolve()) },
          log: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(),
          } as never,
          clock: { now: () => new Date('2026-11-19T00:00:00.000Z') },
        },
        routerOptions: {
          prefix: '/api',
          jwtSecret: 'test-secret-for-compliance-module',
          authGuardFactory: () => async () => Promise.resolve(),
        },
        resolveDb: () => db,
        validateResponses: true,
      },
    );

    const inst = instances.get('compliance')!;
    expect(inst.hasPrivacy).toBe(true);
    expect(inst.cron.map((c) => c.name)).toEqual(['compliance.cleanup_expired_exports']);

    const routeMap = buildModuleRouteMap(inst, {
      resolveDb: () => db,
      resolveCapabilities: createCapabilityResolver({ instances }),
      validateResponses: true,
    });

    const reply = { header: () => reply } as never;
    const anonReq = { params: {}, query: {}, headers: {} } as never;
    const userReq = {
      user: { userId: USER_ID, email: 'u@test', role: 'user' },
      params: { id: HOLD_ID },
      query: {},
      headers: {},
    } as never;
    const adminReq = {
      user: { userId: ADMIN_ID, email: 'a@test', role: 'admin' },
      params: { id: HOLD_ID },
      query: {},
      headers: {},
    } as never;

    // Failure assertions (>= 60%): unauthenticated rejected on user & admin routes (401)
    for (const key of [
      'auth/tos/status',
      'auth/tos/accept',
      'users/me/agreements',
      'users/me/consent',
      'users/me/consent/update',
      'users/me/export',
      'users/me/export/:id/status',
      'users/me/export/:id/download',
      'compliance/age-assurance/check',
      'compliance/age-assurance/status',
      'admin/legal/publish',
      'admin/compliance/holds',
      'admin/compliance/holds/:id/release',
      'admin/compliance/jurisdictions',
      'admin/compliance/users/:userId/erase',
    ]) {
      await expect(routeMap.get(key)!.handler({}, {}, anonReq, reply)).rejects.toMatchObject({
        statusCode: 401,
      });
    }

    // Standard user rejected on admin routes (403)
    for (const key of [
      'admin/legal/publish',
      'admin/compliance/holds',
      'admin/compliance/holds/:id/release',
      'admin/compliance/jurisdictions',
      'admin/compliance/users/:userId/erase',
    ]) {
      await expect(routeMap.get(key)!.handler({}, {}, userReq, reply)).rejects.toMatchObject({
        statusCode: 403,
      });
    }

    // Domain failure assertions: 404 on missing export/hold, 400 on unconfirmed age attestation
    await expect(
      routeMap.get('users/me/export/:id/status')!.handler({}, {}, userReq, reply),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'compliance.DATA_EXPORT_NOT_FOUND',
    });

    await expect(
      routeMap.get('users/me/export/:id/download')!.handler({}, {}, userReq, reply),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'compliance.DATA_EXPORT_NOT_FOUND',
    });

    await expect(
      routeMap
        .get('compliance/age-assurance/check')!
        .handler({}, { confirmed: false }, userReq, reply),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'compliance.AGE_ASSURANCE_ATTESTATION_REQUIRED',
    });

    await expect(
      routeMap.get('admin/compliance/holds/:id/release')!.handler({}, {}, adminReq, reply),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'compliance.LEGAL_HOLD_NOT_FOUND',
    });

    await expect(
      routeMap.get('auth/tos/accept')!.handler({}, { documentId: '' }, userReq, reply),
    ).rejects.toMatchObject({
      statusCode: 400,
    });

    await expect(
      routeMap.get('auth/tos/accept')!.handler({}, { documentId: HOLD_ID }, userReq, reply),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'compliance.DOCUMENT_NOT_FOUND',
    });

    await expect(
      inst.invokeAction('compliance.recordSignupConsents', db, { userId: '' }),
    ).rejects.toThrow(/userId/);

    const tosStatus = await routeMap.get('auth/tos/status')!.handler({}, {}, userReq, reply);
    expect(tosStatus).toEqual({ accepted: true, requiredVersion: null, documentId: null });

    expect(await inst.invokeAction('compliance.peekSignupAgreements', db, {})).toEqual([]);

    // Public legal endpoint succeeds with empty seeded array
    const current = await routeMap.get('legal/current')!.handler({}, {}, anonReq, reply);
    expect(current).toEqual({ documents: [] });

    // Cleanup job + privacy hooks execute cleanly
    await inst.invokeJob('cleanupExpiredExports', {});
    expect(await inst.exportUserPrivacy!(USER_ID)).toEqual({
      agreements: [],
      consents: [],
      dataRequests: [],
      ageAssuranceChecks: [],
    });
    await expect(inst.eraseUserPrivacy!(db, USER_ID)).resolves.toBeUndefined();
  });
});

describe('legal document templates', () => {
  const SEED = path.join(__dirname, 'migrations', 'seeds', '0001_legal_templates.sql');
  let sql = '';

  beforeAll(async () => {
    sql = await readFile(SEED, 'utf8');
  });

  it.each([...DOCUMENT_TYPES])('seeds a template for %s', (type: string) => {
    expect(sql).toContain(`'${type}',`);
  });

  it('seeds every type at version 1, so the first admin edit becomes version 2', () => {
    const versions = [...sql.matchAll(/^ {2}(\d+),$/gmu)].map((match) => match[1]);
    expect(versions).toHaveLength(DOCUMENT_TYPES.length);
    expect(new Set(versions)).toEqual(new Set(['1']));
  });

  it('is idempotent, so re-running never overwrites a published document', () => {
    expect(sql).toContain('ON CONFLICT (type, version) DO NOTHING');
  });

  it('marks every template as unpublished scaffolding', () => {
    const banners = sql.match(/\*\*This is an unedited template\./gu) ?? [];
    expect(banners).toHaveLength(DOCUMENT_TYPES.length);
  });

  it('leaves operator-specific values as loud placeholders, never as invented facts', () => {
    expect(sql).toContain('[SET COMPANY_NAME]');
    expect(sql).toContain('[SET CONTACT_EMAIL]');
    expect(sql).toContain('[SET EFFECTIVE_DATE]');
    expect(sql).toContain('[SET GOVERNING_LAW]');
  });

  it('uses no placeholder syntax other than [SET …]', () => {
    expect(sql).not.toMatch(/\{\{|\[\[|<%|\$\{/u);
  });
});
