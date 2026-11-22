// tests/integration/database/queue-claim.real-db.test.ts
/**
 * The queue's claim query, and the row-lock options of the select builder (Real DB)
 *
 * `PostgresQueueStore.dequeue` claims the next due job with one statement built
 * by the query builder: an UPDATE whose row comes from `SELECT ... FOR UPDATE
 * SKIP LOCKED`. Whether two workers can take the same job, and whether a claim
 * waits behind a row another worker holds, is decided by Postgres' row locks:
 * a mock store shows neither.
 *
 * Runs as the worker role (`bslt_worker`), as the queue does.
 *
 * Requires a reachable Postgres; mandatory in CI via REQUIRE_REAL_DB.
 */

import { eq, PostgresQueueStore, select, type RawDb, type Task } from '@bslt/db';
import { describeRealDb } from '@bslt/testing/real-db';
import { beforeEach, expect, it } from 'vitest';

const TEST_TIMEOUT = 60_000;

const LOCK_NOT_AVAILABLE = '55P03';

/** A claim that had to wait for the other transaction would take this long. */
const HOLD_MS = 1_500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A promise and the function that settles it: one step of a two-connection script. */
function gate(): { readonly reached: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
}

describeRealDb('Queue claim and row-lock options of the select builder (Real DB)', (realDb) => {
  const NOW = '2030-01-01T00:00:00.000Z';

  /** `count` pending jobs, due one second apart: job-00 is the oldest. */
  const enqueueJobs = async (db: RawDb, count: number): Promise<string[]> => {
    const store = new PostgresQueueStore(db);
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const id = `job-${String(index).padStart(2, '0')}`;
      const task: Task = {
        id,
        name: 'claim-test',
        args: { index },
        scheduledAt: new Date(Date.UTC(2029, 0, 1, 0, 0, index)).toISOString(),
        attempts: 0,
        maxAttempts: 3,
        createdAt: '2029-01-01T00:00:00.000Z',
      };
      await store.enqueue(task);
      ids.push(id);
    }
    return ids;
  };

  const statuses = async (db: RawDb): Promise<Record<string, string>> => {
    const rows = await db.raw<{ id: string; status: string; attempts: number }>(
      'SELECT id, status, attempts FROM sys_jobs ORDER BY id',
    );
    return Object.fromEntries(rows.map((row) => [row.id, `${row.status}/${String(row.attempts)}`]));
  };

  beforeEach(async () => {
    await realDb.database.ownerDb.raw('TRUNCATE sys_jobs');
  });

  it(
    'claims the oldest due job, counts the attempt, and leaves the rest',
    async () => {
      const db = realDb.database.db;
      await enqueueJobs(db, 3);
      const store = new PostgresQueueStore(db);

      const claimed = await store.dequeue(NOW);

      expect(claimed).toMatchObject({ id: 'job-00', name: 'claim-test', attempts: 1 });
      expect(await statuses(db)).toEqual({
        'job-00': 'processing/1',
        'job-01': 'pending/0',
        'job-02': 'pending/0',
      });
      // Nothing is due before the first job's time.
      expect(await store.dequeue('2028-12-31T00:00:00.000Z')).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'a claimed job carries the arguments it was enqueued with, as values and not as JSON text',
    async () => {
      const db = realDb.database.db;
      const store = new PostgresQueueStore(db);
      const cases: unknown[] = [
        { to: 'a@example.com', nested: { retries: 2 }, tags: ['x', 'y'] },
        ['a', 1, null],
        'a plain string',
        42,
        null,
      ];
      for (const [index, args] of cases.entries()) {
        await store.enqueue({
          id: `args-${String(index)}`,
          name: 'args-test',
          args,
          scheduledAt: new Date(Date.UTC(2029, 0, 1, 0, 0, index)).toISOString(),
          attempts: 0,
          maxAttempts: 3,
          createdAt: '2029-01-01T00:00:00.000Z',
        });
      }

      const claimed: unknown[] = [];
      for (let index = 0; index < cases.length; index++) {
        claimed.push((await store.dequeue(NOW))?.args);
      }

      // What a handler is called with.
      expect(claimed).toEqual(cases);
      // And what is stored is JSON of that shape, so SQL can read into it.
      expect(
        await db.raw(
          `SELECT id, jsonb_typeof(args) AS kind FROM sys_jobs WHERE name = 'args-test' ORDER BY id`,
        ),
      ).toEqual([
        { id: 'args-0', kind: 'object' },
        { id: 'args-1', kind: 'array' },
        { id: 'args-2', kind: 'string' },
        { id: 'args-3', kind: 'number' },
        { id: 'args-4', kind: 'null' },
      ]);
      expect((await store.getJobDetails('args-0'))?.args).toEqual(cases[0]);
    },
    TEST_TIMEOUT,
  );

  it(
    'concurrent workers each claim a different job: none is taken twice',
    async () => {
      const db = realDb.database.db;
      const ids = await enqueueJobs(db, 24);
      const store = new PostgresQueueStore(db);

      const worker = async (): Promise<string[]> => {
        const taken: string[] = [];
        for (;;) {
          const task = await store.dequeue(NOW);
          if (task === null) return taken;
          taken.push(task.id);
        }
      };
      const perWorker = await Promise.all([worker(), worker(), worker(), worker(), worker()]);

      const all = perWorker.flat();
      expect(all).toHaveLength(ids.length);
      expect([...all].sort()).toEqual(ids);
      expect(new Set(Object.values(await statuses(db)))).toEqual(new Set(['processing/1']));
    },
    TEST_TIMEOUT,
  );

  it(
    'a claim passes over a job another transaction holds and takes the next, without waiting',
    async () => {
      const db = realDb.database.db;
      await enqueueJobs(db, 3);
      const firstHoldsItsJob = gate();
      const release = gate();
      let heldId: string | undefined;

      // The first worker claims inside a transaction and keeps it open: its
      // job's row stays locked, and its UPDATE stays invisible to others.
      const holder = db.transaction(async (tx) => {
        heldId = (await new PostgresQueueStore(tx).dequeue(NOW))?.id;
        firstHoldsItsJob.open();
        await release.reached;
        throw new Error('roll the first claim back');
      });

      await firstHoldsItsJob.reached;
      const started = Date.now();
      const second = await new PostgresQueueStore(db).dequeue(NOW);
      const waitedMs = Date.now() - started;
      await sleep(50);
      release.open();
      await expect(holder).rejects.toThrow('roll the first claim back');

      expect(heldId).toBe('job-00');
      // Without SKIP LOCKED the second claim would wait for the first
      // transaction and then find its row gone from the pending set.
      expect(second?.id).toBe('job-01');
      expect(waitedMs).toBeLessThan(HOLD_MS);
      // The first claim was rolled back: its job is pending again and is next.
      expect(await statuses(db)).toEqual({
        'job-00': 'pending/0',
        'job-01': 'processing/1',
        'job-02': 'pending/0',
      });
      expect((await new PostgresQueueStore(db).dequeue(NOW))?.id).toBe('job-00');
    },
    TEST_TIMEOUT,
  );

  it(
    'forUpdate().skipLocked() returns only free rows, and noWait() fails at once on a held one',
    async () => {
      const db = realDb.database.db;
      await enqueueJobs(db, 2);
      const rowIsHeld = gate();
      const release = gate();

      const holder = db.transaction(async (tx) => {
        await tx.query(
          select('sys_jobs').columns('id').where(eq('id', 'job-00')).forUpdate().toSql(),
        );
        rowIsHeld.open();
        await release.reached;
      });
      await rowIsHeld.reached;

      const lockAll = (): ReturnType<typeof select> =>
        select('sys_jobs').columns('id').orderBy('id').forUpdate();
      try {
        const free = await db.transaction((tx) =>
          tx.query<{ id: string }>(lockAll().skipLocked().toSql()),
        );
        const started = Date.now();
        const refused = await db
          .transaction((tx) => tx.query(lockAll().noWait().toSql()))
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        const waitedMs = Date.now() - started;

        expect(free).toEqual([{ id: 'job-01' }]);
        expect((refused as { code?: string } | undefined)?.code).toBe(LOCK_NOT_AVAILABLE);
        expect(waitedMs).toBeLessThan(HOLD_MS);
      } finally {
        release.open();
        await holder;
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'deduplicates (name, idempotency_key) while allowing the same key on distinct job names',
    async () => {
      const db = realDb.database.db;
      const store = new PostgresQueueStore(db);

      await store.enqueue({
        id: 'dedupe-1',
        name: 'webhooks.deliver',
        args: { seq: 1 },
        scheduledAt: '2029-01-01T00:00:00.000Z',
        attempts: 0,
        maxAttempts: 3,
        createdAt: '2029-01-01T00:00:00.000Z',
        idempotencyKey: 'evt-42',
      });

      // Duplicate (name, idempotency_key) — silently skipped
      await store.enqueue({
        id: 'dedupe-2',
        name: 'webhooks.deliver',
        args: { seq: 2 },
        scheduledAt: '2029-01-01T00:00:01.000Z',
        attempts: 0,
        maxAttempts: 3,
        createdAt: '2029-01-01T00:00:01.000Z',
        idempotencyKey: 'evt-42',
      });

      // Same idempotency_key on a different job name — inserted!
      await store.enqueue({
        id: 'dedupe-3',
        name: 'audit.record',
        args: { seq: 3 },
        scheduledAt: '2029-01-01T00:00:02.000Z',
        attempts: 0,
        maxAttempts: 3,
        createdAt: '2029-01-01T00:00:02.000Z',
        idempotencyKey: 'evt-42',
      });

      const rows = await db.raw<{ id: string; name: string }>(
        'SELECT id, name FROM sys_jobs ORDER BY id',
      );
      expect(rows).toEqual([
        { id: 'dedupe-1', name: 'webhooks.deliver' },
        { id: 'dedupe-3', name: 'audit.record' },
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'orders claims by priority DESC then scheduled_at ASC, isolates queues, and transitions exhausted jobs to dead',
    async () => {
      const db = realDb.database.db;
      const store = new PostgresQueueStore(db);

      await store.enqueue({
        id: 'prio-low',
        name: 'work.low',
        queue: 'default',
        priority: 0,
        args: {},
        scheduledAt: '2029-01-01T00:00:00.000Z',
        attempts: 0,
        maxAttempts: 1,
        createdAt: '2029-01-01T00:00:00.000Z',
      });
      await store.enqueue({
        id: 'prio-high',
        name: 'work.high',
        queue: 'default',
        priority: 20,
        args: {},
        scheduledAt: '2029-01-01T00:00:10.000Z',
        attempts: 0,
        maxAttempts: 1,
        createdAt: '2029-01-01T00:00:00.000Z',
      });
      await store.enqueue({
        id: 'media-only',
        name: 'files.transcode',
        queue: 'media',
        priority: 100,
        args: {},
        scheduledAt: '2029-01-01T00:00:00.000Z',
        attempts: 0,
        maxAttempts: 1,
        createdAt: '2029-01-01T00:00:00.000Z',
      });

      const firstDefault = await store.dequeue(NOW, 'default');
      expect(firstDefault?.id).toBe('prio-high');
      expect(firstDefault?.priority).toBe(20);
      expect(firstDefault?.queue).toBe('default');

      const secondDefault = await store.dequeue(NOW, 'default');
      expect(secondDefault?.id).toBe('prio-low');
      expect(await store.dequeue(NOW, 'default')).toBeNull();

      // Media job untouched by default worker, claimed by media worker
      const mediaClaim = await store.dequeue(NOW, 'media');
      expect(mediaClaim?.id).toBe('media-only');

      // Permanent failure transitions to dead with dead_at and last_error
      await store.fail('prio-high', { name: 'BoomError', message: 'Permanent failure' });
      const [deadRow] = await db.raw<{
        status: string;
        last_error: string | null;
        dead_at: Date | null;
      }>('SELECT status, last_error, dead_at FROM sys_jobs WHERE id = $1', ['prio-high']);
      expect(deadRow?.status).toBe('dead');
      expect(deadRow?.last_error).toBe('BoomError: Permanent failure');
      expect(deadRow?.dead_at).not.toBeNull();
      expect(await store.getDeadCount()).toBe(1);
    },
    TEST_TIMEOUT,
  );
});
