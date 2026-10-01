-- 0903_oauth_provider_kakao.sql
--
-- Align migration-created databases with the OAuth route surface.
-- Kakao is already supported by shared schemas, server routes, and clients.

ALTER TYPE oauth_provider ADD VALUE IF NOT EXISTS 'kakao';
