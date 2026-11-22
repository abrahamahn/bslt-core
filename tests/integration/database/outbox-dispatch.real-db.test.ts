// tests/integration/database/outbox-dispatch.real-db.test.ts
/**
 * Transactional outbox (`sys_outbox`), `sealed()` encryption, `NOTIFY bslt_outbox`,
 * `SKIP LOCKED` claiming, and per-subscriber retry isolation (Real DB, Plan §8.1–§8.5).
 */

import { randomUUID } from 'node:crypto';

import { defineModule, event } from '@bslt/contract';
import {
  createPostgresChannelListener,
  createQueueServer,
  PostgresQueueStore,
  queuesForRole,
  type DbClient,
} from '@bslt/db';
import { object, sealed, string } from '@bslt/schema';
import {
  collectModuleSubscribers,
  createKernelEventsService,
  createKernelJobsService,
  createOutboxDispatcher,
  implementServer,
  on,
  onFlagged,
  type DeliveredEvent,
  type KernelServices,
} from '@bslt/server-system/module';
import { createMockLogger, runSubscriberTwice } from '@bslt/testing';
import { describeRealDb } from '@bslt/testing/real-db';
import { beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;
const SEAL_SECRET = 'real-db-outbox-seal-secret-32bytes-minimum!!';
const FIXED_NOW = new Date('2026-11-14T04:00:00.000Z');

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function gate(): { readonly reached: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error(`Condition did not settle within ${String(timeoutMs)}ms`);
}

async function seedUser(admin: DbClient, label: string): Promise<string> {
  const id = randomUUID();
  const email = `${label}-${id}@outbox.test`;
  await admin.raw(
    `INSERT INTO identity_users (id, email, canonical_email, username, role, email_verified, email_verified_at)
     VALUES ($1, $2, $2, $3, 'user', true, now())`,
    [id, email, `${label}_${id.slice(0, 8)}`],
  );
  return id;
}

const producerSecretRotated = event(
  'alpha.secret.rotated',
  object({
    resourceId: string(),
    signingSecret: sealed(string()),
  }),
  {
    webhook: true,
    realtime: (p) => ({
      channel: `alpha:${p.resourceId}`,
      invalidate: ['alpha:list'],
    }),
  },
);

const alphaModule = defineModule({
  id: 'alpha',
  summary: 'Alpha producer test module',
  status: 'stable',
  dependsOn: [],
  endpoints: {},
  events: {
    secretRotated: producerSecretRotated,
  },
  jobs: {},
  tables: [],
  web: false,
});

const consumerModule = defineModule({
  id: 'consumer',
  summary: 'Consumer subscriber test module',
  status: 'stable',
  dependsOn: [alphaModule],
  endpoints: {},
  events: {},
  jobs: {},
  tables: [],
  web: false,
});

describeRealDb(
  'Transactional outbox dispatch, sealed(), and per-subscriber retry (Real DB)',
  (realDb) => {
    const clock = { now: () => FIXED_NOW };

    beforeEach(async () => {
      await realDb.database.ownerDb.raw('TRUNCATE sys_outbox, sys_jobs RESTART IDENTITY');
    });

    it(
      'leaves zero rows in sys_outbox and emits zero NOTIFY signals when the enclosing transaction rolls back',
      async () => {
        const userId = await seedUser(realDb.database.adminDb, 'rollback');
        const events = createKernelEventsService({ sealSecret: SEAL_SECRET, clock });
        const notifications: string[] = [];

        const listener = createPostgresChannelListener({
          connectionString: realDb.database.connectionString,
          channel: 'bslt_outbox',
          ssl: false,
          onNotify: (payload) => {
            notifications.push(payload);
          },
        });
        await listener.start();

        try {
          // 1. Rolled-back user session transaction (bslt_app)
          const userSession = realDb.database.appDb.withSession({ userId, role: 'user' });
          await expect(
            userSession.transaction(async (tx) => {
              await events.publish(tx, producerSecretRotated, {
                resourceId: 'res-aborted-user',
                signingSecret: 'whsec_aborted_1',
              });
              throw new Error('abort user transaction');
            }),
          ).rejects.toThrow('abort user transaction');

          // 2. Rolled-back system/worker transaction (bslt_worker)
          await expect(
            realDb.database.db.transaction(async (tx) => {
              await events.publish(
                tx,
                producerSecretRotated,
                {
                  resourceId: 'res-aborted-worker',
                  signingSecret: 'whsec_aborted_2',
                },
                { actorUserId: userId },
              );
              throw new Error('abort worker transaction');
            }),
          ).rejects.toThrow('abort worker transaction');

          await sleep(150);

          const outboxCount = await realDb.database.adminDb.raw<{ count: number }>(
            'SELECT count(*)::int AS count FROM sys_outbox',
          );
          expect(outboxCount[0]?.count).toBe(0);
          expect(notifications).toEqual([]);

          const dispatcher = createOutboxDispatcher({
            db: realDb.database.db,
            subscribers: [],
            eventsByName: new Map([[producerSecretRotated.name, producerSecretRotated]]),
            log: createMockLogger(),
          });
          expect(await dispatcher.dispatchBatch()).toBe(0);
        } finally {
          await listener.stop();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'rejects forged actor_user_id and non-member org_id publishes under bslt_app RLS',
      async () => {
        const aliceId = await seedUser(realDb.database.adminDb, 'alice');
        const bobId = await seedUser(realDb.database.adminDb, 'bob');
        const bobOrgId = randomUUID();
        const [orgsReg] = await realDb.database.adminDb.raw<{ reg: string | null }>(
          `SELECT to_regclass('public.orgs')::text AS reg`,
        );
        if (orgsReg?.reg !== null) {
          await realDb.database.adminDb.raw(
            `INSERT INTO orgs (id, name, slug, owner_id) VALUES ($1, $2, $2, $3)`,
            [bobOrgId, `org-${bobOrgId}`, bobId],
          );
          await realDb.database.adminDb.raw(
            `INSERT INTO orgs_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
            [bobOrgId, bobId],
          );
        }

        const events = createKernelEventsService({ sealSecret: SEAL_SECRET, clock });
        const aliceSession = realDb.database.appDb.withSession({
          userId: aliceId,
          role: 'user',
        });

        // Forged actorUserId rejected by RLS WITH CHECK
        await expect(
          aliceSession.transaction(async (tx) => {
            await events.publish(
              tx,
              producerSecretRotated,
              { resourceId: 'forged-actor', signingSecret: 'sec' },
              { actorUserId: bobId },
            );
          }),
        ).rejects.toMatchObject({ code: '42501' });

        // Non-member orgId rejected by RLS WITH CHECK
        await expect(
          aliceSession.transaction(async (tx) => {
            await events.publish(
              tx,
              producerSecretRotated,
              { resourceId: 'foreign-org', signingSecret: 'sec' },
              { orgId: bobOrgId },
            );
          }),
        ).rejects.toMatchObject({ code: '42501' });

        const outboxCount = await realDb.database.adminDb.raw<{ count: number }>(
          'SELECT count(*)::int AS count FROM sys_outbox',
        );
        expect(outboxCount[0]?.count).toBe(0);
      },
      TEST_TIMEOUT,
    );

    it(
      'redacts sealed() secrets at rest, wakes on NOTIFY bslt_outbox, retries a failing subscriber independently, and proves idempotency with runSubscriberTwice',
      async () => {
        const userId = await seedUser(realDb.database.adminDb, 'commit');
        const [orgsReg] = await realDb.database.adminDb.raw<{ reg: string | null }>(
          `SELECT to_regclass('public.orgs')::text AS reg`,
        );
        const hasOrgs = orgsReg?.reg !== null;
        const orgId = hasOrgs ? randomUUID() : undefined;
        if (hasOrgs && orgId !== undefined) {
          await realDb.database.adminDb.raw(
            `INSERT INTO orgs (id, name, slug, owner_id) VALUES ($1, $2, $2, $3)`,
            [orgId, `org-${orgId}`, userId],
          );
          await realDb.database.adminDb.raw(
            `INSERT INTO orgs_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
            [orgId, userId],
          );
        }

        const PLAINTEXT_SECRET = 'whsec_live_super_secret_token_999';
        let directAttempts = 0;
        const directSuccesses: DeliveredEvent<{ resourceId: string; signingSecret: string }>[] = [];
        const webhookSuccesses: DeliveredEvent<Record<string, unknown>>[] = [];
        const realtimeProjections: { channel: string; invalidate?: readonly string[] }[] = [];

        const alphaServer = implementServer(alphaModule, {
          create: () => ({}),
          handlers: {},
        });

        const consumerServer = implementServer(consumerModule, {
          create: () => ({}),
          handlers: {},
          subscribers: [
            on(producerSecretRotated, {
              id: 'flaky-direct',
              handle: async (ev) => {
                directAttempts += 1;
                if (directAttempts === 1) {
                  throw new Error('transient downstream outage on attempt 1');
                }
                directSuccesses.push(ev);
                await Promise.resolve();
              },
            }),
            onFlagged('webhook', {
              id: 'steady-webhook',
              handle: async (ev) => {
                webhookSuccesses.push(ev);
                await Promise.resolve();
              },
            }),
          ],
        });

        const eventsService = createKernelEventsService({ sealSecret: SEAL_SECRET, clock });
        const jobsService = createKernelJobsService(clock);
        const log = createMockLogger();

        const kernel: KernelServices = {
          db: {
            system: <T>(fn: (tx: DbClient) => Promise<T>) => realDb.database.db.transaction(fn),
          },
          jobs: jobsService,
          events: eventsService,
          log,
          clock,
        };
        const instances = [
          alphaServer.instantiate(kernel, {}),
          consumerServer.instantiate(kernel, {}),
        ];

        const collected = collectModuleSubscribers(instances, { sealSecret: SEAL_SECRET });

        // Start dispatcher BEFORE publishing with a 30s fallback poll so ONLY NOTIFY wakes it quickly.
        const dispatcher = createOutboxDispatcher({
          db: realDb.database.db,
          subscribers: collected.subscribers,
          eventsByName: collected.eventsByName,
          log,
          listenConnectionString: realDb.database.connectionString,
          ssl: false,
          pollIntervalMs: 30_000,
          onRealtime: (proj) => {
            realtimeProjections.push(proj);
          },
        });

        const queueStore = new PostgresQueueStore(realDb.database.db);
        const queueServer = createQueueServer({
          store: queueStore,
          handlers: collected.handlers,
          jobSpecs: collected.jobSpecs,
          queues: queuesForRole('worker'),
          config: {
            pollIntervalMs: 25,
            backoffBaseMs: 25,
            maxBackoffMs: 100,
          },
        });

        await dispatcher.start();
        queueServer.start();

        try {
          // Publish inside user + org session transaction; NOTIFY bslt_outbox fires on commit.
          const memberSession = realDb.database.appDb.withSession({
            userId,
            ...(orgId !== undefined ? { orgId } : {}),
            role: 'user',
          });
          await memberSession.transaction(async (tx) => {
            await eventsService.publish(tx, producerSecretRotated, {
              resourceId: 'wh-42',
              signingSecret: PLAINTEXT_SECRET,
            });
          });

          await waitFor(async () => {
            if (directSuccesses.length !== 1 || webhookSuccesses.length !== 1) {
              return false;
            }
            const completed = await realDb.database.adminDb.raw<{ count: number }>(
              `SELECT count(*)::int AS count FROM sys_jobs WHERE status = 'completed'`,
            );
            return (completed[0]?.count ?? 0) === 2;
          }, 5_000);

          // Subscriber A failed once then succeeded on retry; Subscriber B ran once without re-running!
          expect(directAttempts).toBe(2);
          expect(directSuccesses).toHaveLength(1);
          expect(webhookSuccesses).toHaveLength(1);

          expect(directSuccesses[0]).toMatchObject({
            name: 'alpha.secret.rotated',
            version: 1,
            actorUserId: userId,
            orgId: orgId ?? null,
            payload: {
              resourceId: 'wh-42',
              signingSecret: PLAINTEXT_SECRET,
            },
          });
          expect(webhookSuccesses[0]?.payload).toEqual({
            resourceId: 'wh-42',
            signingSecret: PLAINTEXT_SECRET,
          });
          expect(realtimeProjections).toEqual([
            { channel: 'alpha:wh-42', invalidate: ['alpha:list'] },
          ]);

          // Verify at-rest redaction in BOTH sys_outbox.payload and sys_jobs.args!
          const [outboxRow] = await realDb.database.adminDb.raw<{
            payload_text: string;
            secret_field: string;
            sealed_bytes: Buffer | null;
            dispatched_at: Date | null;
          }>(
            `SELECT payload::text AS payload_text,
                  payload->>'signingSecret' AS secret_field,
                  sealed AS sealed_bytes,
                  dispatched_at
             FROM sys_outbox`,
          );
          expect(outboxRow?.secret_field).toBe('[REDACTED]');
          expect(outboxRow?.payload_text).not.toContain(PLAINTEXT_SECRET);
          expect(outboxRow?.sealed_bytes).not.toBeNull();
          expect(outboxRow?.sealed_bytes?.toString('utf8')).not.toContain(PLAINTEXT_SECRET);
          expect(outboxRow?.dispatched_at).not.toBeNull();

          const jobRows = await realDb.database.adminDb.raw<{
            name: string;
            status: string;
            attempts: number;
            args_text: string;
            idempotency_key: string;
          }>(
            `SELECT name, status, attempts, args::text AS args_text, idempotency_key
             FROM sys_jobs
            ORDER BY name ASC`,
          );
          expect(jobRows).toHaveLength(2);
          for (const jobRow of jobRows) {
            expect(jobRow.status).toBe('completed');
            expect(jobRow.args_text).toContain('[REDACTED]');
            expect(jobRow.args_text).not.toContain(PLAINTEXT_SECRET);
          }
          expect(
            jobRows.find((r) => r.name === 'sys.outbox.sub:consumer.flaky-direct')?.attempts,
          ).toBe(2);
          expect(
            jobRows.find((r) => r.name === 'sys.outbox.sub:consumer.steady-webhook')?.attempts,
          ).toBe(1);

          // Prove idempotent replay via @bslt/testing's `runSubscriberTwice` against real Postgres
          const deliveredSample = directSuccesses[0];
          if (deliveredSample === undefined) {
            throw new Error('Expected deliveredSample');
          }
          const seenEventIds = new Set<string>();
          const recordedResourceIds: string[] = [];
          await runSubscriberTwice(
            async (ev: typeof deliveredSample) => {
              if (!seenEventIds.has(ev.eventId)) {
                seenEventIds.add(ev.eventId);
                recordedResourceIds.push(ev.payload.resourceId);
              }
              await Promise.resolve();
            },
            deliveredSample,
            undefined,
            { snapshot: () => [...recordedResourceIds] },
          );
          expect(recordedResourceIds).toEqual(['wh-42']);
        } finally {
          await dispatcher.stop();
          await queueServer.stop();
        }
      },
      TEST_TIMEOUT,
    );

    it(
      'skips locked outbox rows via SKIP LOCKED without blocking, deduplicates subscriber jobs, and prunes old dispatched rows',
      async () => {
        const eventsService = createKernelEventsService({ sealSecret: SEAL_SECRET, clock });
        await realDb.database.db.transaction(async (tx) => {
          await eventsService.publish(tx, producerSecretRotated, {
            resourceId: 'first-locked',
            signingSecret: 's1',
          });
          await eventsService.publish(tx, producerSecretRotated, {
            resourceId: 'second-free',
            signingSecret: 's2',
          });
        });

        const consumerServer = implementServer(consumerModule, {
          create: () => ({}),
          handlers: {},
          subscribers: [
            on(producerSecretRotated, {
              id: 'dedupe-check',
              handle: async () => Promise.resolve(),
            }),
          ],
        });
        const alphaServer = implementServer(alphaModule, {
          create: () => ({}),
          handlers: {},
        });
        const log = createMockLogger();
        const kernel: KernelServices = {
          db: {
            system: <T>(fn: (tx: DbClient) => Promise<T>) => realDb.database.db.transaction(fn),
          },
          jobs: createKernelJobsService(clock),
          events: eventsService,
          log,
          clock,
        };
        const instances = [
          alphaServer.instantiate(kernel, {}),
          consumerServer.instantiate(kernel, {}),
        ];
        const collected = collectModuleSubscribers(instances, { sealSecret: SEAL_SECRET });
        const dispatcher = createOutboxDispatcher({
          db: realDb.database.db,
          subscribers: collected.subscribers,
          eventsByName: collected.eventsByName,
          log,
        });

        const rowHeld = gate();
        const releaseRow = gate();

        const holder = realDb.database.db.transaction(async (tx) => {
          await tx.raw(
            `SELECT id FROM sys_outbox WHERE payload->>'resourceId' = 'first-locked' FOR UPDATE`,
          );
          rowHeld.open();
          await releaseRow.reached;
        });
        await rowHeld.reached;

        try {
          const started = Date.now();
          const claimedWhileLocked = await dispatcher.dispatchBatch();
          const elapsedMs = Date.now() - started;

          expect(claimedWhileLocked).toBe(1);
          expect(elapsedMs).toBeLessThan(1_500);

          const jobsWhileLocked = await realDb.database.db.raw<{ resource_id: string }>(
            `SELECT args->'payload'->>'resourceId' AS resource_id FROM sys_jobs`,
          );
          expect(jobsWhileLocked).toEqual([{ resource_id: 'second-free' }]);
        } finally {
          releaseRow.open();
          await holder;
        }

        // Now the previously locked row is free and dispatched on the next batch
        expect(await dispatcher.dispatchBatch()).toBe(1);
        expect(await dispatcher.dispatchBatch()).toBe(0);

        // Resetting `dispatched_at = NULL` to simulate crash-before-commit replay proves sys_jobs deduplication!
        await realDb.database.db.raw(`UPDATE sys_outbox SET dispatched_at = NULL`);
        expect(await dispatcher.dispatchBatch()).toBe(2);

        const allJobs = await realDb.database.db.raw<{ id: string }>(`SELECT id FROM sys_jobs`);
        expect(allJobs).toHaveLength(2);

        // Retention pruning: backdate one row past 7 days and keep the other recent
        await realDb.database.db.raw(
          `UPDATE sys_outbox
            SET dispatched_at = now() - interval '10 days'
          WHERE payload->>'resourceId' = 'first-locked'`,
        );
        const pruned = await dispatcher.pruneDispatched(7 * 24 * 60 * 60 * 1000);
        expect(pruned).toBe(1);

        const remaining = await realDb.database.adminDb.raw<{ resource_id: string }>(
          `SELECT payload->>'resourceId' AS resource_id FROM sys_outbox`,
        );
        expect(remaining).toEqual([{ resource_id: 'second-free' }]);
      },
      TEST_TIMEOUT,
    );
  },
);
