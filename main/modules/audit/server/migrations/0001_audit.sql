-- 0001_audit.sql
-- Owned DDL baseline of the audit projection module (`@bslt/audit`).
--
-- Depends on: kernel (projection module; no FK to users or orgs per rule M2).
--
-- Merges legacy `audit_events`, `security_events`, and `activities` into:
--   * `audit_log`      (append_only + immutability trigger; REVOKE UPDATE/DELETE)
--   * `audit_activity` (custom RLS: own actor rows and member-org timeline rows)
--
-- Commands per role (sys_apply_rls: user, admin, system):
--
--   table           class        user            admin   system
--   audit_log       append_only  select (own)    select  select, insert
--   audit_activity  custom       select (below)  -       select, insert, delete

CREATE TABLE audit_log (
    id              uuid        NOT NULL DEFAULT uuid_generate_v4(),
    org_id          uuid,
    actor_id        uuid,
    subject_email   text,
    action          text        NOT NULL,
    category        text        NOT NULL,
    severity        text        NOT NULL DEFAULT 'info'::text,
    resource        text        NOT NULL,
    resource_id     text,
    metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ip_address      text,
    user_agent      text,
    idempotency_key text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT audit_log_action_format CHECK ((action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text)),
    CONSTRAINT audit_log_category_check CHECK ((category = ANY (ARRAY['security'::text, 'data'::text, 'billing'::text, 'trust_safety'::text, 'compliance'::text, 'admin'::text, 'kyc_access'::text, 'system'::text]))),
    CONSTRAINT audit_log_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text, 'critical'::text]))),
    CONSTRAINT audit_log_resource_check CHECK ((char_length(resource) > 0))
);

CREATE INDEX idx_audit_log_action ON audit_log (action, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);
CREATE INDEX idx_audit_log_category ON audit_log (category, created_at DESC);
CREATE INDEX idx_audit_log_org ON audit_log (org_id, created_at DESC) WHERE (org_id IS NOT NULL);
CREATE INDEX idx_audit_log_resource ON audit_log (resource, resource_id);
CREATE INDEX idx_audit_log_severity ON audit_log (severity, created_at DESC) WHERE (severity = ANY (ARRAY['error'::text, 'critical'::text]));
CREATE UNIQUE INDEX idx_audit_log_idempotency ON audit_log (idempotency_key) WHERE (idempotency_key IS NOT NULL);

SELECT sys_apply_rls(
    'audit_log', 'append_only', 'actor_id',
    ARRAY['select'],
    ARRAY['select'],
    ARRAY['select', 'insert']
);

CREATE FUNCTION audit_prevent_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is forbidden', TG_OP;
END;
$$;

REVOKE EXECUTE ON FUNCTION audit_prevent_log_mutation() FROM PUBLIC;

CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_prevent_log_mutation();

-- ============================================================================
-- User-visible activity timeline (`audit_activity`)
-- ============================================================================

CREATE TABLE audit_activity (
    id              uuid        NOT NULL DEFAULT uuid_generate_v4(),
    org_id          uuid,
    actor_id        uuid,
    actor_type      text        NOT NULL DEFAULT 'user'::text,
    action          text        NOT NULL,
    resource_type   text        NOT NULL,
    resource_id     text        NOT NULL,
    description     text,
    metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ip_address      text,
    idempotency_key text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_activity_pkey PRIMARY KEY (id),
    CONSTRAINT audit_activity_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT audit_activity_action_check CHECK ((char_length(action) > 0)),
    CONSTRAINT audit_activity_resource_type_check CHECK ((char_length(resource_type) > 0)),
    CONSTRAINT audit_activity_resource_id_check CHECK ((char_length(resource_id) > 0))
);

CREATE INDEX idx_audit_activity_action ON audit_activity (action, created_at DESC);
CREATE INDEX idx_audit_activity_actor ON audit_activity (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);
CREATE INDEX idx_audit_activity_org ON audit_activity (org_id, created_at DESC) WHERE (org_id IS NOT NULL);
CREATE INDEX idx_audit_activity_resource ON audit_activity (resource_type, resource_id, created_at DESC);
CREATE UNIQUE INDEX idx_audit_activity_idempotency ON audit_activity (idempotency_key) WHERE (idempotency_key IS NOT NULL);

SELECT sys_apply_rls(
    'audit_activity', 'custom', NULL,
    ARRAY['select'],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'delete']
);

CREATE POLICY rls_user_select ON audit_activity
FOR SELECT TO authenticated
USING (
    actor_id = sys_current_user_id()
    OR (org_id IS NOT NULL AND sys_current_user_is_org_member(org_id))
);
