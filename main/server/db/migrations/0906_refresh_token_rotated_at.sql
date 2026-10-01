-- 0906: Retain rotated refresh tokens for reuse detection.
--
-- Rotation previously DELETED the old token row, which made the documented
-- token-reuse detection (docs/specs/auth.md: "If unauthorized use is
-- detected, the entire family is revoked") unreachable — a stolen rotated
-- token hit a generic "not found" 401 and the family stayed valid.
--
-- Rotated rows are now kept until expiry, stamped with rotated_at. A token
-- presented with rotated_at set is either a network retry (within the grace
-- window → the current token is returned) or a reuse attack (the family is
-- revoked). Expired rows are purged by the existing cleanup job.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

-- Reuse detection and grace lookups filter the active token per family.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_active
    ON refresh_tokens (family_id)
    WHERE rotated_at IS NULL;
