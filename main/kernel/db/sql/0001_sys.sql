-- 0001_sys.sql
-- Kernel baseline. Applied first, before every owner's file.
--
-- It holds what no single owner can hold: the policy-target roles and what they
-- may do in the schema, the session helpers every policy is written with, the
-- class template every table is classified through, and the kernel's own
-- tables (the job queue and the cron registry). The migration record,
-- sys_migrations, is created by the runner (main/server/db/src/migrate).
--
-- The login roles (bslt_owner, bslt_app, bslt_worker) are created out of band
-- by the role bootstrap (`pnpm bslt db bootstrap-roles`, main/server/db/src/roles.ts);
-- this file, like every migration, runs as the owner. Privileges go to the
-- NOLOGIN policy targets and the login roles get them through membership:
--
--   authenticated  end-user sessions (the client sets the role per transaction)
--   bslt_system    trusted system work; reaches rows only through an explicit
--                  system_access_policy, never BYPASSRLS
--   bslt_definer   what the SECURITY DEFINER helpers read through once a table
--                  is FORCED (the owner is bound by FORCE like everyone else)
--
-- Baselines are edited in place until foundation-v1 (restructure plan 9.3).

-- The session helpers that read `users` and `memberships` are defined here,
-- before identity and orgs create those tables: a SQL function body is resolved
-- when it is first called, as long as it is not checked when it is created.
SET LOCAL check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. Policy-target roles
-- ============================================================================
-- Pre-created by the role bootstrap in production, where the owner has no
-- CREATEROLE; created here for single-superuser dev and CI setups.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bslt_system') THEN
        CREATE ROLE bslt_system NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bslt_definer') THEN
        CREATE ROLE bslt_definer NOLOGIN;
    END IF;
END $$;

-- The helpers below are owned by whoever runs this file and read `memberships`
-- and `users` as that role. A non-superuser owner that is not a member of
-- bslt_definer would see no rows once those tables are FORCED, and every policy
-- built on the helpers would silently deny. A migrator that may join the role
-- (it created it just above, so it holds the admin option) does so here; any
-- other one fails here, with the fix, instead of at the first denied request.
DO $$
BEGIN
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
       OR pg_has_role(current_user, 'bslt_definer', 'USAGE') THEN
        RETURN;
    END IF;

    BEGIN
        EXECUTE format('GRANT bslt_definer TO %I', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    IF NOT pg_has_role(current_user, 'bslt_definer', 'USAGE') THEN
        RAISE EXCEPTION
            'The migrator (%) must be a member of bslt_definer: run the role bootstrap (pnpm db:bootstrap:roles) before migrating',
            current_user;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, bslt_system;

-- ============================================================================
-- 2. No default privileges for runtime roles
-- ============================================================================
-- A table has no runtime grant until its owner's file classifies it. A new
-- database has no default privileges; this removes what an earlier setup of the
-- same database left behind (they survive a schema reset). Entries that belong
-- to a role this migrator cannot act for are removed by the role bootstrap,
-- which runs first.

DO $$
DECLARE
    entry record;
BEGIN
    FOR entry IN
        SELECT DISTINCT
               pg_get_userbyid(d.defaclrole) AS creator,
               CASE WHEN d.defaclnamespace = 0 THEN ''
                    ELSE 'IN SCHEMA ' || d.defaclnamespace::regnamespace::text END AS scope,
               CASE d.defaclobjtype
                   WHEN 'r' THEN 'TABLES'
                   WHEN 'S' THEN 'SEQUENCES'
                   WHEN 'f' THEN 'FUNCTIONS'
                   WHEN 'T' THEN 'TYPES'
                   WHEN 'n' THEN 'SCHEMAS'
               END AS kind,
               g.rolname AS grantee
          FROM pg_default_acl d
         CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
          JOIN pg_roles g ON g.oid = acl.grantee
         WHERE g.rolname IN ('authenticated', 'bslt_system', 'bslt_definer', 'bslt_app', 'bslt_worker')
           AND pg_has_role(d.defaclrole, 'USAGE')
    LOOP
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE ALL ON %s FROM %I',
                       entry.creator, entry.scope, entry.kind, entry.grantee);
    END LOOP;
END $$;

-- ============================================================================
-- 3. Shared trigger function
-- ============================================================================

-- Keeps updated_at current on any table that has the column.
CREATE FUNCTION sys_update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- ============================================================================
-- 4. Session helpers
-- ============================================================================
-- What a policy knows about the caller. The settings are bound per transaction
-- by the database client: app.user_id, the org of the request (app.org_id) and
-- the audience ceiling (app.max_audience).

