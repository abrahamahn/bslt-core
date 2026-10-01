// main/apps/web/src/features/settings/settingsTabs.ts
/**
 * Settings tab/section resolution.
 *
 * Pure helpers mapping URLs to settings sections. The deep-link contract is
 * triple-format — `?tab=` search param, `#hash`, and `/settings/<segment>`
 * path — plus historical aliases. Consumed by the account-modal route stubs
 * (deep links) and the modal's own navigation.
 */

export type SettingsTabId =
  | 'profile'
  | 'security'
  | 'sessions'
  | 'notifications'
  | 'preferences'
  | 'account'
  | 'data-controls'
  | 'api-keys'
  | 'billing'
  | 'legal';

export interface SettingsNavItem {
  id: SettingsTabId;
  label: string;
}

const SETTINGS_TAB_IDS: ReadonlySet<string> = new Set([
  'profile',
  'security',
  'sessions',
  'notifications',
  'preferences',
  'account',
  'data-controls',
  'api-keys',
  'billing',
  'legal',
]);

const SETTINGS_TAB_ALIASES: Readonly<Record<string, SettingsTabId>> = {
  data: 'data-controls',
  legal: 'legal',
  notification: 'notifications',
  privacy: 'data-controls',
};

const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'preferences', label: 'Theme' },
  { id: 'account', label: 'Account' },
  { id: 'data-controls', label: 'Data Controls' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'legal', label: 'Legal' },
];

export function getSettingsNavItems({
  billingEnabled,
}: {
  readonly billingEnabled: boolean;
}): readonly SettingsNavItem[] {
  if (!billingEnabled) return SETTINGS_NAV_ITEMS;

  return [
    ...SETTINGS_NAV_ITEMS.slice(0, -1),
    { id: 'billing', label: 'Billing' },
    SETTINGS_NAV_ITEMS[SETTINGS_NAV_ITEMS.length - 1] as SettingsNavItem,
  ];
}

export function normalizeSettingsTab(value: string | null): SettingsTabId | null {
  const normalized = value?.replace(/^#/, '').trim().toLowerCase() ?? '';
  if (normalized === '') return null;
  const alias = SETTINGS_TAB_ALIASES[normalized];
  if (alias !== undefined) return alias;
  return SETTINGS_TAB_IDS.has(normalized) ? (normalized as SettingsTabId) : null;
}

function getPathSettingsTab(pathname: string): SettingsTabId | null {
  if (!pathname.startsWith('/settings/')) return null;
  const segment = pathname.slice('/settings/'.length).split('/')[0] ?? '';
  return normalizeSettingsTab(segment);
}

/** Resolve the active section from a location: `?tab=` > `#hash` > path > profile. */
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
