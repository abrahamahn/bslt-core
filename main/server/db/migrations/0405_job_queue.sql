-- 0405_job_queue.sql
--
-- Job queue: PG-backed task queue consumed by PostgresQueueStore
-- (main/server/db/src/queue/postgres-store.ts).
--
-- This table previously existed only in the dev schema push; any database
-- built purely from migrations was missing it and the queue failed at runtime.
--
-- Depends on: nothing

-- ============================================================================
-- Job Queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_queue (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    args               JSONB NOT NULL DEFAULT '{}'::jsonb,
    scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts           INTEGER NOT NULL DEFAULT 0,
    max_attempts       INTEGER NOT NULL DEFAULT 3,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    status             TEXT NOT NULL DEFAULT 'pending',
    error              JSONB,
    completed_at       TIMESTAMPTZ,
    duration_ms        INTEGER,
    dead_letter_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_scheduled
    ON job_queue(status, scheduled_at)
    WHERE status = 'pending';
