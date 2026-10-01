-- 0902_billing_tenant_scope.sql
--
-- Billing Tenant-Scope, Phase 0 — additive schema only.
--
--   * Adds `is_billing_admin` to memberships (orthogonal to the 4-role
--     hierarchy; owners are implicit billing admins).
--   * Adds nullable `tenant_id` to subscriptions, customer_mappings, and
--     payment_methods (FK to tenants(id), ON DELETE RESTRICT).
--   * Backfills `tenant_id` via the "primary tenant" rule:
--       (1) if the user owns exactly one tenant → that tenant
--       (2) else the user's oldest membership
--       (3) else NULL (recorded in billing_tenant_backfill_audit)
--   * Logs every backfill decision to billing_tenant_backfill_audit for
--     post-deploy review.
--
-- RLS policies are NOT changed by this migration. Existing user-scoped
-- policies remain authoritative. Phase 1 will switch to tenant-scoped
-- policies once the service layer is rewritten.
--
-- Idempotent: each statement is guarded with IF NOT EXISTS / WHERE filters.
--
-- Depends on: 0100_tenants.sql, 0200_billing.sql, 0900_rls.sql

-- ============================================================================
-- Memberships: is_billing_admin
-- ============================================================================

ALTER TABLE memberships
    ADD COLUMN IF NOT EXISTS is_billing_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Owners are implicit billing admins. Idempotent: guarded on current value.
UPDATE memberships
   SET is_billing_admin = TRUE
 WHERE role = 'owner'
   AND is_billing_admin = FALSE;

-- ============================================================================
-- Billing tables: tenant_id (nullable; not enforced until Phase 1 ships)
-- ============================================================================

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS tenant_id UUID
        REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE customer_mappings
    ADD COLUMN IF NOT EXISTS tenant_id UUID
        REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE payment_methods
    ADD COLUMN IF NOT EXISTS tenant_id UUID
        REFERENCES tenants(id) ON DELETE RESTRICT;

-- ============================================================================
-- Helper: resolve "primary tenant" for a user
-- ============================================================================
--
-- Single source of truth for the backfill rule. Returns NULL if the user has
-- no membership and owns no tenants.
--
-- @complexity O(log n) per call with the existing indexes on tenants.owner_id
--             and memberships(user_id) — both already exist.

