-- 0002_remove_kakao_oauth.sql
-- Forward migration retiring the Kakao OAuth provider from
-- `identity_oauth_provider` while keeping shipped 0001_identity.sql immutable.

DELETE FROM identity_oauth_accounts
WHERE provider = 'kakao'::identity_oauth_provider;

CREATE TYPE identity_oauth_provider_next AS ENUM ('google', 'github', 'apple');

ALTER TABLE identity_oauth_accounts
    ALTER COLUMN provider TYPE identity_oauth_provider_next
    USING provider::text::identity_oauth_provider_next;

DROP TYPE identity_oauth_provider;

ALTER TYPE identity_oauth_provider_next RENAME TO identity_oauth_provider;
