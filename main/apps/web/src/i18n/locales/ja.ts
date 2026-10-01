// main/apps/web/src/i18n/locales/ja.ts
/**
 * Japanese translation strings.
 *
 * All keys must match those defined in en-US.ts.
 *
 * @module i18n-locale-ja
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// Japanese Translations
// ============================================================================

export const ja: FlatTranslationMap = {
  // Common
  'common.save': '保存',
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.edit': '編集',
  'common.loading': '読み込み中...',
  'common.error': '問題が発生しました',
  'common.success': '成功',
  'common.confirm': '確認',
  'common.back': '戻る',
  'common.next': '次へ',
  'common.submit': '送信',
  'common.search': '検索',

  // Auth - Login
  'auth.login.title': 'ログイン',
  'auth.login.email': 'メールアドレス',
  'auth.login.password': 'パスワード',
  'auth.login.submit': 'ログイン',
  'auth.login.forgotPassword': 'パスワードをお忘れですか？',
  'auth.login.noAccount': 'アカウントをお持ちでない場合',
  'auth.login.signUp': '新規登録',
  'auth.login.withPasskey': 'パスキーでログイン',

  // Auth - Register
  'auth.register.title': 'アカウント作成',
  'auth.register.email': 'メールアドレス',
  'auth.register.password': 'パスワード',
  'auth.register.confirmPassword': 'パスワード（確認）',
  'auth.register.submit': 'アカウントを作成',
  'auth.register.hasAccount': 'すでにアカウントをお持ちの場合',
  'auth.register.signIn': 'ログイン',

  // Auth - Forgot Password
  'auth.forgotPassword.title': 'パスワードの再設定',
  'auth.forgotPassword.email': 'メールアドレス',
  'auth.forgotPassword.submit': '再設定リンクを送信',
  'auth.forgotPassword.sent': 'メールに届いた再設定リンクをご確認ください',

  // Settings
  'settings.title': '設定',
  'settings.profile.title': 'プロフィール',
  'settings.security.title': 'セキュリティ',
  'settings.sessions.title': 'セッション',
  'settings.passkeys.title': 'パスキー',
  'settings.dangerZone.title': '危険な操作',

  // Settings - Preferences
  'settings.preferences.title': '環境設定',
  'settings.preferences.description': 'アプリケーションの外観と動作をカスタマイズします。',
  'settings.preferences.theme.title': 'テーマ',
  'settings.preferences.theme.description':
    'アプリケーションの外観を選択します。テーマを選ぶか、システム設定に従わせることができます。',
  'settings.preferences.theme.light': 'ライト',
  'settings.preferences.theme.dark': 'ダーク',
  'settings.preferences.theme.system': 'システム',
  'settings.preferences.theme.lightDescription': '常にライトテーマを使用する',
  'settings.preferences.theme.darkDescription': '常にダークテーマを使用する',
  'settings.preferences.theme.systemDescription': 'OS の設定に合わせる',
  'settings.preferences.theme.currentSelection': '現在の選択：',
  'settings.preferences.timezone.title': 'タイムゾーン',
  'settings.preferences.timezone.description':
    '日付と時刻の表示に使用するタイムゾーンを設定します。',
  'settings.preferences.language.title': '言語',
  'settings.preferences.language.description': 'アプリケーションの表示言語を選択します。',
  'settings.preferences.language.saved': '言語設定を保存しました。',

  // Errors
  'error.unauthorized': 'このページにアクセスするにはログインが必要です',
  'error.forbidden': 'このリソースにアクセスする権限がありません',
  'error.notFound': 'ページが見つかりません',
  'error.serverError': '予期しないエラーが発生しました。もう一度お試しください。',
};
