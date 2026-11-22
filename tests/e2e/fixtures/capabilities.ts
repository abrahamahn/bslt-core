// tests/e2e/fixtures/capabilities.ts
/**
 * Capability flags for E2E runs.
 *
 * The web app resolves optional surfaces at runtime via `/api/platform/context`
 * (installed modules, `flags` module rows, and server `AUTH_STRATEGIES`). An
 * E2E_ENABLE_* toggle does both halves of turning a surface on: it un-skips the
 * specs for that surface, and globalSetup writes its runtime flag to the run's
 * database (`syncE2eRuntimeFlags`). Unset, the surface stays off and its specs
 * skip cleanly.
 */

function envFlagEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function hasAuthStrategy(strategy: string): boolean {
  const raw = process.env['AUTH_STRATEGIES'];
  if (raw === undefined) return false;
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes(strategy.toLowerCase());
}

/** The runtime flags this run turns on, by flag key; globalSetup makes the database match. */
export const e2eRuntimeFlags = Object.freeze({
  'flags.advanced_admin': envFlagEnabled(process.env['E2E_ENABLE_ADVANCED_ADMIN']),
  'flags.billing': envFlagEnabled(process.env['E2E_ENABLE_BILLING']),
  'flags.activity_feed': envFlagEnabled(process.env['E2E_ENABLE_ACTIVITY_FEED']),
});

/** Advanced admin surfaces (dashboard, tenants, security, jobs, audit, …). */
export const advancedAdminEnabled = e2eRuntimeFlags['flags.advanced_admin'];

/** Billing UI (plans, invoices, payment methods). */
export const billingUiEnabled = e2eRuntimeFlags['flags.billing'];

/** Activity feed pages. */
export const activityFeedEnabled = e2eRuntimeFlags['flags.activity_feed'];

/** Advanced auth methods (magic-link, OAuth providers, passkeys UI). */
export const advancedAuthEnabled =
  hasAuthStrategy('magic') || envFlagEnabled(process.env['E2E_ENABLE_ADVANCED_AUTH']);

export const ADVANCED_AUTH_SKIP_REASON =
  'Advanced auth methods are disabled in default config (enable magic in AUTH_STRATEGIES or set E2E_ENABLE_ADVANCED_AUTH=1)';

export const ADVANCED_ADMIN_SKIP_REASON =
  'Advanced admin surfaces require runtime flag flags.advanced_admin (set E2E_ENABLE_ADVANCED_ADMIN=1)';

export const BILLING_UI_SKIP_REASON =
  'Billing UI requires runtime flag flags.billing (set E2E_ENABLE_BILLING=1)';