CREATE OR REPLACE FUNCTION billing_resolve_primary_tenant(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_owned_count INTEGER;
    v_tenant_id   UUID;
BEGIN
    -- Rule 1: user owns exactly one tenant → that tenant.
    SELECT COUNT(*)::INTEGER INTO v_owned_count
      FROM tenants
     WHERE owner_id = p_user_id;

    IF v_owned_count = 1 THEN
        SELECT id INTO v_tenant_id
          FROM tenants
         WHERE owner_id = p_user_id;
        RETURN v_tenant_id;
    END IF;

    -- Rules 2 + 3: oldest membership. Subsumes the "sole membership" case.
    SELECT tenant_id INTO v_tenant_id
      FROM memberships
     WHERE user_id = p_user_id
     ORDER BY created_at ASC, id ASC
     LIMIT 1;

    -- Returns NULL if the user has neither owned tenants nor any membership.
    RETURN v_tenant_id;
END;
$$;

-- ============================================================================
-- Audit table for backfill decisions
-- ============================================================================
--
-- One row per affected billing row, recording either the chosen tenant or
-- the reason a NULL was assigned. Operators inspect this post-deploy to
-- decide whether any NULL rows need manual reconciliation.

CREATE TABLE IF NOT EXISTS billing_tenant_backfill_audit (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_table TEXT        NOT NULL,
    source_id    UUID        NOT NULL,
    user_id      UUID        NOT NULL,
    tenant_id    UUID,
    resolution   TEXT        NOT NULL CHECK (resolution IN ('primary_tenant', 'no_membership')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT billing_tenant_backfill_audit_unique UNIQUE (source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_tenant_backfill_audit_resolution
    ON billing_tenant_backfill_audit(resolution);

-- ============================================================================
-- Backfill: subscriptions
-- ============================================================================

WITH resolved AS (
    SELECT s.id        AS subscription_id,
           s.user_id   AS user_id,
           billing_resolve_primary_tenant(s.user_id) AS resolved_tenant_id
      FROM subscriptions s
     WHERE s.tenant_id IS NULL
),
applied AS (
    UPDATE subscriptions s
       SET tenant_id = r.resolved_tenant_id
      FROM resolved r
     WHERE s.id = r.subscription_id
       AND r.resolved_tenant_id IS NOT NULL
    RETURNING s.id AS subscription_id
)
INSERT INTO billing_tenant_backfill_audit
    (source_table, source_id, user_id, tenant_id, resolution)
SELECT 'subscriptions',
       r.subscription_id,
       r.user_id,
       r.resolved_tenant_id,
       CASE WHEN r.resolved_tenant_id IS NULL
            THEN 'no_membership'
            ELSE 'primary_tenant'
       END
  FROM resolved r
ON CONFLICT (source_table, source_id) DO NOTHING;

-- ============================================================================
-- Backfill: customer_mappings
-- ============================================================================

WITH resolved AS (
    SELECT c.id      AS mapping_id,
           c.user_id AS user_id,
           billing_resolve_primary_tenant(c.user_id) AS resolved_tenant_id
      FROM customer_mappings c
     WHERE c.tenant_id IS NULL
),
applied AS (
    UPDATE customer_mappings c
       SET tenant_id = r.resolved_tenant_id
      FROM resolved r
     WHERE c.id = r.mapping_id
       AND r.resolved_tenant_id IS NOT NULL
    RETURNING c.id AS mapping_id
)
INSERT INTO billing_tenant_backfill_audit
    (source_table, source_id, user_id, tenant_id, resolution)
SELECT 'customer_mappings',
       r.mapping_id,
       r.user_id,
       r.resolved_tenant_id,
       CASE WHEN r.resolved_tenant_id IS NULL
            THEN 'no_membership'
            ELSE 'primary_tenant'
       END
  FROM resolved r
ON CONFLICT (source_table, source_id) DO NOTHING;

-- ============================================================================
-- Backfill: payment_methods
-- ============================================================================

WITH resolved AS (
    SELECT p.id      AS pm_id,
           p.user_id AS user_id,
           billing_resolve_primary_tenant(p.user_id) AS resolved_tenant_id
      FROM payment_methods p
     WHERE p.tenant_id IS NULL
),
applied AS (
    UPDATE payment_methods p
       SET tenant_id = r.resolved_tenant_id
      FROM resolved r
     WHERE p.id = r.pm_id
       AND r.resolved_tenant_id IS NOT NULL
    RETURNING p.id AS pm_id
)
INSERT INTO billing_tenant_backfill_audit
    (source_table, source_id, user_id, tenant_id, resolution)
SELECT 'payment_methods',
       r.pm_id,
       r.user_id,
       r.resolved_tenant_id,
       CASE WHEN r.resolved_tenant_id IS NULL
            THEN 'no_membership'
            ELSE 'primary_tenant'
       END
  FROM resolved r
ON CONFLICT (source_table, source_id) DO NOTHING;

-- ============================================================================
-- Indexes on tenant_id (hot once tenant-scoped reads become the default)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant
    ON subscriptions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_customer_mappings_tenant
    ON customer_mappings(tenant_id);

CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant
    ON payment_methods(tenant_id);

-- Mirror of the existing user-scoped composite, but tenant-keyed for the
-- forthcoming tenant-scoped getSubscription() service.
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status_period
    ON subscriptions(tenant_id, status, current_period_end DESC)
    WHERE tenant_id IS NOT NULL;

-- Hot path for "list billing-eligible members of a tenant" once the admin
-- UI surfaces the new flag.
CREATE INDEX IF NOT EXISTS idx_memberships_user_billing_admin
    ON memberships(user_id) WHERE is_billing_admin = TRUE;
