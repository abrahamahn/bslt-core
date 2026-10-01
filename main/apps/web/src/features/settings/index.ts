// main/apps/web/src/features/settings/index.ts
/**
 * Settings Feature
 *
 * User profile and settings management.
 */

// Account modal surface (replaces the old SettingsPage/ProfilePage)
export { AccountModal } from './components/AccountModal';
export { ProfileModalRoute, SettingsModalRoute } from './pages/AccountModalRoute';
export {
  getActiveSettingsTab,
  getSettingsNavItems,
  normalizeSettingsTab,
  type SettingsNavItem,
  type SettingsTabId,
} from './settingsTabs';

// Account modal store (header avatar menu + route stubs + modal host)
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
  type AccountModalState,
} from './accountModalStore';

// Components
export {
  AvatarUpload,
  ConsentPreferences,
  CookieConsentBanner,
  DangerZone,
  DeletionStatusIndicator,
  DataControlsSection,
  DataExportSection,
  DevicesList,
  EmailChangeForm,
  ForgotPasswordShortcut,
  NotificationPreferencesForm,
  OAuthConnectionsList,
  PasskeyManagement,
  PasswordChangeForm,
  PhoneManagement,
  PreferencesSection,
  ProfileCompleteness,
  ProfileForm,
  SessionCard,
  SessionsList,
  SudoModal,
  TotpManagement,
  TotpQrCode,
  UsernameForm,
} from './components';
export type {
  AvatarUploadProps,
  CookieConsentBannerProps,
  DangerZoneProps,
  DeletionStatusIndicatorProps,
  DataControlsSectionProps,
  DataExportSectionProps,
  EmailChangeFormProps,
  ForgotPasswordShortcutProps,
  NotificationPreferencesFormProps,
  OAuthConnectionsListProps,
  PasskeyManagementProps,
  PasswordChangeFormProps,
  PreferencesSectionProps,
  ProfileCompletenessProps,
  ProfileFormProps,
  SessionCardProps,
  SessionsListProps,
  SudoModalProps,
  TotpManagementProps,
  UsernameFormProps,
} from './components';

// Hooks
export {
  useDeactivateAccount,
  useDeleteAccount,
  useReactivateAccount,
  useAvatarDelete,
  useAvatarUpload,
  useConsent,
  useUpdateConsent,
  useDataExport,
  usePasswordChange,
  useProfileUpdate,
  useProfileCompleteness,
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useSudo,
  useTotpManagement,
  useUsernameUpdate,
} from './hooks';
export type {
  UseDeactivateAccountOptions,
  UseDeactivateAccountResult,
  UseDeleteAccountOptions,
  UseDeleteAccountResult,
  UseReactivateAccountOptions,
  UseReactivateAccountResult,
  UseAvatarDeleteOptions,
  UseAvatarDeleteResult,
  UseAvatarUploadOptions,
  UseAvatarUploadResult,
  UpdateConsentInput,
  UpdateConsentResponse,
  ConsentPreferences as UseConsentPreferences,
  UseConsentResult,
  UseUpdateConsentResult,
  DataExportInfo,
  ExportStatus,
  UseDataExportResult,
  UsePasswordChangeOptions,
  UsePasswordChangeResult,
  UseProfileUpdateOptions,
  UseProfileUpdateResult,
  UseProfileCompletenessResult,
  UseRevokeAllSessionsOptions,
  UseRevokeAllSessionsResult,
  UseRevokeSessionOptions,
  UseRevokeSessionResult,
  UseSessionsResult,
  UseSudoOptions,
  UseSudoResult,
  TotpState,
  UseTotpManagementResult,
  UseUsernameUpdateOptions,
  UseUsernameUpdateResult,
} from './hooks';
