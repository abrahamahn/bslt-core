// main/apps/web/src/i18n/persistLocale.ts
/**
 * Shared locale persistence helper: updates React i18n state, `localStorage`,
 * `<html lang dir>`, and best-effort syncs `language` to `PATCH /api/users/me/update`
 * when an authenticated session is active.
 */

import { createEndpointClient } from '@bslt/client-engine';
import { identityModule } from '@bslt/identity/module';

import { reportError } from '../lib/errorReporter';

import { LOCALE_METADATA, SUPPORTED_LOCALES, type Locale } from './types';

import type { ClientEnvironment } from '../app/ClientEnvironment';

export const LOCALE_STORAGE_KEY = 'abe-locale-preference';

export function syncLocaleToProfile(
  locale: string,
  environment: ClientEnvironment | undefined,
): void {
  if (environment === undefined || environment.transport === undefined) {
    return;
  }
  const authState = environment.auth.getState();
  if (!authState.isAuthenticated || authState.user === null) {
    return;
  }
  const client = createEndpointClient(identityModule, environment.transport);
  void client.updateProfile({ body: { language: locale } }).catch((err: unknown) => {
    reportError(err, 'error');
  });
}

export function applyLocalePreference(
  nextLocale: string,
  options: {
    readonly setLocale: (locale: Locale) => void;
    readonly environment?: ClientEnvironment | undefined;
  },
): boolean {
  if (!SUPPORTED_LOCALES.includes(nextLocale as Locale)) {
    return false;
  }
  const locale = nextLocale as Locale;
  options.setLocale(locale);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (err: unknown) {
    reportError(err, 'error');
  }
  document.documentElement.setAttribute('lang', locale);
  document.documentElement.setAttribute('dir', LOCALE_METADATA[locale].direction);
  syncLocaleToProfile(locale, options.environment);
  return true;
}
