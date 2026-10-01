// main/shared/src/constants/core/i18n.ts

/**
 * @file Internationalization Constants
 * @description Locales, currencies, and other i18n related constants.
 *
 * Canonical source: system/i18n.ts.
 *
 * @module Core/Constants/I18n
 */

import {
  CURRENCIES as SYSTEM_CURRENCIES,
  DEFAULT_LOCALE as SYSTEM_DEFAULT_LOCALE,
  LOCALES as SYSTEM_LOCALES,
  SUPPORTED_LOCALES as SYSTEM_SUPPORTED_LOCALES,
} from '../system/i18n';

export const LOCALES = SYSTEM_LOCALES;
export const CURRENCIES = SYSTEM_CURRENCIES;
export const DEFAULT_LOCALE = SYSTEM_DEFAULT_LOCALE;
export const SUPPORTED_LOCALES = SYSTEM_SUPPORTED_LOCALES;

export type Locale = (typeof LOCALES)[number];
export type Currency = (typeof CURRENCIES)[number];