CREATE FUNCTION sys_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

-- The org the request names. No policy decides on it alone: a header is a
-- claim, and owner_org asks for membership of the ROW's org.
CREATE FUNCTION sys_current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid;
$$;

-- The highest audience rating the session may read on a table that opted in
-- through sys_apply_audience. Unset is 0: fail closed.
CREATE FUNCTION sys_max_audience()
RETURNS smallint
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.max_audience', true), '')::smallint, 0::smallint);
$$;

-- Membership of the given org, read from orgs' `orgs_members`. Security
-- definer, so a policy can ask without recursing into the row security of
-- orgs_members itself; it reads through definer_read_policy (orgs).
CREATE FUNCTION sys_current_user_is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM orgs_members
    WHERE org_id = _org_id
      AND user_id = sys_current_user_id()
  );
$$;

-- Platform admin, decided by identity's `identity_users` + `identity_lockouts`
-- rows of the session user on every statement (through definer_read_policy).
-- app.role is a JWT claim copied at token mint; it outlives a demotion, so no
-- policy may read it.
CREATE FUNCTION sys_current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity_users u
    LEFT JOIN identity_lockouts l ON l.user_id = u.id
    WHERE u.id = sys_current_user_id()
      AND u.role = 'admin'
      AND (l.locked_until IS NULL OR l.locked_until <= now())
      AND u.deactivated_at IS NULL
      AND u.deleted_at IS NULL
  );
$$;

-- ============================================================================
-- 5. The class template and the audience backstop
-- ============================================================================
-- sys_apply_rls(tbl, class, owner_col [, user_ops, admin_ops, system_ops])
--
-- Makes `tbl` say exactly what its class says and nothing else:
--   * drops every policy on the table (the per-table migrations are the single
--     source of truth), except read policies written TO bslt_definer alone,
--     which belong to the helper functions, not to a class;
--   * ENABLE and FORCE row level security;
--   * REVOKE ALL from PUBLIC, authenticated and bslt_system, then grants
--     user_ops + admin_ops to authenticated and system_ops to bslt_system;
--   * one policy per command, rls_user_<cmd> and rls_admin_<cmd>, with an
--     explicit USING and WITH CHECK;
--   * system_access_policy only when system_ops is not empty;
--   * COMMENT ON TABLE ... IS 'rls:<class>'.
--
-- Classes and their user predicate:
--   owner_user   owner_col = sys_current_user_id()
--   owner_org    sys_current_user_is_org_member(owner_col): membership of
--                the ROW's org, never the org the request names alone
--   public_read  true, SELECT only
--   append_only  owner_col = sys_current_user_id(), SELECT and INSERT only;
--                nobody updates or deletes through authenticated
--   system       no user command
--   custom       no user policy is created: the calling migration writes them
--
-- Admin policies use sys_current_user_is_platform_admin() as a scalar subquery,
-- so it is evaluated once per statement, not once per row.
--
-- Commands are the lower-case words select, insert, update, delete. An UPDATE
-- or DELETE must be able to see the row it changes, so each list that names one
-- must also name select.
--
-- A command list that is left out (NULL) is the list of the class; an explicit
-- list, empty included, replaces it:
--
--   class        user                            admin  system
--   owner_user   select, insert, update, delete  -      -
--   owner_org    select, insert, update, delete  -      -
--   public_read  select                          -      -
--   append_only  select, insert                  -      -
--   system       -                               -      select, insert, update, delete
--   custom       -                               -      -

