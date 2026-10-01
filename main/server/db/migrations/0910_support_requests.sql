-- 0910_support_requests.sql
--
-- Customer support / contact-form submissions. Operator-owned (read by admins),
-- and writable by ANYONE — including logged-out users who "can't sign in", which
-- is exactly when a contact form matters. `user_id` is therefore nullable and the
-- table is intentionally NOT row-level-security scoped to a user.
--
-- Depends on: 0000_users.sql

CREATE TABLE IF NOT EXISTS support_requests (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    email      TEXT NOT NULL CHECK (char_length(email) <= 320),
    subject    TEXT NOT NULL CHECK (char_length(trim(subject)) > 0 AND char_length(subject) <= 200),
    message    TEXT NOT NULL CHECK (char_length(trim(message)) > 0 AND char_length(message) <= 5000),
    category   TEXT NOT NULL DEFAULT 'general',
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_support_requests_updated_at
    BEFORE UPDATE ON support_requests
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Admin inbox lists newest-first, optionally filtered by status.
CREATE INDEX idx_support_requests_status_created ON support_requests(status, created_at DESC);
CREATE INDEX idx_support_requests_created ON support_requests(created_at DESC);
