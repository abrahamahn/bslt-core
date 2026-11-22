-- 0001_identity.sql
-- Owned DDL baseline of the identity module (`@bslt/identity`):
-- identity_users, credentials, lockouts, profiles, sessions, tokens,
-- second factors, OAuth accounts and API keys.
--
-- Depends on: kernel (roles, session helpers, sys_apply_rls, sys_update_updated_at_column).
--
-- Commands per role (sys_apply_rls: user, admin, system):
--
--   table                       class        user               admin            system
--   identity_users              custom       select, update     select, insert,  all
--                                            (own row; below)   update
--   identity_credentials        owner_user   select, insert,    select, insert   all
--                                            update
--   identity_lockouts           owner_user   select             select, insert,  all
--                                                               update
--   identity_profiles           owner_user   select, insert,    select, insert,  all
--                                            update             update
--   identity_auth_tokens        system       -                  -                all
--   identity_login_attempts     system       -                  -                select, insert, delete
--   identity_refresh_tokens     owner_user   select, update,    select, update,  all
--                                            delete             delete
--   identity_sessions           owner_user   select, update     select, update   all
--   identity_oauth_accounts     owner_user   select, delete     -                select, insert, update
--   identity_mfa_backup_codes   owner_user   all                -                select, update
--   identity_trusted_devices    owner_user   select, update,    -                select, insert, update
--                                            delete
--   identity_passkeys           owner_user   all                -                select, update
--   identity_mfa_sms_codes      owner_user   select, insert,    -                select, insert, update
--                                            update
--   identity_api_keys           owner_user   select, insert,    -                select, update
--                                            delete

CREATE TYPE identity_user_role AS ENUM ('user', 'admin', 'moderator');
CREATE TYPE identity_oauth_provider AS ENUM ('google', 'github', 'apple', 'kakao');

-- ============================================================================
-- 1. identity_users, identity_credentials, identity_lockouts, identity_profiles
-- ============================================================================

CREATE TABLE identity_users (
    id                              uuid               NOT NULL DEFAULT uuid_generate_v4(),
    email                           text               NOT NULL,
    canonical_email                 text               NOT NULL,
    username                        text,
    role                            identity_user_role NOT NULL DEFAULT 'user'::identity_user_role,
    email_verified                  boolean            NOT NULL DEFAULT false,
    email_verified_at               timestamptz,
    phone                           text,
    phone_verified                  boolean,
    last_username_change            timestamptz,
    token_version                   integer            NOT NULL DEFAULT 0,
    deactivated_at                  timestamptz,
    deleted_at                      timestamptz,
    deletion_grace_period_ends      timestamptz,
    created_at                      timestamptz        NOT NULL DEFAULT now(),
    updated_at                      timestamptz        NOT NULL DEFAULT now(),
    version                         integer            NOT NULL DEFAULT 1,
    eligibility_attested_at         timestamptz,
    eligibility_attestation_version text,
    CONSTRAINT identity_users_pkey PRIMARY KEY (id),
    CONSTRAINT identity_users_canonical_email_key UNIQUE (canonical_email),
    CONSTRAINT identity_users_email_key UNIQUE (email),
    CONSTRAINT identity_users_username_key UNIQUE (username),
    CONSTRAINT chk_identity_users_eligibility_attestation_complete CHECK (((eligibility_attested_at IS NULL) = (eligibility_attestation_version IS NULL)))
);

CREATE INDEX idx_identity_users_created_at ON identity_users (created_at DESC);
CREATE INDEX idx_identity_users_deletion_grace ON identity_users (deletion_grace_period_ends) WHERE (deletion_grace_period_ends IS NOT NULL);
CREATE INDEX idx_identity_users_role ON identity_users (role);

CREATE TRIGGER update_identity_users_updated_at
BEFORE UPDATE ON identity_users
FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

COMMENT ON COLUMN identity_users.eligibility_attested_at IS
    'When the user confirmed the signup eligibility statement (age of consent, jurisdiction, Terms). NULL = never confirmed (pre-dates the gate, or created by an admin/seeder).';

COMMENT ON COLUMN identity_users.eligibility_attestation_version IS
    'Version of the attestation statement the user confirmed (see SIGNUP_ATTESTATION_VERSION).';

