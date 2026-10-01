// main/shared/src/constants/core/compliance.ts

/**
 * @file Compliance Constants
 * @description Privacy, retention, deletion, consent, and legal document constants.
 * @module Core/Constants/Compliance
 */

// ============================================================================
// Deletion & Retention
// ============================================================================

export const DELETION_STATES = [
  'active',
  'soft_deleted',
  'pending_hard_delete',
  'hard_deleted',
] as const;

export const RETENTION_PERIODS = {
  PII_GRACE_DAYS: 30,
  HARD_DELETE_DAYS: 30,
  AUDIT_DAYS: 90,
  LOGIN_ATTEMPTS_DAYS: 90,
  SESSIONS_DAYS: 30,
  HARD_BAN_GRACE_DAYS: 7,
  BILLING_EVENTS_DAYS: 90,
} as const;

export const DEFAULT_GRACE_PERIOD_DAYS = 30;
export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 30;
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

// ============================================================================
// Consent & Data Export
// ============================================================================

export const CONSENT_TYPES = [
  'marketing_email',
  'analytics',
  'third_party_sharing',
  'profiling',
] as const;

// Must stay in sync with the CHECK constraint on consent_records.record_type
// (migrations/0500_compliance.sql) — a drift here is a runtime 23514.
export const CONSENT_RECORD_TYPES = ['legal_document', 'consent_preference'] as const;

export const DATA_EXPORT_TYPES = ['export', 'deletion'] as const;

export const DATA_EXPORT_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'canceled',
] as const;

export const DATA_EXPORT_FORMATS = ['json', 'csv'] as const;

// ============================================================================
// Legal Documents
// ============================================================================

// `dpa` (Data Processing Agreement) is a B2B artifact and out of scope for this
// B2C starter. The DB `type` column is free text, so a fork can still add types.
//
// Ownership is split. Only `terms_of_service` and `privacy_policy` are
// DB-published and served from `legal_documents` — the ToS acceptance gate keys
// on their version numbers, and the admin publisher offers exactly the
// `PUBLISHABLE_DOCUMENT_TYPES` below. The other three pages are file-owned:
// their prose lives in `docs/legal/*.md` and renders through the web app's
// `@features/content`, so a DB version published for them would never reach a
// reader (see `docs/legal/README.md`).
//
// Every type listed here must still have a seeded template in the
// legal-document templates migration — the seeds are the floor for the
// DB-backed system. `legal-templates.test.ts` enforces that.
export const DOCUMENT_TYPES = [
  'terms_of_service',
  'privacy_policy',
  'cookie_policy',
  'acceptable_use',
  'disclaimer',
] as const;

// The DB-published subset: the only types the admin publisher offers and the
// only types the publish endpoint accepts. One list, shared by both, so the
// server can never accept a type the UI would refuse to show a reader.
export const PUBLISHABLE_DOCUMENT_TYPES = [
  'terms_of_service',
  'privacy_policy',
] as const satisfies readonly (typeof DOCUMENT_TYPES)[number][];

// The human-readable title of each document type, for any surface that has to
// name one (the admin publisher's type picker, page fallback titles). Keyed by
// the type, so a new `DOCUMENT_TYPES` entry fails the type-check here instead of
// quietly disappearing from the pickers that render it.
export const DOCUMENT_TYPE_LABELS: Readonly<Record<(typeof DOCUMENT_TYPES)[number], string>> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
  cookie_policy: 'Cookie Policy',
  acceptable_use: 'Acceptable Use Policy',
  disclaimer: 'Disclaimer',
};
