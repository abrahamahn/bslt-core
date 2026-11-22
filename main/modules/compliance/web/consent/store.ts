// main/modules/compliance/web/consent/store.ts
import {
  consentDecisionSchema,
  type ConsentDecision,
  type ConsentStatus,
  type ConsentStatuses,
} from './model';

export const CONSENT_STORAGE_KEY = 'bslt.consent.v1';

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: ConsentDecision | null = null;
let cacheLoaded = false;

function load(): ConsentDecision | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
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

export function readConsent(): ConsentDecision | null {
  if (!cacheLoaded) {
    cache = load();
    cacheLoaded = true;
  }
  return cache;
}

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
  } catch (err) {
    // Storage refused the write; in-memory cache still governs this session.
    if (err instanceof Error) {
      cacheLoaded = true;
    }
  }
  notify();
  return next;
}

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

export function readGlobalPrivacyControl(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

export function honourGlobalPrivacyControl(): ConsentDecision | null {
  if (!readGlobalPrivacyControl()) return readConsent();

  const current = readConsent();
  if (current?.ads === 'denied') return current;

  return writeConsent({ ads: 'denied' });
}

export function startConsentSync(): () => void {
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

export function resetConsentCache(): void {
  cache = null;
  cacheLoaded = false;
}
