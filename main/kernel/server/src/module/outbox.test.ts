// main/kernel/server/src/module/outbox.test.ts
import { defineModule, event } from '@bslt/contract';
import { object, sealed, string } from '@bslt/schema';
import { describe, expect, it, vi } from 'vitest';

import { collectModuleSubscribers, createOutboxDispatcher, SUBSCRIBER_JOB_PREFIX } from './outbox';
import { OutboxSealError } from './sealed';
import {
  createKernelEventsService,
  createKernelJobsService,
  implementServer,
  on,
  onFlagged,
  type Clock,
  type DeliveredEvent,
  type KernelServices,
  type Tx,
} from './server-module';

import type { Logger } from '../logger/types';
import type { DbClient } from '@bslt/db';

const SEAL_SECRET = 'unit-test-outbox-seal-secret-1234';

const orgsEvents = {
  memberAdded: event(
    'orgs.member.added',
    object({
      orgId: string({ min: 1 }),
      userId: string({ min: 1 }),
      inviteSecret: sealed(string({ min: 8 })),
    }),
    {
      webhook: true,
      audit: { category: 'admin', severity: 'info' },
      realtime: (p) => ({ channel: `org:${p.orgId}`, invalidate: ['members'] }),
    },
  ),
};

const orgsModule = defineModule({
  id: 'orgs',
  summary: 'Organizations module',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: orgsEvents,
  jobs: {},
  tables: [],
  web: false,
});

const billingModule = defineModule({
  id: 'billing',
  summary: 'Billing module depending on orgs',
  status: 'stable',
  dependsOn: [orgsModule],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});

const unrelatedModule = defineModule({
  id: 'tasks',
  summary: 'Tasks module NOT depending on orgs',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});

const webhooksModule = defineModule({
  id: 'webhooks',
  summary: 'Outbound webhooks projection',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});

const silentLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

function makeKernel(): KernelServices {
  const clock: Clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };
  const fakeTx = {} as Tx;
  return {
    db: { system: <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> => fn(fakeTx) },
    jobs: createKernelJobsService(clock),
    events: createKernelEventsService({ sealSecret: SEAL_SECRET, clock }),
    log: silentLogger,
    clock,
  };
}

