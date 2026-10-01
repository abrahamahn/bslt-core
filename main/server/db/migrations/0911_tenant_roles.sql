-- 0911_tenant_roles.sql
--
-- Advanced RBAC: custom tenant roles with permission bitmasks.
--
-- Custom roles REFINE (narrow) a member's built-in role grants; the built-in
-- `memberships.role` column stays authoritative for Owner/Admin/Member/Viewer
-- semantics. Built-in role names are reserved (enforced here and in service).
-- Depends on: 0100_tenants.sql, 0901_rls_tenant_trust_boundary.sql

-- ============================================================================
-- Tenant Roles (custom role definitions per tenant)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    permissions BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenant_roles_name_unique UNIQUE (tenant_id, name),
    CONSTRAINT tenant_roles_name_length CHECK (char_length(name) BETWEEN 1 AND 50),
    -- Built-in roles are immutable and cannot be shadowed by custom roles
    CONSTRAINT tenant_roles_name_not_builtin
        CHECK (lower(name) NOT IN ('owner', 'admin', 'member', 'viewer')),
    CONSTRAINT tenant_roles_permissions_non_negative CHECK (permissions >= 0)
);

CREATE TRIGGER update_tenant_roles_updated_at
    BEFORE UPDATE ON tenant_roles
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

CREATE INDEX idx_tenant_roles_tenant ON tenant_roles(tenant_id);

-- ============================================================================
-- Membership refinement pointer
-- ============================================================================

-- A custom role narrows the member's built-in grants. Deleting a custom role
-- automatically unassigns it (SET NULL) so members fall back to their
-- built-in role's full base permissions.
ALTER TABLE memberships
    ADD COLUMN custom_role_id UUID REFERENCES tenant_roles(id) ON DELETE SET NULL;

CREATE INDEX idx_memberships_custom_role ON memberships(custom_role_id)
    WHERE custom_role_id IS NOT NULL;

-- ============================================================================
-- Row-Level Security (consistent with 0901 membership-bound policies)
-- ============================================================================

ALTER TABLE tenant_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_roles_isolation_policy ON tenant_roles
FOR ALL TO authenticated
USING (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
)
WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND app_current_user_is_tenant_member(tenant_id)
);