-- Read-only definer policy so sys_current_user_is_platform_admin() and
-- moderation_current_user_is_moderator() resolve live role/lifecycle state.
CREATE POLICY definer_read_policy ON identity_users
FOR SELECT TO bslt_definer
USING (true);

SELECT sys_apply_rls(
    'identity_users', 'custom', NULL,
    ARRAY['select', 'update'],
    ARRAY['select', 'insert', 'update'],
    ARRAY['select', 'insert', 'update', 'delete']
);

CREATE POLICY rls_user_select ON identity_users
FOR SELECT TO authenticated
USING (id = sys_current_user_id());

CREATE POLICY rls_user_update ON identity_users
FOR UPDATE TO authenticated
USING (id = sys_current_user_id())
WITH CHECK (id = sys_current_user_id());

-- ----------------------------------------------------------------------------
-- Privileged columns on identity_users
-- ----------------------------------------------------------------------------
CREATE FUNCTION identity_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    changed text;
BEGIN
    IF pg_has_role(current_user, 'bslt_system', 'USAGE')
       OR pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
        RETURN NEW;
    END IF;
    IF sys_current_user_is_platform_admin() THEN
        RETURN NEW;
    END IF;

    changed := CASE
        WHEN NEW.id IS DISTINCT FROM OLD.id THEN 'id'
        WHEN NEW.role IS DISTINCT FROM OLD.role THEN 'role'
        WHEN NEW.email IS DISTINCT FROM OLD.email THEN 'email'
        WHEN NEW.canonical_email IS DISTINCT FROM OLD.canonical_email THEN 'canonical_email'
        WHEN NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN 'email_verified'
        WHEN NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN 'email_verified_at'
        WHEN NEW.eligibility_attested_at IS DISTINCT FROM OLD.eligibility_attested_at
            THEN 'eligibility_attested_at'
        WHEN NEW.eligibility_attestation_version IS DISTINCT FROM OLD.eligibility_attestation_version
            THEN 'eligibility_attestation_version'
        WHEN NEW.created_at IS DISTINCT FROM OLD.created_at THEN 'created_at'
        -- Pending deletion: the only change is reactivation within the grace period.
        WHEN OLD.deleted_at IS NOT NULL
             AND (NEW.deleted_at, NEW.deletion_grace_period_ends)
                 IS DISTINCT FROM (OLD.deleted_at, OLD.deletion_grace_period_ends)
             AND NOT (NEW.deleted_at IS NULL
                      AND NEW.deletion_grace_period_ends IS NULL
                      AND OLD.deletion_grace_period_ends > now())
            THEN 'deleted_at'
        -- Not pending: the grace period is only set by a deletion request.
        WHEN OLD.deleted_at IS NULL
             AND NEW.deleted_at IS NULL
             AND NEW.deletion_grace_period_ends IS DISTINCT FROM OLD.deletion_grace_period_ends
            THEN 'deletion_grace_period_ends'
    END;

    IF changed IS NOT NULL THEN
        RAISE EXCEPTION 'identity_users: changing % needs the system role or a platform admin', changed
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION identity_guard_privileged_columns() FROM PUBLIC;

CREATE TRIGGER identity_users_guard_privileged_columns
    BEFORE UPDATE OF id, role, email, canonical_email, email_verified, email_verified_at,
                     eligibility_attested_at, eligibility_attestation_version, created_at,
                     deleted_at, deletion_grace_period_ends
    ON identity_users
    FOR EACH ROW
    EXECUTE FUNCTION identity_guard_privileged_columns();

-- Credentials: password hash and TOTP secret/status.
CREATE TABLE identity_credentials (
    user_id       uuid        NOT NULL,
    password_hash text        NOT NULL,
    totp_secret   text,
    totp_enabled  boolean     NOT NULL DEFAULT false,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_credentials_pkey PRIMARY KEY (user_id),
    CONSTRAINT identity_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE TRIGGER update_identity_credentials_updated_at
BEFORE UPDATE ON identity_credentials
FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'identity_credentials', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'update'],
    ARRAY['select', 'insert'],
    ARRAY['select', 'insert', 'update', 'delete']
);

