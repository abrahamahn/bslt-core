-- 0909_api_keys.sql
--
-- User-owned API keys for programmatic, service-to-service access.
-- Keys are stored only as a SHA-256 hash; the plaintext is shown to the user
-- exactly once at creation. `key_prefix`/`last4` exist purely for display.
--
-- Depends on: 0000_users.sql, 0900_rls.sql

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 100),
    token_hash   TEXT NOT NULL UNIQUE,
    key_prefix   TEXT NOT NULL,
    last4        TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Lookup by hash on every API-key authenticated request: must be fast and unique.
CREATE UNIQUE INDEX idx_api_keys_token_hash ON api_keys(token_hash);
CREATE INDEX idx_api_keys_owner_created ON api_keys(user_id, created_at DESC);

-- Row-level security: a user may only ever see or mutate their own keys.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_key_owner_isolation_policy ON api_keys;
CREATE POLICY api_key_owner_isolation_policy ON api_keys
FOR ALL TO authenticated
USING (user_id = current_setting('app.user_id', true)::uuid)
WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
