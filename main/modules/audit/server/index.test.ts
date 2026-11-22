// main/modules/audit/server/index.test.ts
import { describe, expect, it, vi } from 'vitest';

import { event, mergeCapabilityContributions } from '@bslt/contract';
import { object, string } from '@bslt/schema';
import { runSubscriberTwice } from '@bslt/server-system/testing/subscribers';

import { auditModule } from '../module';

import { auditServer } from './index';

import type { DbClient } from '@bslt/db';
import type { DeliveredEvent, KernelServices, RequestContext } from '@bslt/server-system/module';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

const sampleTaskCreatedDef = event(
  'tasks.task.created',
  object({ taskId: string(), userId: string() }),
  {
    audit: { category: 'data', severity: 'info' },
    activity: true,
  },
);

function createFakeKernel() {
  const seenIdempotencyKeys = new Set<string>();
  const raw = vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('INSERT INTO audit_log')) {
      const key = String(params[11] ?? '');
      if (key !== '' && seenIdempotencyKeys.has(key)) {
        return [];
      }
      if (key !== '') seenIdempotencyKeys.add(key);
      return [
        {
          id: EVENT_ID,
          org_id: params[0],
          actor_id: params[1],
          subject_email: params[2],
          action: params[3],
          category: params[4],
          severity: params[5],
          resource: params[6],
          resource_id: params[7],
          metadata: {},
          ip_address: params[9],
          user_agent: params[10],
          idempotency_key: params[11],
          created_at: new Date('2026-11-17T00:00:00.000Z'),
        },
      ];
    }
    if (sql.includes('INSERT INTO audit_activity')) {
      const key = String(params[9] ?? '');
      if (key !== '' && seenIdempotencyKeys.has(key)) {
        return [];
      }
      if (key !== '') seenIdempotencyKeys.add(key);
      return [
        {
          id: EVENT_ID,
          org_id: params[0],
          actor_id: params[1],
          actor_type: params[2],
          action: params[3],
          resource_type: params[4],
          resource_id: params[5],
          description: params[6],
          metadata: {},
          ip_address: params[8],
          idempotency_key: params[9],
          created_at: new Date('2026-11-17T00:00:00.000Z'),
        },
      ];
    }
    return [];
  });

  const sysTx = { raw } as unknown as DbClient;
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  } as unknown as KernelServices['log'];

  const systemSpy = vi
    .fn()
    .mockImplementation(async (fn: (tx: DbClient) => Promise<unknown>) => fn(sysTx));

  const kernel: KernelServices = {
    db: { system: systemSpy },
    jobs: { enqueue: vi.fn() },
    events: { publish: vi.fn() },
    log,
    clock: { now: () => new Date('2026-11-17T00:00:00.000Z') },
  };

  return { kernel, raw, systemSpy, seenIdempotencyKeys };
}

function createFakeReq(viewer: RequestContext['viewer'], rawRows: unknown[] = []): RequestContext {
  const txDb = { raw: vi.fn().mockResolvedValue(rawRows) } as unknown as DbClient;
  return {
    viewer,
    caps: mergeCapabilityContributions({
      modules: [auditModule],
      viewer,
      contributions: [],
    }),
    tx: (fn) => fn(txDb),
    fail: (code: string, message?: unknown): never => {
      throw new Error(`${code}:${String(message ?? '')}`);
    },
  };
}

describe('auditServer', () => {
  it('is idempotent across duplicate deliveries on both audit and activity subscribers via runSubscriberTwice', async () => {
    const { kernel, seenIdempotencyKeys } = createFakeKernel();
    const instance = auditServer.instantiate(kernel, {}, {});

    const delivered: DeliveredEvent<Record<string, unknown>> = {
      eventId: 'outbox-101',
      name: 'tasks.task.created',
      version: 1,
      payload: { taskId: 'task-1', userId: USER_ID },
      actorUserId: USER_ID,
      orgId: null,
      occurredAt: '2026-11-17T00:00:00.000Z',
      def: sampleTaskCreatedDef,
    };

    await runSubscriberTwice((ev) => instance.invokeSubscriber('log', ev), delivered, undefined, {
      snapshot: () => ({ keys: [...seenIdempotencyKeys] }),
    });
    await runSubscriberTwice((ev) => instance.invokeSubscriber('feed', ev), delivered, undefined, {
      snapshot: () => ({ keys: [...seenIdempotencyKeys] }),
    });

    expect([...seenIdempotencyKeys]).toEqual(['audit:outbox-101', 'activity:outbox-101']);
  });

  it('fails with SECURITY_EVENT_NOT_FOUND when getSecurityEvent misses and never uses db.system', async () => {
    const { kernel, systemSpy } = createFakeKernel();
    const instance = auditServer.instantiate(kernel, {}, {});
    const req = createFakeReq({ userId: USER_ID, role: 'admin' }, []);

    await expect(
      instance.invokeHandler('getSecurityEvent', { params: { id: EVENT_ID } }, req),
    ).rejects.toThrow(/SECURITY_EVENT_NOT_FOUND/);
    expect(systemSpy).not.toHaveBeenCalled();
  });

  it('scopes listActivities strictly to viewer req.tx without touching db.system', async () => {
    const { kernel, systemSpy } = createFakeKernel();
    const instance = auditServer.instantiate(kernel, {}, {});
    const req = createFakeReq({ userId: USER_ID, role: 'user' }, []);

    const out = await instance.invokeHandler('listActivities', { query: {} }, req);
    expect(out).toEqual({ activities: [] });
    expect(systemSpy).not.toHaveBeenCalled();
  });

  it('registers privacy exportUser and eraseUser hooks on audit_activity and propagates DB failures', async () => {
    const { kernel, raw } = createFakeKernel();
    const instance = auditServer.instantiate(kernel, {}, {});
    expect(instance.hasPrivacy).toBe(true);

    raw.mockResolvedValueOnce([
      {
        id: EVENT_ID,
        org_id: null,
        actor_id: USER_ID,
        actor_type: 'user',
        action: 'tasks.task.created',
        resource_type: 'task',
        resource_id: 't-1',
        description: null,
        metadata: {},
        ip_address: null,
        idempotency_key: null,
        created_at: new Date('2026-11-17T00:00:00.000Z'),
      },
    ]);
    await expect(instance.exportUserPrivacy!(USER_ID)).resolves.toEqual({
      activities: [
        {
          action: 'tasks.task.created',
          resource: 'task',
          createdAt: '2026-11-17T00:00:00.000Z',
        },
      ],
    });

    raw.mockResolvedValueOnce([{ id: EVENT_ID }]);
    await instance.eraseUserPrivacy!({ raw } as unknown as DbClient, USER_ID);

    raw.mockRejectedValueOnce(new Error('audit activity erase failed'));
    await expect(
      instance.eraseUserPrivacy!({ raw } as unknown as DbClient, USER_ID),
    ).rejects.toThrow('audit activity erase failed');
  });
});
