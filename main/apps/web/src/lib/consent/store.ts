// main/apps/web/src/lib/consent/store.ts
/**
 * The browser side of consent: where the decision is kept.
 *
 * The decision has to be readable SYNCHRONOUSLY, before React mounts and
 * before any network call, because third-party scripts are gated on it and an
 * anonymous visitor has no server record to consult. Hence localStorage. For
 * signed-in users the server consent record (compliance consent_records)
 * remains the durable, auditable copy; this is the same decision, cached
 * where the gate can actually reach it — not a second, competing store.
 *
 * Reads fail closed: unparseable, tampered, or absent all mean "no decision",
 * which means nothing loads.
 */

import { consentDecisionSchema } from './model';

import type { ConsentDecision, ConsentStatus, ConsentStatuses } from './model';

/** Versioned: a change to the category set must not silently inherit old answers. */
export const CONSENT_STORAGE_KEY = 'bslt.consent.v1';

// ============================================================================
// State
// ============================================================================

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: ConsentDecision | null = null;
let cacheLoaded = false;

function load(): ConsentDecision | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    // Private mode / storage disabled. No decision is recoverable, so there is
    // no decision.
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = consentDecisionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

// ============================================================================
// API
// ============================================================================

/**
 * The current decision, or null if none was ever recorded.
 *
 * The reference is stable between writes so this can back `useSyncExternalStore`
 * directly — re-parsing on every read would hand React a new object each time
 * and spin it.
 */
export function readConsent(): ConsentDecision | null {
  if (!cacheLoaded) {
    cache = load();
    cacheLoaded = true;
  }
  return cache;
}

/**
 * Record a decision. Categories left undefined keep their current status, so a
 * CPRA opt-out does not silently reset the analytics answer.
 */
export function writeConsent(update: Partial<ConsentStatuses>): ConsentDecision {
  const current = readConsent();
  const next: ConsentDecision = {
    analytics: update.analytics ?? current?.analytics ?? 'unset',
    ads: update.ads ?? current?.ads ?? 'unset',
    updatedAt: new Date().toISOString(),
  };

  cache = next;
  cacheLoaded = true;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage refused the write. The decision still governs this page — it
    // simply will not survive a reload, and the banner will ask again. That is
    // the correct failure: ask again rather than assume.
  }
  notify();
  return next;
}

/**
 * Mirror the server consent record into the local decision (signed-in users).
 * Only categories the server has actually answered are applied — an `unset`
 * must not erase a local answer — and an answer that changes nothing writes
 * nothing, so hydrating on every fetch cannot spin subscribers.
 */
export function hydrateConsent(statuses: ConsentStatuses): ConsentDecision | null {
  const current = readConsent();
  const update: { analytics?: ConsentStatus; ads?: ConsentStatus } = {};

  if (statuses.analytics !== 'unset' && statuses.analytics !== current?.analytics) {
    update.analytics = statuses.analytics;
  }
  if (statuses.ads !== 'unset' && statuses.ads !== current?.ads) {
    update.ads = statuses.ads;
  }

  return update.analytics === undefined && update.ads === undefined
    ? current
    : writeConsent(update);
}

export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cross-tab: an opt-out in one tab is an opt-out in all of them. */
export function startConsentSync(): () => void {
  // Before anything reads a decision: a GPC browser has already opted out, and
  // it did so without being asked. Record it now so the stored state, the Do Not
  // Sell control and the script gate all say the same thing.
  honourGlobalPrivacyControl();

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== CONSENT_STORAGE_KEY) return;
    cache = load();
    cacheLoaded = true;
    notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
  };
}

/** Test seam: drops the memoised decision so a fresh localStorage is re-read. */
export function resetConsentCache(): void {
  cache = null;
  cacheLoaded = false;
}

// ============================================================================
// Global Privacy Control
// ============================================================================

/**
 * Is the browser sending Global Privacy Control?
 *
 * GPC is not a preference we may weigh against others. California (CPRA),
 * Colorado and Connecticut treat it as a **binding** opt-out of the sale and
 * sharing of personal information — and personalised advertising is sharing. So
 * it applies before the user answers anything, needs no banner, and a default
 * cannot override it.
 *
 * Only an exact `true` counts. A browser that does not implement it leaves the
 * property undefined, and undefined is not a signal.
 */
export function readGlobalPrivacyControl(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/**
 * Record the GPC signal as an ads opt-out, so the stored decision agrees with
 * the law rather than merely with the banner.
 *
 * The script gate honours GPC directly (see `loadConsentedScript` in gate.ts),
 * so this write is not what protects the user — it is what makes the opt-out
 * *visible*: the Do Not Sell control reads the stored decision, and so does the
 * preference we sync to the server. Without it the user would be opted out in
 * fact and shown as opted in.
 *
 * `analytics` is deliberately untouched. GPC speaks to sale/sharing, not to
 * every category, and answering a question the signal did not ask would be its
 * own kind of dishonesty.
 */
export function honourGlobalPrivacyControl(): ConsentDecision | null {
  if (!readGlobalPrivacyControl()) return readConsent();

  const current = readConsent();
  if (current?.ads === 'denied') return current;

  return writeConsent({ ads: 'denied' });
}
