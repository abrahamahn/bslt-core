-- 0003_org_scoped_api_keys.sql
-- Forward migration: add optional workspace scoping (soft org_id without a
-- cross-module foreign key so identity stays a root module with dependsOn: [])
-- and explicit permission scopes array to identity_api_keys.

ALTER TABLE identity_api_keys
    ADD COLUMN org_id uuid,
    ADD COLUMN scopes text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX idx_identity_api_keys_org_created
    ON identity_api_keys (org_id, created_at DESC)
    WHERE (org_id IS NOT NULL);
