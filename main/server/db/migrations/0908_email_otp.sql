-- 0908_email_otp.sql
--
-- Add the 'email_otp' token type to the unified auth_tokens table so that
-- passwordless 6-digit code logins can store their (hashed) codes alongside
-- magic links, password resets, and email verification tokens.
--
-- The CHECK constraint created in 0000_users.sql is unnamed, so Postgres
-- auto-named it `auth_tokens_type_check`. Drop and recreate it with the new
-- value included. Idempotent via DROP CONSTRAINT IF EXISTS.

ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_type_check;

ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_type_check CHECK (type IN (
    'password_reset','email_verification',
    'email_change','email_change_revert','magic_link','email_otp'));
