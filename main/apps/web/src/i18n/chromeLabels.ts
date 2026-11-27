// main/apps/web/src/i18n/chromeLabels.ts
/**
 * Live locale translation helpers for application shell chrome (primary nav,
 * header controls, settings/admin sidebars, and site footer).
 *
 * Safely falls back to `en-US` when rendered outside `I18nProvider` (e.g. isolated
 * component tests) and resolves vertical-module nav/settings/admin/site-page labels
 * through the active `ModuleLocaleProvider` override map.
 */

import { useActiveModuleMessages, type WebModule } from '@bslt/web-platform';
import { useCallback, useContext } from 'react';

import { installedWebModules } from '../generated/modules';

import { enUS } from './locales/en-US';
import { I18nContext } from './provider';
import { DEFAULT_LOCALE, type Locale } from './types';
import { interpolate } from './utils';

const FRAME_PRIMARY_NAV_KEYS: Readonly<Record<string, string>> = Object.freeze({
  '/': 'nav.home',
  '/docs': 'nav.docs',
  '/changelog': 'nav.changelog',
  '/pricing': 'nav.pricing',
  '/dashboard': 'nav.dashboard',
  '/settings': 'nav.settings',
  '/admin': 'nav.admin',
});

const FRAME_DASHBOARD_ACTION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  '/profile': 'header.profile',
  '/settings': 'header.settings',
});

const FRAME_SETTINGS_KEYS: Readonly<Record<string, string>> = Object.freeze({
  preferences: 'settings.preferences.title',
});

const FRAME_ADMIN_KEYS: Readonly<Record<string, string>> = Object.freeze({
  dashboard: 'nav.dashboard',
});

const FRAME_SITE_PAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  '/': 'nav.home',
  '/docs': 'nav.docs',
  '/changelog': 'nav.changelog',
});

interface ModuleDashboardTileKeySet {
  readonly label: string;
  readonly description?: string | undefined;
  readonly actionLabel?: string | undefined;
}

interface ModulePaletteKeySet {
  readonly label: string;
  readonly description?: string | undefined;
}

