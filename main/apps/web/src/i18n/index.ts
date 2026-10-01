// main/apps/web/src/i18n/index.ts
/**
 * Barrel export for the i18n module.
 *
 * Re-exports all public types, components, hooks, and utilities
 * needed by consumers of the i18n system.
 *
 * @module i18n
 */

// ============================================================================
// Types
// ============================================================================

export type {
  FlatTranslationMap,
  I18nContextValue,
  Locale,
  LocaleMetadata,
  TranslationMap,
} from './types';
export { DEFAULT_LOCALE, LOCALE_METADATA, SUPPORTED_LOCALES } from './types';

// ============================================================================
// Provider & Context
// ============================================================================

export { I18nContext, I18nProvider } from './provider';
export type { I18nProviderProps } from './provider';

// ============================================================================
// Hooks
// ============================================================================

export { useLocale, useTranslation } from './hooks';

// ============================================================================
// Utilities
// ============================================================================

export { detectLocale, flattenTranslations, interpolate } from './utils';

// ============================================================================
// Formatting
// ============================================================================

export { formatCurrency, formatDate, formatNumber, formatRelativeTime } from './format';

// ============================================================================
// Locale Data
// ============================================================================

export { ar } from './locales/ar';
export { de } from './locales/de';
export { enUS } from './locales/en-US';
export { es } from './locales/es';
export { fr } from './locales/fr';
export { ja } from './locales/ja';
export { ko } from './locales/ko';
export { ptBR } from './locales/pt-BR';
export { zhCN } from './locales/zh-CN';
