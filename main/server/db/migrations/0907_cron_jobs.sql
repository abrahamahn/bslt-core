-- 0907_cron_jobs.sql
--
-- Cron registry: durable state for the leader-elected cron scheduler
-- (main/server/workers/src/scheduler/). One row per registered cron job.
--
-- next_run_at drives dispatch; last_run_at records the most recent
-- occurrence handed to the job queue, enabling catch-up replay of runs
-- missed while every replica was down. The scheduler is single-writer
-- (advisory-lock leader), so no per-row locking is needed.
--
-- Depends on: nothing

CREATE TABLE IF NOT EXISTS cron_jobs (
    name         TEXT PRIMARY KEY,
    expression   TEXT NOT NULL,
    catch_up     BOOLEAN NOT NULL DEFAULT false,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    last_run_at  TIMESTAMPTZ,
    next_run_at  TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The scheduler scans for due jobs: enabled AND next_run_at <= now.
CREATE INDEX IF NOT EXISTS idx_cron_jobs_due
    ON cron_jobs (next_run_at)
    WHERE enabled = true;
