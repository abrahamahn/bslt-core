// main/apps/web/src/i18n/locales/ko-KR.ts
/**
 * Korean (South Korea) translation strings.
 *
 * Second canonical reference locale proving end-to-end multi-locale support
 * across the application shell and vertical modules.
 *
 * @module i18n-locale-ko-KR
 */

import type { FlatTranslationMap } from '../types';

export const koKR: FlatTranslationMap = {
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
  'auth.forgotPassword.sent': '이메일에서 비밀번호 재설정 링크를 확인하세요',

  // Navigation & Shell Chrome
  'nav.home': '홈',
  'nav.docs': '앱 가이드',
  'nav.changelog': '변경 로그',
  'nav.pricing': '요금제',
  'nav.dashboard': '대시보드',
  'nav.settings': '설정',
  'nav.admin': '관리자',
  'nav.workspaceConsole': '워크스페이스 콘솔',

  'header.menu': '메뉴',
  'header.openNav': '탐색 메뉴 열기',
  'header.closeNav': '탐색 메뉴 닫기',
  'header.jumpTo': '빠른 이동…',
  'header.jumpToTitle': '명령 팔레트 열기 (⌘K)',
  'header.searchPlaceholder': '검색…',
  'header.search': '검색',
  'header.siteSearch': '사이트 검색',
  'header.submitSearch': '검색 실행',
  'header.accountMenu': '계정 메뉴',
  'header.profile': '프로필',
  'header.settings': '설정',
  'header.preferences': '환경설정',
  'header.logout': '로그아웃',
  'header.logoutFailed': '로그아웃 실패',
  'header.logoutFailedFallback': '로그아웃할 수 없습니다',
  'header.login': '로그인',
  'header.register': '회원가입',
  'header.activeWorkspace': '활성 워크스페이스',
  'header.switchLanguage': '언어 전환',
  'header.loadingNavigation': '탐색 메뉴 불러오는 중',

  // Settings
  'settings.title': '설정',
  'settings.subtitle': '계정 및 환경설정',
  'settings.group.personal': '개인 계정',
  'settings.group.workspace': '워크스페이스 및 요금제',
  'settings.aria.controlCenter': '설정 제어 센터',
  'settings.aria.sections': '설정 섹션',
  'settings.profile.title': '프로필',
  'settings.security.title': '보안',
  'settings.sessions.title': '세션',
  'settings.passkeys.title': '패스키',
  'settings.dangerZone.title': '위험 구역',

  // Settings - Preferences
  'settings.preferences.title': '환경설정',
  'settings.preferences.description': '애플리케이션의 모양과 동작을 맞춤 설정합니다.',
  'settings.preferences.theme.title': '테마',
  'settings.preferences.theme.description':
    '애플리케이션의 외관을 선택하세요. 원하는 테마를 고르거나 시스템 설정을 따를 수 있습니다.',
  'settings.preferences.theme.light': '라이트',
  'settings.preferences.theme.dark': '다크',
  'settings.preferences.theme.system': '시스템',
  'settings.preferences.theme.lightDescription': '항상 라이트 테마 사용',
  'settings.preferences.theme.darkDescription': '항상 다크 테마 사용',
  'settings.preferences.theme.systemDescription': '운영체제 설정에 맞춤',
  'settings.preferences.theme.currentSelection': '현재 선택:',
  'settings.preferences.contrast.title': '대비',
  'settings.preferences.contrast.description': '가독성을 높이기 위해 화면 대비를 조정합니다.',
  'settings.preferences.contrast.normal': '보통',
  'settings.preferences.contrast.normalDescription': '표준 대비',
  'settings.preferences.contrast.high': '고대비',
  'settings.preferences.contrast.highDescription': '가독성을 높인 강한 대비',
  'settings.preferences.contrast.system': '시스템',
  'settings.preferences.contrast.systemDescription': '운영체제 설정에 맞춤',
  'settings.preferences.density.title': '텍스트 크기 및 밀도',
  'settings.preferences.density.ariaLabel': '텍스트 크기 및 밀도',
  'settings.preferences.density.description': '애플리케이션 전반의 글자 크기와 여백을 조정합니다.',
  'settings.preferences.density.compact': '좁게',
  'settings.preferences.density.compactDescription': '작은 글자와 조밀한 간격',
  'settings.preferences.density.normal': '보통',
  'settings.preferences.density.normalDescription': '기본 글자 크기와 간격',
  'settings.preferences.density.comfortable': '넓게',
  'settings.preferences.density.comfortableDescription': '큰 글자와 여유로운 간격',
  'settings.preferences.timezone.title': '시간대',
  'settings.preferences.timezone.description': '날짜와 시간을 표시할 기본 시간대를 설정합니다.',
  'settings.preferences.language.title': '언어',
  'settings.preferences.language.description':
    '애플리케이션 인터페이스에 사용할 언어를 선택하세요.',
  'settings.preferences.language.saved': '언어 설정이 저장되었습니다.',

  // Admin Console Chrome
  'admin.title': '관리자',
  'admin.subtitle': '제어 센터',
  'admin.aria.controlCenter': '관리자 제어 센터',
  'admin.aria.sections': '관리자 섹션',
  'admin.group.operations': '운영',
  'admin.group.directory': '사용자 및 조직',
  'admin.group.trust': '신뢰 및 컴플라이언스',
  'admin.group.platform': '결제 및 웹훅',
  'admin.group.modules': '모듈',
  'admin.loading': '관리자 권한을 확인하는 중입니다. 로그인이 필요할 수 있습니다.',
  'admin.accessDenied': '접근 거부됨',
  'admin.accessDeniedBody': '권한이 없습니다. 이 계정은 관리자 도구에 접근할 수 없습니다.',
  'admin.backToDashboard': '대시보드로 돌아가기',

  // Footer Sections
  'footer.section.product': '제품',
  'footer.section.legal': '법적 고지',
  'footer.section.support': '지원',

  // Errors
  'error.unauthorized': '이 페이지에 접근하려면 로그인이 필요합니다',
  'error.forbidden': '이 리소스에 접근할 권한이 없습니다',
  'error.notFound': '페이지를 찾을 수 없습니다',
  'error.serverError': '예기치 않은 오류가 발생했습니다. 다시 시도해 주세요.',
};
