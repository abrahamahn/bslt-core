// main/apps/web/src/i18n/types.ts
/**
 * Type definitions for the i18n (internationalization) system.
 *
 * Provides types for locale management, translation maps,
 * and the i18n React context value.
 *
 * @module i18n-types
 */

import {
  DEFAULT_LOCALE as SHARED_DEFAULT_LOCALE,
  SUPPORTED_LOCALES as SHARED_SUPPORTED_LOCALES,
  type Locale as SharedLocale,
} from '@bslt/shared/constants/system';

// ============================================================================
// Locale Types
// ============================================================================

export type Locale = SharedLocale;

/**
 * Array of all supported locales for runtime validation.
 */
export const SUPPORTED_LOCALES = SHARED_SUPPORTED_LOCALES;

/**
 * Default locale used when no preference is detected.
 */
export const DEFAULT_LOCALE: Locale = SHARED_DEFAULT_LOCALE;

// ============================================================================
// Translation Types
// ============================================================================

/**
 * A flat or nested map of translation key-value pairs.
 *
 * Flat: `{ 'common.save': 'Save' }`
 * Nested: `{ common: { save: 'Save' } }`
 */
export type TranslationMap = Record<string, string | Record<string, string>>;

/**
 * A fully flattened translation map where all keys are dot-notation strings.
 */
export type FlatTranslationMap = Record<string, string>;

// ============================================================================
// Context Types
// ============================================================================

/**
 * Value provided by the I18nContext to consuming components.
 */
export interface I18nContextValue {
  /** Current active locale */
  locale: Locale;
  /** Change the active locale */
  setLocale: (locale: Locale) => void;
  /** Translate a key, with optional parameter interpolation */
  t: (key: string, params?: Record<string, string | number>) => string;
}

// ============================================================================
// Locale Metadata
// ============================================================================

/**
 * Display metadata for a locale.
 */
export interface LocaleMetadata {
  /** BCP 47 locale code */
  code: Locale;
  /** English name of the language */
  name: string;
  /** Native name of the language */
  nativeName: string;
  /** Text direction */
  direction: 'ltr' | 'rtl';
}

/**
 * Metadata for all supported locales.
 */
export const LOCALE_METADATA: Record<Locale, LocaleMetadata> = {
  'en-US': { code: 'en-US', name: 'English', nativeName: 'English', direction: 'ltr' },
  es: { code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr' },
  fr: { code: 'fr', name: 'French', nativeName: 'Français', direction: 'ltr' },
  de: { code: 'de', name: 'German', nativeName: 'Deutsch', direction: 'ltr' },
  ja: { code: 'ja', name: 'Japanese', nativeName: '日本語', direction: 'ltr' },
  ko: { code: 'ko', name: 'Korean', nativeName: '한국어', direction: 'ltr' },
  'zh-CN': {
    code: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    direction: 'ltr',
  },
  'pt-BR': {
    code: 'pt-BR',
    name: 'Portuguese (Brazil)',
    nativeName: 'Português (Brasil)',
    direction: 'ltr',
  },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
};