function deriveModulePaletteId(moduleId: string, to: `/${string}`): string {
  const slug = to
    .replace(/^\/+/u, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  if (slug === '' || slug === moduleId.toLowerCase()) {
    return `nav-${moduleId}`;
  }
  return `nav-${moduleId}-${slug}`;
}

const MODULE_PRIMARY_NAV_KEYS = new Map<string, string>();
const MODULE_DASHBOARD_ACTION_KEYS = new Map<string, string>();
const MODULE_DASHBOARD_TILE_KEYS = new Map<string, ModuleDashboardTileKeySet>();
const MODULE_PALETTE_KEYS = new Map<string, ModulePaletteKeySet>();
const MODULE_SETTINGS_KEYS = new Map<string, string>();
const MODULE_ADMIN_KEYS = new Map<string, string>();
const MODULE_SITE_PAGE_KEYS = new Map<string, string>();

const WEB_MODULES: readonly (WebModule | null)[] = installedWebModules;

for (const mod of WEB_MODULES) {
  if (mod === null) continue;
  for (const item of mod.nav ?? []) {
    if (item.slot === 'app.primary') {
      MODULE_PRIMARY_NAV_KEYS.set(item.to, item.label);
    } else if (item.slot === 'dashboard') {
      MODULE_DASHBOARD_ACTION_KEYS.set(item.to, item.label);
      MODULE_DASHBOARD_TILE_KEYS.set(mod.module.id, {
        label: item.label,
        description: item.description,
        actionLabel: item.actionLabel,
      });
    } else if (item.slot === 'palette') {
      const id = item.id ?? deriveModulePaletteId(mod.module.id, item.to);
      MODULE_PALETTE_KEYS.set(id, {
        label: item.label,
        description: item.description,
      });
    }
  }
  for (const section of mod.settings ?? []) {
    MODULE_SETTINGS_KEYS.set(section.id, section.label);
  }
  for (const surface of mod.admin ?? []) {
    MODULE_ADMIN_KEYS.set(surface.id, surface.label);
  }
  for (const page of mod.sitePages ?? []) {
    MODULE_SITE_PAGE_KEYS.set(page.path, page.title);
  }
}

function lookupOverride(
  overrides: Readonly<Record<string, string>>,
  key: string | undefined,
  fallback: string,
): string {
  if (key === undefined) return fallback;
  const candidate = overrides[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : fallback;
}

interface TranslatedDashboardTile {
  readonly label: string;
  readonly value: string;
  readonly description: string;
  readonly actionLabel: string;
}

interface TranslatedPaletteCopy {
  readonly label: string;
  readonly description: string;
}

interface ChromeTranslation {
  readonly locale: Locale;
  readonly setLocale: ((next: Locale) => void) | undefined;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly translatePrimaryNav: (to: string, fallback: string) => string;
  readonly translateDashboardAction: (to: string, fallback: string) => string;
  readonly translateDashboardTile: (tile: {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly description: string;
    readonly actionLabel: string;
  }) => TranslatedDashboardTile;
  readonly translatePaletteEntry: (
    id: string,
    fallbackLabel: string,
    fallbackDescription: string,
  ) => TranslatedPaletteCopy;
  readonly translateSettingsSection: (id: string, fallback: string) => string;
  readonly translateAdminSurface: (id: string, fallback: string) => string;
  readonly translateSitePage: (path: string, fallback: string) => string;
  readonly translateSiteSection: (sectionId: string, fallback: string) => string;
}

export function useChromeTranslation(): ChromeTranslation {
  const i18n = useContext(I18nContext);
  const moduleOverrides = useActiveModuleMessages();

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string =>
      i18n !== undefined ? i18n.t(key, params) : interpolate(enUS[key] ?? key, params),
    [i18n],
  );

  const translatePrimaryNav = useCallback(
    (to: string, fallback: string): string => {
      const frameKey = FRAME_PRIMARY_NAV_KEYS[to];
      if (frameKey !== undefined) {
        return t(frameKey);
      }
      return lookupOverride(moduleOverrides, MODULE_PRIMARY_NAV_KEYS.get(to), fallback);
    },
    [moduleOverrides, t],
  );

  const translateDashboardAction = useCallback(
    (to: string, fallback: string): string => {
      const frameKey = FRAME_DASHBOARD_ACTION_KEYS[to];
      if (frameKey !== undefined) {
        return t(frameKey);
      }
      return lookupOverride(moduleOverrides, MODULE_DASHBOARD_ACTION_KEYS.get(to), fallback);
    },
    [moduleOverrides, t],
  );

  const translateDashboardTile = useCallback(
    (tile: {
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly description: string;
      readonly actionLabel: string;
    }): TranslatedDashboardTile => {
      const keys = MODULE_DASHBOARD_TILE_KEYS.get(tile.id);
      const label = lookupOverride(moduleOverrides, keys?.label, tile.label);
      const description = lookupOverride(moduleOverrides, keys?.description, tile.description);
      const actionLabel = lookupOverride(moduleOverrides, keys?.actionLabel, tile.actionLabel);
      const value = tile.value === 'Ready' ? t('dashboard.status.ready') : tile.value;
      return { label, value, description, actionLabel };
    },
    [moduleOverrides, t],
  );

  const translatePaletteEntry = useCallback(
    (id: string, fallbackLabel: string, fallbackDescription: string): TranslatedPaletteCopy => {
      const moduleKeys = MODULE_PALETTE_KEYS.get(id);
      if (moduleKeys !== undefined) {
        return {
          label: lookupOverride(moduleOverrides, moduleKeys.label, fallbackLabel),
          description: lookupOverride(moduleOverrides, moduleKeys.description, fallbackDescription),
        };
      }
      const camelId = id.replace(/-([a-z0-9])/gu, (_, ch: string) => ch.toUpperCase());
      const labelKey = `palette.entry.${camelId}.label`;
      const descKey = `palette.entry.${camelId}.description`;
      const translatedLabel = t(labelKey);
      const translatedDesc = t(descKey);
      return {
        label: translatedLabel === labelKey ? fallbackLabel : translatedLabel,
        description: translatedDesc === descKey ? fallbackDescription : translatedDesc,
      };
    },
    [moduleOverrides, t],
  );

  const translateSettingsSection = useCallback(
    (id: string, fallback: string): string => {
      const frameKey = FRAME_SETTINGS_KEYS[id];
      if (frameKey !== undefined) {
        return t(frameKey);
      }
      return lookupOverride(moduleOverrides, MODULE_SETTINGS_KEYS.get(id), fallback);
    },
    [moduleOverrides, t],
  );

  const translateAdminSurface = useCallback(
    (id: string, fallback: string): string => {
      const moduleKey = MODULE_ADMIN_KEYS.get(id);
      if (moduleKey !== undefined) {
        return lookupOverride(moduleOverrides, moduleKey, fallback);
      }
      const frameKey = FRAME_ADMIN_KEYS[id];
      if (frameKey !== undefined) {
        return t(frameKey);
      }
      return fallback;
    },
    [moduleOverrides, t],
  );

  const translateSitePage = useCallback(
    (path: string, fallback: string): string => {
      const frameKey = FRAME_SITE_PAGE_KEYS[path];
      if (frameKey !== undefined) {
        return t(frameKey);
      }
      return lookupOverride(moduleOverrides, MODULE_SITE_PAGE_KEYS.get(path), fallback);
    },
    [moduleOverrides, t],
  );

  const translateSiteSection = useCallback(
    (sectionId: string, fallback: string): string => {
      const key = `footer.section.${sectionId}`;
      const translated = t(key);
      return translated === key ? fallback : translated;
    },
    [t],
  );

  return {
    locale: i18n?.locale ?? DEFAULT_LOCALE,
    setLocale: i18n?.setLocale,
    t,
    translatePrimaryNav,
    translateDashboardAction,
    translateDashboardTile,
    translatePaletteEntry,
    translateSettingsSection,
    translateAdminSurface,
    translateSitePage,
    translateSiteSection,
  };
}
