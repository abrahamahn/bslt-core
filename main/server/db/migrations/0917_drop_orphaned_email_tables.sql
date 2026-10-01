-- 0917_drop_orphaned_email_tables.sql
--
-- Drop email_templates and email_log.
--
-- Both were created by 0301_email.sql for a templated-email subsystem that no
-- longer exists: the repositories that read them (db/repositories/email/*) and
-- db/schema/email.ts were deleted on 2026-08-05 as unused, and nothing has read
-- either table since. Transactional email goes out through the EmailProvider
-- adapter (SMTP/console), which renders from code and does not log to the
-- database, so these are pure schema residue.
--
-- Verified before writing this: the only remaining references were the tables'
-- own DDL (0301), an `ALTER TABLE email_templates ADD COLUMN version` in
-- 0700_realtime_versions.sql, and the REQUIRED_TABLES list in
-- main/server/db/src/validation.ts. The first two are earlier migrations and stay
-- as history; the list is updated alongside this migration.
--
-- This is destructive and irreversible: any rows are lost. Approved by the owner
-- 2026-08-06. There is no down migration because there is no data to restore —
-- re-creating the tables would mean reverting this file, and the shape lives in
-- 0301 if that is ever wanted.
--
-- Depends on: 0301_email.sql, 0700_realtime_versions.sql

-- email_log first: it holds a FK to email_templates(key). Dropping in this order
-- means neither statement needs CASCADE, so nothing outside these two tables can
-- be removed as a side effect.
DROP TABLE IF EXISTS email_log;

DROP TABLE IF EXISTS email_templates;