CREATE FUNCTION sys_apply_rls(
    tbl regclass,
    class text,
    owner_col name DEFAULT NULL,
    user_ops text[] DEFAULT NULL,
    admin_ops text[] DEFAULT NULL,
    system_ops text[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    known_ops CONSTANT text[] := ARRAY['select', 'insert', 'update', 'delete'];
    append_ops CONSTANT text[] := ARRAY['select', 'insert'];
    admin_predicate CONSTANT text := '(SELECT sys_current_user_is_platform_admin())';
    u_ops text[] := COALESCE(user_ops, CASE class
        WHEN 'owner_user' THEN known_ops
        WHEN 'owner_org' THEN known_ops
        WHEN 'public_read' THEN ARRAY['select']
        WHEN 'append_only' THEN append_ops
        ELSE ARRAY[]::text[]
    END);
    a_ops text[] := COALESCE(admin_ops, ARRAY[]::text[]);
    s_ops text[] := COALESCE(system_ops, CASE class
        WHEN 'system' THEN known_ops
        ELSE ARRAY[]::text[]
    END);
    granted text[];
    user_predicate text;
    op text;
    listed record;
    stale record;
BEGIN
    IF class IS NULL OR class NOT IN
       ('owner_user', 'owner_org', 'public_read', 'append_only', 'system', 'custom') THEN
        RAISE EXCEPTION 'sys_apply_rls(%): unknown class "%"', tbl, class;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.oid = tbl AND c.relkind IN ('r', 'p') AND NOT c.relispartition) THEN
        RAISE EXCEPTION
            'sys_apply_rls(%): not a table, or a partition (partitions are reached through their parent)',
            tbl;
    END IF;

    FOR listed IN
        SELECT * FROM (VALUES ('user', u_ops), ('admin', a_ops), ('system', s_ops)) AS l(kind, ops)
    LOOP
        FOREACH op IN ARRAY listed.ops LOOP
            IF op IS NULL OR NOT (op = ANY (known_ops)) THEN
                RAISE EXCEPTION 'sys_apply_rls(%): unknown command "%" in % commands', tbl, op, listed.kind;
            END IF;
        END LOOP;
        -- custom: the hand-written user policies decide what a user can see.
        IF (listed.ops && ARRAY['update', 'delete'])
           AND NOT ('select' = ANY (listed.ops))
           AND NOT (class = 'custom' AND listed.kind = 'user') THEN
            RAISE EXCEPTION
                'sys_apply_rls(%): update or delete in % commands needs select (the row must be visible to be changed)',
                tbl, listed.kind;
        END IF;
    END LOOP;

    IF class IN ('owner_user', 'owner_org', 'append_only') THEN
        IF owner_col IS NULL THEN
            RAISE EXCEPTION 'sys_apply_rls(%): class % needs an owner column', tbl, class;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = tbl AND a.attname = owner_col
                          AND a.attnum > 0 AND NOT a.attisdropped) THEN
            RAISE EXCEPTION 'sys_apply_rls(%): no column "%"', tbl, owner_col;
        END IF;
    ELSIF class IN ('public_read', 'system') AND owner_col IS NOT NULL THEN
        RAISE EXCEPTION 'sys_apply_rls(%): class % takes no owner column', tbl, class;
    END IF;

    IF class = 'public_read' AND NOT (u_ops <@ ARRAY['select']) THEN
        RAISE EXCEPTION 'sys_apply_rls(%): public_read allows users only select', tbl;
    END IF;
    IF class = 'system' AND cardinality(u_ops) > 0 THEN
        RAISE EXCEPTION 'sys_apply_rls(%): system allows no user command', tbl;
    END IF;
    IF class = 'append_only' AND NOT (u_ops <@ append_ops AND a_ops <@ append_ops) THEN
        RAISE EXCEPTION
            'sys_apply_rls(%): append_only allows only select and insert through authenticated', tbl;
    END IF;

    user_predicate := CASE class
        WHEN 'owner_user' THEN format('%I = sys_current_user_id()', owner_col)
        WHEN 'append_only' THEN format('%I = sys_current_user_id()', owner_col)
        WHEN 'owner_org' THEN format('sys_current_user_is_org_member(%I)', owner_col)
        WHEN 'public_read' THEN 'true'
    END;

    -- Single source of truth: nothing an earlier migration wrote survives,
    -- except what the SECURITY DEFINER helpers read through. Only a SELECT
    -- policy written to bslt_definer alone qualifies: any other command would
    -- let the owner write past FORCE.
    FOR stale IN
        SELECT p.polname
          FROM pg_policy p
         WHERE p.polrelid = tbl
           AND NOT (p.polcmd = 'r' AND p.polroles = ARRAY['bslt_definer'::regrole::oid])
    LOOP
        EXECUTE format('DROP POLICY %I ON %s', stale.polname, tbl);
    END LOOP;

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, authenticated, bslt_system', tbl);
    SELECT array_agg(DISTINCT upper(o)) INTO granted FROM unnest(u_ops || a_ops) AS o;
    IF granted IS NOT NULL THEN
        EXECUTE format('GRANT %s ON TABLE %s TO authenticated', array_to_string(granted, ', '), tbl);
    END IF;
    SELECT array_agg(DISTINCT upper(o)) INTO granted FROM unnest(s_ops) AS o;
    IF granted IS NOT NULL THEN
        EXECUTE format('GRANT %s ON TABLE %s TO bslt_system', array_to_string(granted, ', '), tbl);
        EXECUTE format(
            'CREATE POLICY system_access_policy ON %s FOR ALL TO bslt_system USING (true) WITH CHECK (true)',
            tbl);
    END IF;

    FOR listed IN
        SELECT * FROM (VALUES ('user', u_ops, user_predicate), ('admin', a_ops, admin_predicate))
                   AS l(kind, ops, predicate)
    LOOP
        CONTINUE WHEN listed.predicate IS NULL;
        FOR op IN SELECT DISTINCT o FROM unnest(listed.ops) AS o LOOP
            EXECUTE format(
                'CREATE POLICY %I ON %s FOR %s TO authenticated %s',
                'rls_' || listed.kind || '_' || op,
                tbl,
                upper(op),
                CASE op
                    WHEN 'select' THEN format('USING (%s)', listed.predicate)
                    WHEN 'delete' THEN format('USING (%s)', listed.predicate)
                    WHEN 'insert' THEN format('WITH CHECK (%s)', listed.predicate)
                    WHEN 'update' THEN format('USING (%s) WITH CHECK (%s)',
                                              listed.predicate, listed.predicate)
                END);
        END LOOP;
    END LOOP;

    EXECUTE format('COMMENT ON TABLE %s IS %L', tbl, 'rls:' || class);
