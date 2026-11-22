-- 0002_sys_optional_orgs_guard.sql
-- Makes `sys_current_user_is_org_member` fail closed (`false`) when the optional
-- `@bslt/orgs` module (`public.orgs_members`) is not installed (e.g. Minimal Core),
-- while preserving identical `SECURITY DEFINER` membership lookup when installed.

CREATE OR REPLACE FUNCTION sys_current_user_is_org_member(_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    is_member boolean;
BEGIN
    IF _org_id IS NULL OR to_regclass('public.orgs_members') IS NULL THEN
        RETURN false;
    END IF;

    EXECUTE 'SELECT EXISTS (
        SELECT 1
        FROM public.orgs_members
        WHERE org_id = $1
          AND user_id = sys_current_user_id()
    )'
    INTO is_member
    USING _org_id;

    RETURN COALESCE(is_member, false);
END;
$$;