describe('events.publish, on / onFlagged subscribers, and sys.outbox.dispatch', () => {
  it('rejects direct on() subscription when producer module is missing from dependsOn', () => {
    expect(() =>
      implementServer(unrelatedModule, {
        create: () => ({}),
        handlers: {},
        subscribers: [
          on(orgsEvents.memberAdded, {
            id: 'illegal_sub',
            handle: async () => {},
          }),
        ],
      }),
    ).toThrow(/dependsOn/i);
  });

  it('rejects duplicate or malformed subscriber ids in implementServer', () => {
    expect(() =>
      implementServer(billingModule, {
        create: () => ({}),
        handlers: {},
        subscribers: [on(orgsEvents.memberAdded, { id: 'bad id!', handle: async () => {} })],
      }),
    ).toThrow(/subscriber id/i);

    expect(() =>
      implementServer(billingModule, {
        create: () => ({}),
        handlers: {},
        subscribers: [
          on(orgsEvents.memberAdded, { id: 'sync_seat', handle: async () => {} }),
          on(orgsEvents.memberAdded, { id: 'sync_seat', handle: async () => {} }),
        ],
      }),
    ).toThrow(/duplicate subscriber id/i);
  });

  it('rejects invalid event payloads in events.publish before executing SQL', async () => {
    const executed: unknown[] = [];
    const fakeTx = {
      execute: (q: unknown) => {
        executed.push(q);
        return Promise.resolve(1);
      },
    } as unknown as Tx;

    const kernel = makeKernel();
    await expect(
      kernel.events.publish(fakeTx, orgsEvents.memberAdded, {
        orgId: '',
        userId: 'u-1',
        inviteSecret: 'short',
      }),
    ).rejects.toThrow();
    expect(executed).toHaveLength(0);
  });

  it('rejects unknown subscriber invocation on an instantiated module', async () => {
    const srv = implementServer(orgsModule, {
      create: () => ({}),
      handlers: {},
    });
    const inst = srv.instantiate(makeKernel(), {});
    await expect(
      inst.invokeSubscriber('missing', {
        eventId: '1',
        name: 'orgs.member.added',
        version: 1,
        payload: {},
        actorUserId: null,
        orgId: null,
        occurredAt: '2026-11-14T12:00:00.000Z',
      }),
    ).rejects.toThrow(/unknown subscriber/i);
  });

  it('rejects tampered sealed base64 payloads inside subscriber job execution', async () => {
    const billingServer = implementServer(billingModule, {
      create: () => ({}),
      handlers: {},
      subscribers: [
        on(orgsEvents.memberAdded, {
          id: 'sync_seat',
          handle: async () => {},
        }),
      ],
    });
    const kernel = makeKernel();
    const orgsInst = implementServer(orgsModule, { create: () => ({}), handlers: {} }).instantiate(
      kernel,
      {},
    );
    const billingInst = billingServer.instantiate(kernel, {});

    const { handlers } = collectModuleSubscribers([orgsInst, billingInst], {
      sealSecret: SEAL_SECRET,
    });
    const jobHandler = handlers[`${SUBSCRIBER_JOB_PREFIX}billing.sync_seat`];
    expect(jobHandler).toBeTypeOf('function');

    await expect(
      jobHandler!({
        eventId: '7',
        name: 'orgs.member.added',
        version: 1,
        payload: { orgId: 'o-1', userId: 'u-1', inviteSecret: '[REDACTED]' },
        sealed: Buffer.alloc(40, 0xaa).toString('base64'),
        actorUserId: 'u-actor',
        orgId: 'o-1',
        occurredAt: '2026-11-14T12:00:00.000Z',
      }),
    ).rejects.toThrow(OutboxSealError);
  });

  it('logs and survives transient DB errors during background poll ticks', async () => {
    const loggedErrors: string[] = [];
    const errorLogger: Logger = {
      ...silentLogger,
      error: (msg: unknown) => {
        loggedErrors.push(typeof msg === 'string' ? msg : String(msg));
      },
    };
    const failingDb = {
      transaction: () => Promise.reject(new Error('transient connection reset')),
    } as unknown as DbClient;

    const dispatcher = createOutboxDispatcher({
      db: failingDb,
      subscribers: [],
      eventsByName: new Map(),
      log: errorLogger,
      pollIntervalMs: 25,
    });

    await dispatcher.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await dispatcher.stop();

    expect(loggedErrors.length).toBeGreaterThan(0);
  });

  it('publishes sealed events to sys_outbox, claims with SKIP LOCKED, fans out per subscriber, and delivers unsealed payloads', async () => {
    const directReceived: Array<
      DeliveredEvent<{ orgId: string; userId: string; inviteSecret: string }>
    > = [];
    const webhookReceived: Array<DeliveredEvent<Record<string, unknown>>> = [];

    const orgsServer = implementServer(orgsModule, {
      create: () => ({}),
      handlers: {},
    });
    const billingServer = implementServer(billingModule, {
      create: () => ({ multiplier: 2 }),
      handlers: {},
      subscribers: [
        on(orgsEvents.memberAdded, {
          id: 'sync_seat',
          handle: async (ev, s: { multiplier: number }) => {
            expect(s.multiplier).toBe(2);
            directReceived.push(ev);
            await Promise.resolve();
          },
        }),
      ],
    });
    const webhooksServer = implementServer(webhooksModule, {
      create: () => ({}),
      handlers: {},
      subscribers: [
        onFlagged('webhook', {
          id: 'fanout',
          handle: async (ev) => {
            webhookReceived.push(ev);
            await Promise.resolve();
          },
        }),
      ],
    });

    const kernel = makeKernel();
    const instances = [
      orgsServer.instantiate(kernel, {}),
      billingServer.instantiate(kernel, {}),
      webhooksServer.instantiate(kernel, {}),
    ];

    // Step 1: Capture k.events.publish INSERT into sys_outbox
    const publishedRows: Array<{
      id: string;
      name: string;
      version: number;
      payload: Record<string, unknown>;
      sealed_b64: string | null;
      actor_user_id: string | null;
      org_id: string | null;
      occurred_at: string;
    }> = [];

    const publishTx = {
      execute: (q: { text: string; values: unknown[] }) => {
        expect(q.text).toContain('INSERT INTO sys_outbox');
        const sealedBuf = q.values[3] as Buffer | null;
        const payloadStr = q.values[2] as string;
        expect(payloadStr).not.toContain('invite-secret-token');
        publishedRows.push({
          id: '101',
          name: q.values[0] as string,
          version: q.values[1] as number,
          payload: JSON.parse(payloadStr) as Record<string, unknown>,
          sealed_b64: sealedBuf !== null ? sealedBuf.toString('base64') : null,
          actor_user_id: (q.values[4] as string | null) ?? 'actor-9',
          org_id: (q.values[5] as string | null) ?? 'org-7',
          occurred_at: q.values[6] as string,
        });
        return Promise.resolve(1);
      },
    } as unknown as Tx;

    await kernel.events.publish(
      publishTx,
      orgsEvents.memberAdded,
      {
        orgId: 'org-7',
        userId: 'user-3',
        inviteSecret: 'invite-secret-token',
      },
      { actorUserId: 'actor-9', orgId: 'org-7' },
    );
    expect(publishedRows).toHaveLength(1);
    expect(publishedRows[0]?.sealed_b64).toBeTruthy();

    // Step 2: Run OutboxDispatcher.dispatchBatch() and capture sys_jobs enqueues + realtime
    const collected = collectModuleSubscribers(instances, { sealSecret: SEAL_SECRET });
    const enqueuedJobs: Array<{
      name: string;
      args: Record<string, unknown>;
      idempotencyKey: string;
    }> = [];
    const markedDispatchedIds: string[][] = [];
    const realtimePublished: Array<{ channel: string; invalidate?: readonly string[] }> = [];

    const dispatchTx = {
      raw: (sql: string) => {
        expect(sql).toContain('FOR UPDATE SKIP LOCKED');
        return Promise.resolve(publishedRows.splice(0, publishedRows.length));
      },
      execute: (q: { text: string; values: unknown[] }) => {
        if (q.text.includes('INSERT INTO sys_jobs')) {
          enqueuedJobs.push({
            name: q.values[1] as string,
            args: JSON.parse(q.values[4] as string) as Record<string, unknown>,
            idempotencyKey: q.values[9] as string,
          });
        } else if (q.text.includes('UPDATE sys_outbox')) {
          markedDispatchedIds.push(q.values[0] as string[]);
        }
        return Promise.resolve(1);
      },
    };
    const dispatchDb = {
      transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(dispatchTx),
    } as unknown as DbClient;

    const dispatcher = createOutboxDispatcher({
      db: dispatchDb,
      subscribers: collected.subscribers,
      eventsByName: collected.eventsByName,
      log: silentLogger,
      onRealtime: (proj) => {
        realtimePublished.push(proj);
      },
    });

    const claimed = await dispatcher.dispatchBatch();
    expect(claimed).toBe(1);
    expect(markedDispatchedIds).toEqual([['101']]);
    expect(realtimePublished).toEqual([{ channel: 'org:org-7', invalidate: ['members'] }]);
    expect(enqueuedJobs).toHaveLength(2);
    expect(enqueuedJobs.map((j) => j.idempotencyKey).sort()).toEqual([
      '101:billing.sync_seat',
      '101:webhooks.fanout',
    ]);

    // Step 3: Execute each enqueued subscriber job and verify unsealing
    for (const job of enqueuedJobs) {
      expect(JSON.stringify(job.args)).not.toContain('invite-secret-token');
      const handler = collected.handlers[job.name];
      expect(handler).toBeTypeOf('function');
      await handler!(job.args);
    }

    expect(directReceived).toHaveLength(1);
    expect(directReceived[0]?.eventId).toBe('101');
    expect(directReceived[0]?.payload.inviteSecret).toBe('invite-secret-token');
    expect(webhookReceived).toHaveLength(1);
    expect(webhookReceived[0]?.payload['inviteSecret']).toBe('invite-secret-token');
    expect(webhookReceived[0]?.def?.name).toBe('orgs.member.added');
  });

  it('wakes immediately on NOTIFY signal via injected listener and stops cleanly', async () => {
    let notifyCb: ((payload: string) => void) | undefined;
    const stopListener = vi.fn(() => Promise.resolve());
    let claims = 0;

    const fakeDb = {
      transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn({
          raw: () => {
            claims += 1;
            return Promise.resolve([]);
          },
        }),
    } as unknown as DbClient;

    const dispatcher = createOutboxDispatcher({
      db: fakeDb,
      subscribers: [],
      eventsByName: new Map(),
      log: silentLogger,
      pollIntervalMs: 60_000,
      listenerFactory: ({ onNotify }) => {
        notifyCb = onNotify;
        return {
          isActive: true,
          start: () => Promise.resolve(),
          stop: stopListener,
        };
      },
    });

    await dispatcher.start();
    const initialClaims = claims;
    notifyCb?.('');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claims).toBeGreaterThan(initialClaims);

    await dispatcher.stop();
    expect(stopListener).toHaveBeenCalledTimes(1);
  });

  it('invokes onSessionRevoked after commit only for valid identity.session.revoked rows and survives callback errors or tx rollback', async () => {
    const revocations: Array<{ readonly userId: string; readonly sessionId?: string | undefined }> =
      [];
    const warnings: string[] = [];
    const warnLogger: Logger = {
      ...silentLogger,
      warn: (_ctx: unknown, msg?: string) => {
        warnings.push(msg ?? '');
      },
    };

    // Failure case 1: transaction fails before commit -> onSessionRevoked must not fire
    const rollbackDb = {
      transaction: () => Promise.reject(new Error('tx aborted')),
    } as unknown as DbClient;
    const rollbackDispatcher = createOutboxDispatcher({
      db: rollbackDb,
      subscribers: [],
      eventsByName: new Map(),
      log: warnLogger,
      onSessionRevoked: (rev) => {
        revocations.push(rev);
      },
    });
    await expect(rollbackDispatcher.dispatchBatch()).rejects.toThrow('tx aborted');
    expect(revocations).toHaveLength(0);

    // Failure case 2 & 3 + happy path: malformed payload (empty userId) skipped, throwing callback caught & warned, subsequent valid revocation still delivered
    const rows = [
      {
        id: '201',
        name: 'identity.session.revoked',
        version: 1,
        payload: { userId: '', reason: 'logout_all' },
        sealed_b64: null,
        actor_user_id: null,
        org_id: null,
        occurred_at: '2026-11-19T00:00:00.000Z',
      },
      {
        id: '202',
        name: 'identity.session.revoked',
        version: 1,
        payload: { userId: 'user-throw', sessionId: 'sess-1', reason: 'logout_all' },
        sealed_b64: null,
        actor_user_id: 'user-throw',
        org_id: null,
        occurred_at: '2026-11-19T00:00:01.000Z',
      },
      {
        id: '203',
        name: 'identity.session.revoked',
        version: 1,
        payload: { userId: 'user-ok', reason: 'logout_all' },
        sealed_b64: null,
        actor_user_id: 'user-ok',
        org_id: null,
        occurred_at: '2026-11-19T00:00:02.000Z',
      },
    ];

    const okDb = {
      transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn({
          raw: () => Promise.resolve(rows.splice(0, rows.length)),
          execute: () => Promise.resolve(1),
        }),
    } as unknown as DbClient;

    const dispatcher = createOutboxDispatcher({
      db: okDb,
      subscribers: [],
      eventsByName: new Map(),
      log: warnLogger,
      onSessionRevoked: (rev) => {
        if (rev.userId === 'user-throw') {
          return Promise.reject(new Error('gateway down'));
        }
        revocations.push(rev);
        return undefined;
      },
    });

    const claimed = await dispatcher.dispatchBatch();
    expect(claimed).toBe(3);
    expect(warnings.some((m) => m.includes('Session revocation'))).toBe(true);
    expect(revocations).toEqual([{ userId: 'user-ok' }]);
  });
});
