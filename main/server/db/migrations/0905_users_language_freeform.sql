-- 0905_users_language_freeform.sql
--
-- users.language is a free-form, comma-separated list of spoken languages
-- (ISO 639-1 names chosen in the profile UI), not a single BCP 47 locale
-- tag. The 0701 CHECK constraint contradicted the shipped product behavior
-- and made every profile save that included languages fail with a 500.
-- The locale default is dropped for the same reason: "en-US" is not a
-- spoken-language token.
--
-- Depends on: 0701_user_locale.sql

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_language_supported;

ALTER TABLE users ALTER COLUMN language DROP DEFAULT;
