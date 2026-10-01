-- 0800_tasks.sql
--
-- Starter product feature: user-owned tasks.
--
-- Depends on: 0000_users.sql

CREATE TABLE IF NOT EXISTS tasks (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 120),
    completed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

CREATE INDEX idx_tasks_owner_created ON tasks(owner_id, created_at DESC);
CREATE INDEX idx_tasks_owner_open ON tasks(owner_id, created_at DESC)
    WHERE completed = FALSE;
