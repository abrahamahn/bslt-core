-- 0915_job_queue_idempotency_key.sql
--
-- Gives the Postgres queue store somewhere to put the idempotency key it has
-- always been handed and always thrown away.
--
-- `Task.idempotencyKey` is part of the queue contract — queue-types.ts:61 says
-- "duplicate enqueues with the same key are silently skipped" — and
-- `QueueServer.enqueue` propagates it. The memory store honours it (a Set) and
-- the Redis store honours it (SET NX). `PostgresQueueStore.enqueue` INSERTed
-- eight columns, none of them this one, because the column did not exist.
--
-- Production wires the Postgres store (bootstrap/phases/data.ts:94) and the unit
-- tests use the memory store. So an at-most-once job — charge a card, send an
-- email, provision an account — passed every test and double-executed in
-- production, which is the one failure mode idempotency exists to prevent.
--
-- UNIQUE on a nullable column is exactly the semantics wanted: Postgres treats
-- NULLs as distinct, so unlimited un-keyed tasks are still permitted, while two
-- tasks that both carry the same key collide. That is what lets `enqueue` use a
-- single unconditional `ON CONFLICT (idempotency_key) DO NOTHING` for both keyed
-- and un-keyed tasks — for an un-keyed one the conflict can never fire.

ALTER TABLE job_queue
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE job_queue
    DROP CONSTRAINT IF EXISTS job_queue_idempotency_key_unique;

ALTER TABLE job_queue
    ADD CONSTRAINT job_queue_idempotency_key_unique UNIQUE (idempotency_key);

COMMENT ON COLUMN job_queue.idempotency_key IS
  'Optional dedupe key. NULL means "not idempotent"; NULLs are distinct, so un-keyed tasks never collide.';
