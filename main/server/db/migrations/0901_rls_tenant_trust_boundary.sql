-- 0901_rls_tenant_trust_boundary.sql
-- Harden tenant-scoped RLS so active tenant scope depends on authenticated membership.

-- ============================================================================
-- 1. Session helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

-- Security definer avoids recursive membership RLS checks when policies need to
-- prove that the current user belongs to the active tenant.
CREATE OR REPLACE FUNCTION app_current_user_is_tenant_member(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships
    WHERE tenant_id = _tenant_id
      AND user_id = app_current_user_id()
  );
$$;

-- ============================================================================
-- 2. Replace tenant/member policies with membership-bound checks
-- ============================================================================

DROP POLICY IF EXISTS tenant_access_policy ON tenants;
CREATE POLICY tenant_select_policy ON tenants
FOR SELECT TO authenticated
USING (
  owner_id = app_current_user_id()
  OR app_current_user_is_tenant_member(id)
);

CREATE POLICY tenant_insert_policy ON tenants
FOR INSERT TO authenticated
WITH CHECK (owner_id = app_current_user_id());

CREATE POLICY tenant_update_policy ON tenants
FOR UPDATE TO authenticated
USING (app_current_user_is_tenant_member(id))
WITH CHECK (app_current_user_is_tenant_member(id));

CREATE POLICY tenant_delete_policy ON tenants
FOR DELETE TO authenticated
USING (app_current_user_is_tenant_member(id));

DROP POLICY IF EXISTS membership_isolation_policy ON memberships;

CREATE POLICY membership_select_policy ON memberships
FOR SELECT TO authenticated
USING (
  user_id = app_current_user_id()
  OR (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
  )
);

CREATE POLICY membership_insert_policy ON memberships
FOR INSERT TO authenticated
WITH CHECK (
  user_id = app_current_user_id()
  OR app_current_user_is_tenant_member(tenant_id)
);

CREATE POLICY membership_update_policy ON memberships
FOR UPDATE TO authenticated
USING (app_current_user_is_tenant_member(tenant_id))
WITH CHECK (app_current_user_is_tenant_member(tenant_id));

CREATE POLICY membership_delete_policy ON memberships
FOR DELETE TO authenticated
USING (app_current_user_is_tenant_member(tenant_id));

-- ============================================================================
-- 3. Bind tenant-scoped table policies to verified membership
-- ============================================================================

DROP POLICY IF EXISTS tenant_settings_isolation_policy ON tenant_settings;
CREATE POLICY tenant_settings_isolation_policy ON tenant_settings
FOR ALL TO authenticated
USING (
  tenant_id = app_current_tenant_id()
  AND app_current_user_is_tenant_member(tenant_id)
)
WITH CHECK (
  tenant_id = app_current_tenant_id()
  AND app_current_user_is_tenant_member(tenant_id)
);

DROP POLICY IF EXISTS activity_isolation_policy ON activities;
CREATE POLICY activity_isolation_policy ON activities
FOR ALL TO authenticated
USING (
  tenant_id IS NULL
  OR (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
  )
)
WITH CHECK (
  tenant_id IS NULL
  OR (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
  )
);

DROP POLICY IF EXISTS file_isolation_policy ON files;
CREATE POLICY file_isolation_policy ON files
FOR ALL TO authenticated
USING (
  user_id = app_current_user_id()
  OR (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
  )
)
WITH CHECK (
  user_id = app_current_user_id()
  OR (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
  )
);

-- ============================================================================
-- 4. Force RLS for tenant data tables
-- ============================================================================

ALTER TABLE tenants        FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE activities     FORCE ROW LEVEL SECURITY;
ALTER TABLE files          FORCE ROW LEVEL SECURITY;

-- Do not FORCE memberships while app_current_user_is_tenant_member() is used as
-- the non-recursive membership proof for tenant-scoped policies.
