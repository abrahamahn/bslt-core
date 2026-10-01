// main/apps/web/src/i18n/locales/ko.ts
/**
 * Korean translation strings.
 *
 * All keys must match those defined in en-US.ts.
 *
 * @module i18n-locale-ko
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// Korean Translations
// ============================================================================

export const ko: FlatTranslationMap = {
  // Common
  'common.save': '저장',
  'common.cancel': '취소',
  'common.delete': '삭제',
  'common.edit': '편집',
  'common.loading': '불러오는 중...',
  'common.error': '문제가 발생했습니다',
  'common.success': '성공',
  'common.confirm': '확인',
  'common.back': '뒤로',
  'common.next': '다음',
  'common.submit': '제출',
  'common.search': '검색',

  // Auth - Login
  'auth.login.title': '로그인',
  'auth.login.email': '이메일 주소',
  'auth.login.password': '비밀번호',
  'auth.login.submit': '로그인',
  'auth.login.forgotPassword': '비밀번호를 잊으셨나요?',
  'auth.login.noAccount': '계정이 없으신가요?',
  'auth.login.signUp': '회원가입',
  'auth.login.withPasskey': '패스키로 로그인',

  // Auth - Register
  'auth.register.title': '계정 만들기',
  'auth.register.email': '이메일 주소',
  'auth.register.password': '비밀번호',
  'auth.register.confirmPassword': '비밀번호 확인',
  'auth.register.submit': '계정 만들기',
  'auth.register.hasAccount': '이미 계정이 있으신가요?',
  'auth.register.signIn': '로그인',

  // Auth - Forgot Password
  'auth.forgotPassword.title': '비밀번호 재설정',
  'auth.forgotPassword.email': '이메일 주소',
  'auth.forgotPassword.submit': '재설정 링크 보내기',
  'auth.forgotPassword.sent': '이메일에서 재설정 링크를 확인하세요',

  // Settings
  'settings.title': '설정',
  'settings.profile.title': '프로필',
  'settings.security.title': '보안',
  'settings.sessions.title': '세션',
  'settings.passkeys.title': '패스키',
  'settings.dangerZone.title': '위험 구역',

  // Settings - Preferences
  'settings.preferences.title': '환경 설정',
  'settings.preferences.description': '애플리케이션의 모양과 동작을 사용자 지정합니다.',
  'settings.preferences.theme.title': '테마',
  'settings.preferences.theme.description':
    '애플리케이션의 모양을 선택하세요. 테마를 직접 선택하거나 시스템 설정을 따르도록 할 수 있습니다.',
  'settings.preferences.theme.light': '라이트',
  'settings.preferences.theme.dark': '다크',
  'settings.preferences.theme.system': '시스템',
  'settings.preferences.theme.lightDescription': '항상 라이트 테마 사용',
  'settings.preferences.theme.darkDescription': '항상 다크 테마 사용',
  'settings.preferences.theme.systemDescription': '운영 체제 설정에 맞추기',
  'settings.preferences.theme.currentSelection': '현재 선택:',
  'settings.preferences.timezone.title': '시간대',
  'settings.preferences.timezone.description':
    '날짜와 시간을 표시할 때 사용할 시간대를 설정하세요.',
  'settings.preferences.language.title': '언어',
  'settings.preferences.language.description':
    '애플리케이션 인터페이스에서 사용할 언어를 선택하세요.',
  'settings.preferences.language.saved': '언어 설정이 저장되었습니다.',

  // Errors
  'error.unauthorized': '이 페이지에 접근하려면 로그인이 필요합니다',
  'error.forbidden': '이 리소스에 접근할 권한이 없습니다',
  'error.notFound': '페이지를 찾을 수 없습니다',
  'error.serverError': '예기치 않은 오류가 발생했습니다. 다시 시도해 주세요.',
};