-- Lockouts: failed login counter and active lock window.
-- Users may read their own row when joined, never write it; admins and the
-- system role manage locks; SECURITY DEFINER helpers read through definer_read_policy.
CREATE TABLE identity_lockouts (
    user_id               uuid        NOT NULL,
    failed_login_attempts integer     NOT NULL DEFAULT 0,
    locked_until          timestamptz,
    lock_reason           text,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_lockouts_pkey PRIMARY KEY (user_id),
    CONSTRAINT identity_lockouts_failed_login_attempts_check CHECK ((failed_login_attempts >= 0)),
    CONSTRAINT identity_lockouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_lockouts_locked_until ON identity_lockouts (locked_until) WHERE (locked_until IS NOT NULL);

CREATE TRIGGER update_identity_lockouts_updated_at
BEFORE UPDATE ON identity_lockouts
FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

CREATE POLICY definer_read_policy ON identity_lockouts
FOR SELECT TO bslt_definer
USING (true);

SELECT sys_apply_rls(
    'identity_lockouts', 'owner_user', 'user_id',
    ARRAY['select'],
    ARRAY['select', 'insert', 'update'],
    ARRAY['select', 'insert', 'update', 'delete']
);

-- Profiles: mutable display and demographic fields.
CREATE TABLE identity_profiles (
    user_id       uuid        NOT NULL,
    first_name    text        NOT NULL DEFAULT ''::text,
    last_name     text        NOT NULL DEFAULT ''::text,
    avatar_url    text,
    bio           text,
    website       text,
    language      text,
    city          text,
    state         text,
    country       text,
    date_of_birth timestamptz,
    gender        text,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_profiles_pkey PRIMARY KEY (user_id),
    CONSTRAINT identity_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_profiles_language ON identity_profiles (language) WHERE (language IS NOT NULL);

CREATE TRIGGER update_identity_profiles_updated_at
BEFORE UPDATE ON identity_profiles
FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'identity_profiles', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'update'],
    ARRAY['select', 'insert', 'update'],
    ARRAY['select', 'insert', 'update', 'delete']
);

-- ============================================================================
-- 2. Tokens and login attempts
-- ============================================================================

