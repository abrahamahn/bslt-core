// main/apps/web/src/i18n/locales/en-US.ts
/**
 * English (US) translation strings.
 *
 * This is the default locale and serves as the canonical reference
 * for all translation keys used in the application.
 *
 * @module i18n-locale-en-US
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// English (US) Translations
// ============================================================================

export const enUS: FlatTranslationMap = {
  // Common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.loading': 'Loading...',
  'common.error': 'Something went wrong',
  'common.success': 'Success',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.submit': 'Submit',
  'common.search': 'Search',

  // Auth - Login
  'auth.login.title': 'Sign In',
  'auth.login.email': 'Email address',
  'auth.login.password': 'Password',
  'auth.login.submit': 'Sign In',
  'auth.login.forgotPassword': 'Forgot password?',
  'auth.login.noAccount': "Don't have an account?",
  'auth.login.signUp': 'Sign up',
  'auth.login.withPasskey': 'Sign in with Passkey',

  // Auth - Register
  'auth.register.title': 'Create Account',
  'auth.register.email': 'Email address',
  'auth.register.password': 'Password',
  'auth.register.confirmPassword': 'Confirm password',
  'auth.register.submit': 'Create Account',
  'auth.register.hasAccount': 'Already have an account?',
  'auth.register.signIn': 'Sign in',

  // Auth - Forgot Password
  'auth.forgotPassword.title': 'Reset Password',
  'auth.forgotPassword.email': 'Email address',
  'auth.forgotPassword.submit': 'Send Reset Link',
  'auth.forgotPassword.sent': 'Check your email for a reset link',

  // Navigation & Shell Chrome
  'nav.home': 'Home',
  'nav.docs': 'App Guide',
  'nav.changelog': 'Changelog',
  'nav.pricing': 'Pricing',
  'nav.dashboard': 'Dashboard',
  'nav.settings': 'Settings',
  'nav.admin': 'Admin',
  'nav.workspaceConsole': 'Workspace Console',

  'header.menu': 'Menu',
  'header.openNav': 'Open navigation menu',
  'header.closeNav': 'Close navigation menu',
  'header.jumpTo': 'Jump to…',
  'header.jumpToTitle': 'Open command palette (⌘K)',
  'header.searchPlaceholder': 'Search…',
  'header.search': 'Search',
  'header.siteSearch': 'Site search',
  'header.submitSearch': 'Submit search',
  'header.accountMenu': 'Account menu',
  'header.profile': 'Profile',
  'header.settings': 'Settings',
  'header.preferences': 'Preferences',
  'header.logout': 'Log out',
  'header.logoutFailed': 'Logout failed',
  'header.logoutFailedFallback': 'Unable to log out',
  'header.login': 'Login',
  'header.register': 'Register',
  'header.activeWorkspace': 'Active Workspace',
  'header.switchLanguage': 'Switch language',
  'header.loadingNavigation': 'Loading navigation',

  // Settings
  'settings.title': 'Settings',
  'settings.subtitle': 'Account & Preferences',
  'settings.group.personal': 'Personal Account',
  'settings.group.workspace': 'Workspace & Plan',
  'settings.aria.controlCenter': 'Settings control center',
  'settings.aria.sections': 'Settings sections',
  'settings.profile.title': 'Profile',
  'settings.security.title': 'Security',
  'settings.sessions.title': 'Sessions',
  'settings.passkeys.title': 'Passkeys',
  'settings.dangerZone.title': 'Danger Zone',

  // Settings - Preferences
  'settings.preferences.title': 'Preferences',
  'settings.preferences.description': 'Customize the application appearance and behavior.',
  'settings.preferences.theme.title': 'Theme',
  'settings.preferences.theme.description':
    'Choose how the application looks. Select a theme or let it follow your system settings.',
  'settings.preferences.theme.light': 'Light',
  'settings.preferences.theme.dark': 'Dark',
  'settings.preferences.theme.system': 'System',
  'settings.preferences.theme.lightDescription': 'Always use light theme',
  'settings.preferences.theme.darkDescription': 'Always use dark theme',
  'settings.preferences.theme.systemDescription': 'Match your operating system setting',
  'settings.preferences.theme.currentSelection': 'Current selection:',
  'settings.preferences.contrast.title': 'Contrast',
  'settings.preferences.contrast.description': 'Increase contrast for improved legibility.',
  'settings.preferences.contrast.normal': 'Normal',
  'settings.preferences.contrast.normalDescription': 'Standard contrast',
  'settings.preferences.contrast.high': 'High',
  'settings.preferences.contrast.highDescription': 'Stronger contrast for readability',
  'settings.preferences.contrast.system': 'System',
  'settings.preferences.contrast.systemDescription': 'Match your operating system setting',
  'settings.preferences.density.title': 'Text size & density',
  'settings.preferences.density.ariaLabel': 'Text size and density',
  'settings.preferences.density.description':
    'Adjust text size and spacing across the application.',
  'settings.preferences.density.compact': 'Compact',
  'settings.preferences.density.compactDescription': 'Smaller text and tighter spacing',
  'settings.preferences.density.normal': 'Normal',
  'settings.preferences.density.normalDescription': 'Default text size and spacing',
  'settings.preferences.density.comfortable': 'Comfortable',
  'settings.preferences.density.comfortableDescription': 'Larger text and more spacing',
  'settings.preferences.timezone.title': 'Timezone',
  'settings.preferences.timezone.description':
    'Set your preferred timezone for displaying dates and times.',
  'settings.preferences.language.title': 'Language',
  'settings.preferences.language.description':
    'Choose your preferred language for the application interface.',
  'settings.preferences.language.saved': 'Language preference saved.',

  // Admin Console Chrome
  'admin.title': 'Admin',
  'admin.subtitle': 'Control Center',
  'admin.aria.controlCenter': 'Admin control center',
  'admin.aria.sections': 'Admin sections',
  'admin.group.operations': 'Operations',
  'admin.group.directory': 'Users & Orgs',
  'admin.group.trust': 'Trust & Compliance',
  'admin.group.platform': 'Billing & Webhooks',
  'admin.group.modules': 'Modules',
  'admin.loading': 'Loading admin access. Sign in may be required.',
  'admin.accessDenied': 'Access denied',
  'admin.accessDeniedBody': 'Forbidden. Your account is not authorized to access admin tools.',
  'admin.backToDashboard': 'Back to Dashboard',

  // Footer Sections
  'footer.section.product': 'Product',
  'footer.section.legal': 'Legal',
  'footer.section.support': 'Support',

  // Errors
  'error.unauthorized': 'You need to sign in to access this page',
  'error.forbidden': 'You do not have permission to access this resource',
  'error.notFound': 'Page not found',
  'error.serverError': 'An unexpected error occurred. Please try again.',
};
