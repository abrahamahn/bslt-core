-- 0914_email_unsubscribes.sql
--
-- Creates the table the unsubscribe service has always written to.
--
-- `core/src/notifications/unsubscribe.ts` INSERTs, DELETEs and SELECTs
-- `email_unsubscribes` in four places, and no migration ever created it. Every
-- one of those calls raises Postgres 42P01 (undefined_table):
--
--   * `unsubscribeUser`            -> the public GET /api/email/unsubscribe/:token
--                                     500s on every click, and that URL is what
--                                     we put in the List-Unsubscribe header of
--                                     every email we send;
--   * `isUnsubscribed` /
--     `shouldSendEmail`            -> the send pipeline's suppression check
--                                     throws instead of answering, so nothing is
--                                     ever suppressed;
--   * `getUnsubscribedCategories`  -> the preferences UI cannot load them;
--   * `resubscribeUser`            -> no undo.
--
-- CAN-SPAM, GDPR and the Gmail/Yahoo bulk-sender rules all require a working
-- one-click unsubscribe, and we advertise RFC 8058 compliance in the headers
-- while the endpoint behind it is a 500.
--
-- Shape follows `consent_records` (0500): user-scoped, not tenant-scoped, so no
-- `tenant_id` and no RLS policy — 0900 enables RLS only on tenant-owned tables.
--
-- The primary key IS the invariant: one row per user per category. That is what
-- `unsubscribeUser`'s `ON CONFLICT (user_id, category) DO UPDATE` binds to, so
-- a surrogate id with a separate unique constraint would only add a second way
-- to say the same thing.
--
-- `category` is free text, matching `legal_documents.type`: the values live in
-- UNSUBSCRIBE_CATEGORIES ('marketing', 'social', 'all') and a fork will add its
-- own. A CHECK constraint here would mean a migration for every new category,
-- and the service already validates against the union before it writes.

CREATE TABLE IF NOT EXISTS email_unsubscribes (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category        TEXT NOT NULL,
    unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, category)
);

COMMENT ON TABLE email_unsubscribes IS
  'Email suppression list. One row per user per category; presence means suppressed. The ''all'' category suppresses every category.';
