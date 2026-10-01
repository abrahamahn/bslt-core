// main/apps/web/src/lib/consent/gate.ts
/**
 * The consent gate: the ONE place a third-party script tag may be created.
 *
 * Everything else in the app asks this function; nothing else calls
 * `document.createElement('script')` for a consented category. That is what
 * makes "no script without consent" a testable property instead of a hope —
 * the tests spy on `document.head.appendChild` and prove nothing reaches the
 * DOM without a granted decision.
 *
 * Policy (the starter's, deliberately the strictest): BOTH categories require
 * an explicit `granted`. `unset` is not consent, `denied` is not consent, and
 * a tampered or unreadable store is not consent. Forks operating under an
 * opt-out regime (CPRA et al.) may relax `ads` to "not denied" for visitors
 * outside opt-in territories — that is a legal position, so if you take it,
 * take it with a region signal and tests, the way ganbate's adsense gate does.
 *
 * GPC binds the gate, not just the banner: `honourGlobalPrivacyControl`
 * persists the opt-out, but a localStorage write can fail (private mode, full
 * quota), and a gate that trusted storage alone would hand a GPC user a
 * personalised ad anyway. The signal is read here, directly.
 */

import { readConsent, readGlobalPrivacyControl } from './store';

import type { ConsentCategory } from './model';

export interface ConsentedScriptOptions {
  readonly category: ConsentCategory;
  readonly src: string;
  /**
   * Runs BEFORE the tag is appended. The order is load-bearing: vendor tags
   * read their configuration globals at the instant they initialise (e.g.
   * AdSense reads `adsbygoogle.requestNonPersonalizedAds` as the script runs),
   * so setting a flag AFTER append is a silent no-op. Anything the script must
   * see — NPA flags, queue shims, config objects — is set up here.
   */
  readonly prepare?: () => void;
}

/** Every src this gate has appended, so a re-invocation cannot double-inject. */
const appendedSrcs = new Set<string>();

function consentAllows(category: ConsentCategory): boolean {
  // A binding opt-out beats a stored grant: the signal is read at the gate so
  // a failed persistence write cannot re-personalise (see module header).
  if (category === 'ads' && readGlobalPrivacyControl()) return false;
  return readConsent()?.[category] === 'granted';
}

/**
 * Load a third-party script if — and only if — its category is consented.
 *
 * Returns true when the script is in the document after the call (appended
 * now, or on an earlier call), false when consent refused it. Idempotent: the
 * same src is appended once, however many callers ask.
 */
export function loadConsentedScript(options: ConsentedScriptOptions): boolean {
  const { category, src, prepare } = options;
  if (src === '') return false;
  if (!consentAllows(category)) return false;
  if (appendedSrcs.has(src)) return true;

  // prepare() before append — see ConsentedScriptOptions.prepare for why.
  prepare?.();

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  appendedSrcs.add(src);
  document.head.appendChild(script);
  return true;
}

/** Test seam: forgets what was appended so each test starts from a clean DOM. */
export function resetConsentedScripts(): void {
  appendedSrcs.clear();
}
