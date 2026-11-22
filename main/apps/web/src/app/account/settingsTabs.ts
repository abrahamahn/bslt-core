// main/apps/web/src/app/account/settingsTabs.ts
import { routeFlagsToCapabilities } from '../routeFlags';
import { webApp } from '../webApp';

import type { ResolvedSettingsSection } from '@bslt/web-platform';

type SettingsTabId = string;
export type SettingsNavItem = ResolvedSettingsSection;

export function getSettingsNavItems({
  billingEnabled,
}: {
  readonly billingEnabled: boolean;
}): readonly SettingsNavItem[] {
  const flags = {
    advancedAdminEnabled: false,
    advancedAuthEnabled: false,
    billingEnabled,
    developerToolsEnabled: false,
    teamsEnabled: false,
  };
  return webApp.getSettingsNavItems(flags, routeFlagsToCapabilities(flags));
}

export function normalizeSettingsTab(value: string | null): SettingsTabId | null {
  return webApp.normalizeSettingsTab(value);
}

function getPathSettingsTab(pathname: string): SettingsTabId | null {
  if (!pathname.startsWith('/settings/')) return null;
  const segment = pathname.slice('/settings/'.length).split('/')[0] ?? '';
  return normalizeSettingsTab(segment);
}

export function getActiveSettingsTab({
  hash,
  pathname,
  search,
}: {
  hash: string;
  pathname: string;
  search: string;
}): SettingsTabId {
  const searchTab = normalizeSettingsTab(new URLSearchParams(search).get('tab'));
  const hashTab = normalizeSettingsTab(hash);
  const pathTab = getPathSettingsTab(pathname);
  return searchTab ?? hashTab ?? pathTab ?? 'profile';
}
