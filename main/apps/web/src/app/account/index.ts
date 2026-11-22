// main/apps/web/src/app/account/index.ts
export { AccountModal } from './AccountModal';
export { ProfileModalRoute, SettingsModalRoute } from './AccountModalRoute';
export {
  ACCOUNT_MODAL_SECTIONS,
  closeAccountModal,
  getAccountModalState,
  isAccountModalSection,
  openAccountModal,
  setAccountModalSection,
  subscribeAccountModal,
  useAccountModal,
  type AccountModalSection,
} from './accountModalStore';
export { LanguageSelector } from './LanguageSelector';
export { PreferencesSection } from './PreferencesSection';
export {
  getActiveSettingsTab,
  getSettingsNavItems,
  normalizeSettingsTab,
  type SettingsNavItem,
} from './settingsTabs';