END;
$$;

-- sys_apply_audience(tbl, col, owner_col)
--
-- Opt-in audience backstop, without a taxonomy: `col` is a smallint rating and
-- what a number means is the fork's business. One RESTRICTIVE policy on top of
-- the class: a row is visible to its owner, and to anyone else only when it is
-- rated and the rating is within the session's ceiling,
--
--   owner_col = sys_current_user_id()
--   OR (col IS NOT NULL AND col <= sys_max_audience())
--
-- An unrated row (NULL) is invisible to everyone but its owner, and a session
-- without a ceiling has ceiling 0: both fail closed. The policy names no role,
-- so it binds every role that reaches the table, the system role included; a
-- job that must read past it sets app.max_audience itself.
--
-- sys_apply_rls drops every policy it did not write: call this after it.
CREATE FUNCTION sys_apply_audience(tbl regclass, col name, owner_col name)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    named name;
    col_type regtype;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c
                    WHERE c.oid = tbl AND c.relkind IN ('r', 'p') AND NOT c.relispartition
                      AND c.relrowsecurity AND c.relforcerowsecurity) THEN
        RAISE EXCEPTION
            'sys_apply_audience(%): classify the table with sys_apply_rls first', tbl;
    END IF;
    IF col IS NULL OR owner_col IS NULL THEN
        RAISE EXCEPTION 'sys_apply_audience(%): needs an audience column and an owner column', tbl;
    END IF;
    FOREACH named IN ARRAY ARRAY[col, owner_col] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                        WHERE a.attrelid = tbl AND a.attname = named
                          AND a.attnum > 0 AND NOT a.attisdropped) THEN
            RAISE EXCEPTION 'sys_apply_audience(%): no column "%"', tbl, named;
        END IF;
    END LOOP;
    SELECT a.atttypid::regtype INTO col_type
      FROM pg_attribute a WHERE a.attrelid = tbl AND a.attname = col;
    IF col_type <> 'smallint'::regtype THEN
        RAISE EXCEPTION 'sys_apply_audience(%): column "%" must be smallint, not %', tbl, col, col_type;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = tbl AND p.polname = 'rls_audience') THEN
        EXECUTE format('DROP POLICY rls_audience ON %s', tbl);
    END IF;
    EXECUTE format(
        'CREATE POLICY rls_audience ON %s AS RESTRICTIVE FOR SELECT '
        'USING (%I = sys_current_user_id() OR (%I IS NOT NULL AND %I <= sys_max_audience()))',
        tbl, owner_col, col, col);
END;
$$;