CREATE TABLE identity_refresh_tokens (
    id                   uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id              uuid        NOT NULL,
    family_id            uuid        NOT NULL,
    token                text        NOT NULL,
    expires_at           timestamptz NOT NULL,
    family_ip_address    text,
    family_user_agent    text,
    family_created_at    timestamptz NOT NULL DEFAULT now(),
    family_revoked_at    timestamptz,
    family_revoke_reason text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    rotated_at           timestamptz,
    CONSTRAINT identity_refresh_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT identity_refresh_tokens_token_key UNIQUE (token),
    CONSTRAINT identity_refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_refresh_tokens_family_active ON identity_refresh_tokens (user_id, family_id) WHERE (family_revoked_at IS NULL);
CREATE INDEX idx_identity_refresh_tokens_family_id ON identity_refresh_tokens (family_id);
CREATE INDEX idx_identity_refresh_tokens_family_unrotated ON identity_refresh_tokens (family_id) WHERE (rotated_at IS NULL);
CREATE INDEX idx_identity_refresh_tokens_user ON identity_refresh_tokens (user_id);
CREATE INDEX idx_identity_refresh_tokens_user_expires ON identity_refresh_tokens (user_id, expires_at DESC) WHERE (family_revoked_at IS NULL);

SELECT sys_apply_rls(
    'identity_refresh_tokens', 'owner_user', 'user_id',
    ARRAY['select', 'update', 'delete'],
    ARRAY['select', 'update', 'delete'],
    ARRAY['select', 'insert', 'update', 'delete']
);

CREATE TABLE identity_login_attempts (
    id             uuid        NOT NULL DEFAULT uuid_generate_v4(),
    email          text        NOT NULL,
    ip_address     text,
    user_agent     text,
    success        boolean     NOT NULL,
    failure_reason text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_login_attempts_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_identity_login_attempts_email_created ON identity_login_attempts (email, created_at);
CREATE INDEX idx_identity_login_attempts_ip ON identity_login_attempts (ip_address);

SELECT sys_apply_rls(
    'identity_login_attempts', 'system', NULL,
    ARRAY[]::text[],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'delete']
);

CREATE TABLE identity_auth_tokens (
    id         uuid        NOT NULL DEFAULT uuid_generate_v4(),
    type       text        NOT NULL,
    user_id    uuid,
    email      text,
    token_hash text        NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    ip_address text,
    user_agent text,
    metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_auth_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT identity_auth_tokens_type_check CHECK ((type = ANY (ARRAY['password_reset'::text, 'email_verification'::text, 'email_change'::text, 'email_change_revert'::text, 'magic_link'::text, 'email_otp'::text]))),
    CONSTRAINT identity_auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_auth_tokens_email_type ON identity_auth_tokens (email, type, created_at DESC) WHERE (email IS NOT NULL);
CREATE INDEX idx_identity_auth_tokens_expires_type ON identity_auth_tokens (type, expires_at) WHERE (used_at IS NULL);
CREATE INDEX idx_identity_auth_tokens_hash ON identity_auth_tokens (token_hash);
CREATE INDEX idx_identity_auth_tokens_ip_type ON identity_auth_tokens (ip_address, type, created_at DESC) WHERE (ip_address IS NOT NULL);
CREATE INDEX idx_identity_auth_tokens_user_type ON identity_auth_tokens (user_id, type) WHERE (user_id IS NOT NULL);

SELECT sys_apply_rls(
    'identity_auth_tokens', 'system', NULL,
    ARRAY[]::text[],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update', 'delete']
);

-- ============================================================================
-- 3. Second factors and trusted devices
-- ============================================================================

CREATE TABLE identity_mfa_backup_codes (
    id         uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id    uuid        NOT NULL,
    code_hash  text        NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_mfa_backup_codes_pkey PRIMARY KEY (id),
    CONSTRAINT identity_mfa_backup_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_mfa_backup_codes_unused ON identity_mfa_backup_codes (user_id) WHERE (used_at IS NULL);
CREATE INDEX idx_identity_mfa_backup_codes_user ON identity_mfa_backup_codes (user_id);

SELECT sys_apply_rls(
    'identity_mfa_backup_codes', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'update', 'delete'],
    ARRAY[]::text[],
    ARRAY['select', 'update']
);

CREATE TABLE identity_mfa_sms_codes (
    id         uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id    uuid        NOT NULL,
    phone      text        NOT NULL,
    code_hash  text        NOT NULL,
    expires_at timestamptz NOT NULL,
    verified   boolean     NOT NULL DEFAULT false,
    attempts   integer     NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_mfa_sms_codes_pkey PRIMARY KEY (id),
    CONSTRAINT identity_mfa_sms_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_mfa_sms_codes_expires ON identity_mfa_sms_codes (expires_at);
CREATE INDEX idx_identity_mfa_sms_codes_unverified ON identity_mfa_sms_codes (user_id, expires_at) WHERE (verified = false);
CREATE INDEX idx_identity_mfa_sms_codes_user ON identity_mfa_sms_codes (user_id);

SELECT sys_apply_rls(
    'identity_mfa_sms_codes', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'update'],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update']
);

CREATE TABLE identity_passkeys (
    id            uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id       uuid        NOT NULL,
    credential_id text        NOT NULL,
    public_key    text        NOT NULL,
    counter       integer     NOT NULL DEFAULT 0,
    transports    text,
    device_type   text,
    backed_up     boolean     NOT NULL DEFAULT false,
    name          text        NOT NULL DEFAULT 'Passkey'::text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz,
    version       integer     NOT NULL DEFAULT 1,
    CONSTRAINT identity_passkeys_pkey PRIMARY KEY (id),
    CONSTRAINT identity_passkeys_credential_id_key UNIQUE (credential_id),
    CONSTRAINT identity_passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_passkeys_last_used ON identity_passkeys (user_id, last_used_at DESC) WHERE (last_used_at IS NOT NULL);
CREATE INDEX idx_identity_passkeys_user ON identity_passkeys (user_id);

SELECT sys_apply_rls(
    'identity_passkeys', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'update', 'delete'],
    ARRAY[]::text[],
    ARRAY['select', 'update']
);

CREATE TABLE identity_trusted_devices (
    id                 uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id            uuid        NOT NULL,
    device_fingerprint text        NOT NULL,
    label              text,
    ip_address         text,
    user_agent         text,
    first_seen_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    trusted_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    version            integer     NOT NULL DEFAULT 1,
    CONSTRAINT identity_trusted_devices_pkey PRIMARY KEY (id),
    CONSTRAINT identity_trusted_devices_user_id_device_fingerprint_key UNIQUE (user_id, device_fingerprint),
    CONSTRAINT identity_trusted_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_trusted_devices_last_seen ON identity_trusted_devices (user_id, last_seen_at DESC);

SELECT sys_apply_rls(
    'identity_trusted_devices', 'owner_user', 'user_id',
    ARRAY['select', 'update', 'delete'],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update']
);

-- ============================================================================
-- 4. Sessions, OAuth accounts and API keys
-- ============================================================================

CREATE TABLE identity_sessions (
    id             uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id        uuid        NOT NULL,
    ip_address     text,
    user_agent     text,
    device_id      text,
    device_name    text,
    device_type    text,
    last_active_at timestamptz NOT NULL DEFAULT now(),
    revoked_at     timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    version        integer     NOT NULL DEFAULT 1,
    CONSTRAINT identity_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT identity_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_sessions_active ON identity_sessions (user_id, last_active_at DESC) WHERE (revoked_at IS NULL);
CREATE INDEX idx_identity_sessions_device ON identity_sessions (user_id, device_id);
CREATE INDEX idx_identity_sessions_revoked_at ON identity_sessions (revoked_at) WHERE (revoked_at IS NOT NULL);

SELECT sys_apply_rls(
    'identity_sessions', 'owner_user', 'user_id',
    ARRAY['select', 'update'],
    ARRAY['select', 'update'],
    ARRAY['select', 'insert', 'update', 'delete']
);

CREATE TABLE identity_oauth_accounts (
    id               uuid                    NOT NULL DEFAULT uuid_generate_v4(),
    user_id          uuid                    NOT NULL,
    provider         identity_oauth_provider NOT NULL,
    provider_user_id text                    NOT NULL,
    provider_email   text,
    access_token     text                    NOT NULL,
    refresh_token    text,
    expires_at       timestamptz,
    created_at       timestamptz             NOT NULL DEFAULT now(),
    updated_at       timestamptz             NOT NULL DEFAULT now(),
    version          integer                 NOT NULL DEFAULT 1,
    CONSTRAINT identity_oauth_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT identity_oauth_accounts_provider_user UNIQUE (provider, provider_user_id),
    CONSTRAINT identity_oauth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_oauth_accounts_expires ON identity_oauth_accounts (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_identity_oauth_accounts_provider ON identity_oauth_accounts (user_id, provider);

CREATE TRIGGER update_identity_oauth_accounts_updated_at
BEFORE UPDATE ON identity_oauth_accounts
FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'identity_oauth_accounts', 'owner_user', 'user_id',
    ARRAY['select', 'delete'],
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update']
);

CREATE TABLE identity_api_keys (
    id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id      uuid        NOT NULL,
    name         text        NOT NULL,
    token_hash   text        NOT NULL,
    key_prefix   text        NOT NULL,
    last4        text        NOT NULL,
    last_used_at timestamptz,
    expires_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT identity_api_keys_pkey PRIMARY KEY (id),
    CONSTRAINT identity_api_keys_token_hash_key UNIQUE (token_hash),
    CONSTRAINT identity_api_keys_name_check CHECK (((char_length(TRIM(BOTH FROM name)) > 0) AND (char_length(name) <= 100))),
    CONSTRAINT identity_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_identity_api_keys_owner_created ON identity_api_keys (user_id, created_at DESC);

CREATE TRIGGER update_identity_api_keys_updated_at
BEFORE UPDATE ON identity_api_keys
FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'identity_api_keys', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'delete'],
    ARRAY[]::text[],
    ARRAY['select', 'update']
);
