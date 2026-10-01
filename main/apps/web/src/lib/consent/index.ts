// main/apps/web/src/lib/consent/index.ts
/**
 * The consent model, its browser store, and the script gate.
 *
 * Import the gate from here, never the internals: `loadConsentedScript` is the
 * only call that may put a third-party script tag in the document.
 */

export {
  CONSENT_CATEGORIES,
  CONSENT_STATUSES,
  consentDecisionSchema,
  fromServerConsent,
  toServerConsent,
} from './model';

export type {
  ConsentCategory,
  ConsentDecision,
  ConsentStatus,
  ConsentStatuses,
  ServerConsentInput,
  ServerConsentPreferences,
} from './model';

export {
  CONSENT_STORAGE_KEY,
  honourGlobalPrivacyControl,
  hydrateConsent,
  readConsent,
  readGlobalPrivacyControl,
  resetConsentCache,
  startConsentSync,
  subscribeConsent,
  writeConsent,
} from './store';

export { loadConsentedScript, resetConsentedScripts } from './gate';
export type { ConsentedScriptOptions } from './gate';