-- Functions are executable by PUBLIC unless revoked.
REVOKE EXECUTE ON FUNCTION sys_current_user_is_platform_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sys_apply_rls(regclass, text, name, text[], text[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sys_apply_audience(regclass, name, name) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION sys_current_user_is_platform_admin() TO authenticated, bslt_system;
-- sys_apply_rls, sys_apply_audience: the owner alone (migrations).

-- ============================================================================
-- 6. Transactional outbox, job queue and cron registry
-- ============================================================================

-- Transactional event outbox (main/kernel/server/src/module/outbox.ts).
-- Events are inserted inside the domain write transaction (`k.events.publish`),
-- so a rolled-back transaction leaves zero rows and emits zero NOTIFY frames.
-- `sealed` holds AES-256-GCM ciphertext of secret fields (`sealed(schema)`),
-- while `payload` stores `[REDACTED]` in their place.
CREATE TABLE sys_outbox (
    id            bigserial   NOT NULL,
    name          text        NOT NULL,
    version       integer     NOT NULL,
    payload       jsonb       NOT NULL,
    sealed        bytea,
    actor_user_id uuid,
    org_id        uuid,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    dispatched_at timestamptz,
    CONSTRAINT sys_outbox_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_sys_outbox_undispatched
    ON sys_outbox (dispatched_at, id ASC)
    WHERE (dispatched_at IS NULL);

GRANT USAGE, SELECT ON SEQUENCE sys_outbox_id_seq TO authenticated, bslt_system;

-- Authenticated sessions publish only as themselves (for orgs they belong to,
-- or as a DB-verified platform admin); users never read, update or delete outbox
-- rows. The dispatcher claims, updates and prunes rows on the system role.
SELECT sys_apply_rls(
    'sys_outbox', 'custom', NULL,
    ARRAY['insert'],
    ARRAY['select'],
    ARRAY['select', 'insert', 'update', 'delete']
);

CREATE POLICY rls_user_insert ON sys_outbox
FOR INSERT TO authenticated
WITH CHECK (
    actor_user_id = sys_current_user_id()
    AND (
        org_id IS NULL
        OR sys_current_user_is_org_member(org_id)
        OR (SELECT sys_current_user_is_platform_admin())
    )
);

CREATE FUNCTION sys_notify_outbox()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM pg_notify('bslt_outbox', '');
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION sys_notify_outbox() FROM PUBLIC;

CREATE TRIGGER sys_outbox_notify
    AFTER INSERT ON sys_outbox
    FOR EACH ROW
    EXECUTE FUNCTION sys_notify_outbox();

-- The Postgres queue store (main/kernel/db/src/queue/postgres-store.ts).
-- idempotency_key: UNIQUE on (name, idempotency_key) with a nullable column.
-- NULLs are distinct, so un-keyed tasks never collide, while two tasks of the
-- same job name and key do; `enqueue` uses ON CONFLICT (name, idempotency_key) DO NOTHING.
CREATE TABLE sys_jobs (
    id                 text        NOT NULL,
    name               text        NOT NULL,
    queue              text        NOT NULL DEFAULT 'default'::text,
    priority           integer     NOT NULL DEFAULT 0,
    args               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    scheduled_at       timestamptz NOT NULL DEFAULT now(),
    attempts           integer     NOT NULL DEFAULT 0,
    max_attempts       integer     NOT NULL DEFAULT 3,
    created_at         timestamptz NOT NULL DEFAULT now(),
    status             text        NOT NULL DEFAULT 'pending'::text,
    error              jsonb,
    last_error         text,
    dead_at            timestamptz,
    completed_at       timestamptz,
    duration_ms        integer,
    dead_letter_reason text,
    idempotency_key    text,
    CONSTRAINT sys_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT sys_jobs_idempotency_key_unique UNIQUE (name, idempotency_key)
);

CREATE INDEX idx_sys_jobs_status_scheduled
    ON sys_jobs (queue, status, priority DESC, scheduled_at ASC)
    WHERE (status = 'pending'::text);

COMMENT ON COLUMN sys_jobs.idempotency_key IS
  'Optional per-job dedupe key. NULL means "not idempotent"; NULLs are distinct, so un-keyed tasks never collide.';

-- The admin jobs screen lists, retries and cancels; the queue store, its
-- cleanup and the status probe run on the system role.
SELECT sys_apply_rls(
    'sys_jobs', 'system', NULL,
    ARRAY[]::text[],
    ARRAY['select', 'update'],
    ARRAY['select', 'insert', 'update', 'delete']
);

-- Durable state of the leader-elected cron scheduler
-- (main/server/workers/src/scheduler/), one row per registered cron job.
-- next_run_at drives dispatch; last_run_at records the most recent occurrence
-- handed to the job queue, so runs missed while every replica was down can be
-- replayed.
CREATE TABLE sys_cron (
    name        text        NOT NULL,
    expression  text        NOT NULL,
    catch_up    boolean     NOT NULL DEFAULT false,
    enabled     boolean     NOT NULL DEFAULT true,
    last_run_at timestamptz,
    next_run_at timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sys_cron_pkey PRIMARY KEY (name)
);

CREATE INDEX idx_sys_cron_due ON sys_cron (next_run_at) WHERE (enabled = true);

-- The scheduler seeds and claims its rows (SELECT ... FOR UPDATE).
SELECT sys_apply_rls(
    'sys_cron', 'system', NULL,
    ARRAY[]::text[],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update']
);
