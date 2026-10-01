-- 0916_user_eligibility_attestation.sql
--
-- Signup eligibility attestation: old enough to consent (13+, or 16+ in the
-- EEA), meets the jurisdiction's requirements, and accepts the Terms.
--
-- The published Terms already claim these things. Until now nothing recorded
-- that a user had ever confirmed them, so the claim could not be evidenced.
-- These columns are that evidence: WHAT was attested (the statement version)
-- and WHEN.
--
-- `eligibility_attestation_version` points at SIGNUP_ATTESTATION_VERSION in
-- main/shared/src/modules/core/users/attestation.policy.ts, which holds the exact
-- wording the user was shown. The wording is pinned by a test, so a stored version
-- always resolves to the words that were actually on screen.
--
-- Deliberately NOT backfilled. Accounts created before this migration never made
-- the attestation, and writing a timestamp for them would manufacture a record of
-- something that never happened. NULL is the truthful value: "we do not have one".
-- Rows created by an admin or a seeder are NULL for the same reason.
--
-- No date of birth is collected: we take the attestation, we do not verify age.
-- Storing a DOB we never check would be data we do not need and would then have to
-- protect.
--
-- Depends on: 0000_users.sql

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS eligibility_attested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS eligibility_attestation_version TEXT;

-- A timestamp without the statement it belongs to is not evidence of anything, and
-- a statement without a time is not either. Both or neither.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS chk_users_eligibility_attestation_complete;

ALTER TABLE users
    ADD CONSTRAINT chk_users_eligibility_attestation_complete
    CHECK ((eligibility_attested_at IS NULL) = (eligibility_attestation_version IS NULL));

COMMENT ON COLUMN users.eligibility_attested_at IS
    'When the user confirmed the signup eligibility statement (age of consent, jurisdiction, Terms). NULL = never confirmed (pre-dates the gate, or created by an admin/seeder).';

COMMENT ON COLUMN users.eligibility_attestation_version IS
    'Version of the attestation statement the user confirmed (see SIGNUP_ATTESTATION_VERSION).';
