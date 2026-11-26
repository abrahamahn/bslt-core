// main/apps/web/src/i18n/moduleLocales.ts
import { installedWebModules } from '../generated/modules';

import type { Locale } from './types';
import type { WebModule } from '@bslt/web-platform';

const localeBundleCache = new Map<string, Readonly<Record<string, string>>>();

/**
 * Lazily loads and merges all installed vertical module translation bundles for a
 * non-default locale (e.g. `ko-KR`). Results are cached per locale in memory so
 * toggling languages is instant after the first load and zero bytes are loaded on `en-US`.
 */
export async function loadInstalledModuleLocaleMessages(
  locale: Locale,
  modules: readonly (WebModule | null)[] = installedWebModules,
): Promise<Readonly<Record<string, string>>> {
  const useCache = modules === installedWebModules;
  if (useCache) {
    const cached = localeBundleCache.get(locale);
    if (cached !== undefined) return cached;
  }

  const loaders: Array<() => Promise<{ readonly default: Readonly<Record<string, string>> }>> = [];
  for (const mod of modules) {
    const loader = mod?.locales?.[locale];
    if (loader !== undefined) {
      loaders.push(loader);
    }
  }

  if (loaders.length === 0) {
    return Object.freeze({});
  }

  const settled = await Promise.allSettled(loaders.map((load) => load()));
  const merged: Record<string, string> = {};
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      Object.assign(merged, result.value.default);
    }
  }

  const frozen = Object.freeze(merged);
  if (useCache) {
    localeBundleCache.set(locale, frozen);
  }
  return frozen;
}
