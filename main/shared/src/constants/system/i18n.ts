// main/shared/src/constants/system/i18n.ts
/**
 * System-level i18n constants.
 *
 * This module is intentionally self-contained so the `system` layer does not
 * depend on `core`, matching shared layer boundary rules.
 */

/**
 * Preferred runtime name used across app packages.
 */
// Only locales with real translation files are advertised. Add a new locale
// here together with its translation file (do not ship English placeholders).
export const LOCALES = ['en-US', 'es', 'fr', 'de', 'ja', 'ko', 'zh-CN', 'pt-BR', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE = 'en-US' satisfies Locale;

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const SUPPORTED_LOCALES = LOCALES;
