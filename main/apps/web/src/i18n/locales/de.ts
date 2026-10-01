// main/apps/web/src/i18n/locales/de.ts
/**
 * German translation strings.
 *
 * All keys must match those defined in en-US.ts.
 *
 * @module i18n-locale-de
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// German Translations
// ============================================================================

export const de: FlatTranslationMap = {
  // Common
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.edit': 'Bearbeiten',
  'common.loading': 'Wird geladen...',
  'common.error': 'Etwas ist schiefgelaufen',
  'common.success': 'Erfolgreich',
  'common.confirm': 'Bestätigen',
  'common.back': 'Zurück',
  'common.next': 'Weiter',
  'common.submit': 'Absenden',
  'common.search': 'Suchen',

  // Auth - Login
  'auth.login.title': 'Anmelden',
  'auth.login.email': 'E-Mail-Adresse',
  'auth.login.password': 'Passwort',
  'auth.login.submit': 'Anmelden',
  'auth.login.forgotPassword': 'Passwort vergessen?',
  'auth.login.noAccount': 'Noch kein Konto?',
  'auth.login.signUp': 'Registrieren',
  'auth.login.withPasskey': 'Mit Passkey anmelden',

  // Auth - Register
  'auth.register.title': 'Konto erstellen',
  'auth.register.email': 'E-Mail-Adresse',
  'auth.register.password': 'Passwort',
  'auth.register.confirmPassword': 'Passwort bestätigen',
  'auth.register.submit': 'Konto erstellen',
  'auth.register.hasAccount': 'Bereits ein Konto?',
  'auth.register.signIn': 'Anmelden',

  // Auth - Forgot Password
  'auth.forgotPassword.title': 'Passwort zurücksetzen',
  'auth.forgotPassword.email': 'E-Mail-Adresse',
  'auth.forgotPassword.submit': 'Link zum Zurücksetzen senden',
  'auth.forgotPassword.sent': 'Prüfe deine E-Mails auf den Link zum Zurücksetzen',

  // Settings
  'settings.title': 'Einstellungen',
  'settings.profile.title': 'Profil',
  'settings.security.title': 'Sicherheit',
  'settings.sessions.title': 'Sitzungen',
  'settings.passkeys.title': 'Passkeys',
  'settings.dangerZone.title': 'Gefahrenzone',

  // Settings - Preferences
  'settings.preferences.title': 'Präferenzen',
  'settings.preferences.description': 'Passe das Erscheinungsbild und Verhalten der Anwendung an.',
  'settings.preferences.theme.title': 'Design',
  'settings.preferences.theme.description':
    'Wähle, wie die Anwendung aussieht. Wähle ein Design oder folge deiner Systemeinstellung.',
  'settings.preferences.theme.light': 'Hell',
  'settings.preferences.theme.dark': 'Dunkel',
  'settings.preferences.theme.system': 'System',
  'settings.preferences.theme.lightDescription': 'Immer das helle Design verwenden',
  'settings.preferences.theme.darkDescription': 'Immer das dunkle Design verwenden',
  'settings.preferences.theme.systemDescription': 'Der Einstellung deines Betriebssystems folgen',
  'settings.preferences.theme.currentSelection': 'Aktuelle Auswahl:',
  'settings.preferences.timezone.title': 'Zeitzone',
  'settings.preferences.timezone.description':
    'Lege deine bevorzugte Zeitzone für die Anzeige von Datum und Uhrzeit fest.',
  'settings.preferences.language.title': 'Sprache',
  'settings.preferences.language.description':
    'Wähle deine bevorzugte Sprache für die Benutzeroberfläche.',
  'settings.preferences.language.saved': 'Spracheinstellung gespeichert.',

  // Errors
  'error.unauthorized': 'Du musst dich anmelden, um auf diese Seite zuzugreifen',
  'error.forbidden': 'Du hast keine Berechtigung, auf diese Ressource zuzugreifen',
  'error.notFound': 'Seite nicht gefunden',
  'error.serverError': 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.',
};
