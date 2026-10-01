-- 0912_events.sql
--
-- Product analytics events — a first-class event pipeline distinct from audit
-- logs. Events arrive through the authenticated ingest endpoint, pass the
-- dispatch layer (sampling + PII redaction) BEFORE insertion, and are drained
-- by the batched warehouse-export hook (exported_at IS NULL scan).
--
-- The table uses native Postgres range partitioning on created_at (monthly).
-- This migration provisions the current and next month plus a DEFAULT
-- partition so inserts never fail; call ensure_events_partition(month) from a
-- scheduled job (see main/server/workers/src/scheduler/) to extend the window.
--
-- Depends on: 0000_users.sql, 0900_rls.sql

CREATE TABLE IF NOT EXISTS events (
    id          UUID NOT NULL DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (char_length(name) > 0 AND char_length(name) <= 100),
    props       JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exported_at TIMESTAMPTZ,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Idempotent helper: creates the monthly partition covering the given date.
CREATE OR REPLACE FUNCTION ensure_events_partition(for_month DATE)
RETURNS void AS $$
DECLARE
    start_date DATE := date_trunc('month', for_month)::date;
    end_date   DATE := (date_trunc('month', for_month) + INTERVAL '1 month')::date;
    partition_name TEXT := 'events_' || to_char(start_date, 'YYYY_MM');
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END;
$$ LANGUAGE plpgsql;

SELECT ensure_events_partition(NOW()::date);
SELECT ensure_events_partition((NOW() + INTERVAL '1 month')::date);

-- Safety net for rows outside provisioned monthly ranges.
CREATE TABLE IF NOT EXISTS events_default PARTITION OF events DEFAULT;

-- Per-user timelines, per-event funnels, and the export drain scan.
CREATE INDEX idx_events_user_created ON events(user_id, created_at DESC);
CREATE INDEX idx_events_name_created ON events(name, created_at DESC);
CREATE INDEX idx_events_unexported ON events(created_at) WHERE exported_at IS NULL;

-- Row-level security: a user may only ever touch their own events.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_owner_isolation_policy ON events;
CREATE POLICY events_owner_isolation_policy ON events
FOR ALL TO authenticated
USING (user_id = current_setting('app.user_id', true)::uuid)
WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
