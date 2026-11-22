// main/modules/compliance/web/consent/gate.ts
import { readConsent, readGlobalPrivacyControl } from './store';

import type { ConsentCategory } from './model';

export interface ConsentedScriptOptions {
  readonly category: ConsentCategory;
  readonly src: string;
  readonly prepare?: () => void;
}

const appendedSrcs = new Set<string>();

function consentAllows(category: ConsentCategory): boolean {
  if (category === 'ads' && readGlobalPrivacyControl()) return false;
  return readConsent()?.[category] === 'granted';
}

export function loadConsentedScript(options: ConsentedScriptOptions): boolean {
  const { category, src, prepare } = options;
  if (src === '') return false;
  if (!consentAllows(category)) return false;
  if (appendedSrcs.has(src)) return true;

  prepare?.();

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  appendedSrcs.add(src);
  document.head.appendChild(script);
  return true;
}

export function resetConsentedScripts(): void {
  appendedSrcs.clear();
}
