// main/apps/web/src/i18n/chromeLabels.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useChromeTranslation } from './chromeLabels';
import { I18nProvider } from './provider';

import type { ReactNode } from 'react';

describe('useChromeTranslation', () => {
  it('falls back safely to en-US defaults when rendered outside I18nProvider', () => {
    const { result } = renderHook(() => useChromeTranslation());
    expect(result.current.locale).toBe('en-US');
    expect(result.current.setLocale).toBeUndefined();
    expect(result.current.t('header.login')).toBe('Login');
    expect(result.current.translatePrimaryNav('/dashboard', 'Dashboard')).toBe('Dashboard');
    expect(result.current.translateSettingsSection('preferences', 'Preferences')).toBe(
      'Preferences',
    );
    expect(result.current.translateAdminSurface('unknown', 'Fallback')).toBe('Fallback');
    expect(result.current.translateSiteSection('unknown', 'Custom Section')).toBe('Custom Section');
    expect(result.current.t('dashboard.welcome', { name: 'Abe' })).toBe('Welcome back, Abe.');
    expect(result.current.translateDashboardAction('/profile', 'Profile')).toBe('Profile');
    expect(
      result.current.translatePaletteEntry('nav-dashboard', 'Go to Dashboard', 'Desc'),
    ).toEqual({ label: 'Go to Dashboard', description: 'Navigate to the main dashboard' });
  });

  it('translates app frame and module chrome labels when ko-KR and module overrides are active', async () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <I18nProvider
        initialLocale="ko-KR"
        loadModuleMessages={async () => ({
          'audit.activitiesNav': '활동 내역',
          'audit.auditLogAdminNav': '감사 로그',
          'status.siteTitle': '시스템 상태',
          'tasks.nav': '작업',
          'tasks.dashboardDescription': '개인 작업 관리',
          'tasks.dashboardAction': '작업 열기',
          'tasks.paletteLabel': '작업으로 이동',
          'tasks.paletteDescription': '작업 목록 열기',
        })}
      >
        {children}
      </I18nProvider>
    );

    const { result } = renderHook(() => useChromeTranslation(), { wrapper });
    await waitFor(() => {
      expect(result.current.translatePrimaryNav('/activities', 'Activities')).toBe('활동 내역');
    });

    expect(result.current.locale).toBe('ko-KR');
    expect(result.current.t('header.logout')).toBe('로그아웃');
    expect(result.current.t('dashboard.welcome', { name: '아베' })).toBe(
      '다시 오신 것을 환영해요, 아베님.',
    );
    expect(result.current.translatePrimaryNav('/dashboard', 'Dashboard')).toBe('대시보드');
    expect(result.current.translateDashboardAction('/profile', 'Profile')).toBe('프로필');
    expect(
      result.current.translateDashboardTile({
        id: 'unknown-module',
        label: 'Custom',
        value: 'Ready',
        description: 'Desc',
        actionLabel: 'Open',
      }),
    ).toEqual({
      label: 'Custom',
      value: '준비됨',
      description: 'Desc',
      actionLabel: 'Open',
    });
    expect(
      result.current.translatePaletteEntry('nav-dashboard', 'Go to Dashboard', 'Desc'),
    ).toEqual({ label: '대시보드로 이동', description: '메인 대시보드로 이동합니다' });
    expect(result.current.translateAdminSurface('audit', 'Audit')).toBe('감사 로그');
    expect(result.current.translateSettingsSection('preferences', 'Preferences')).toBe('환경설정');
    expect(result.current.translateSiteSection('legal', 'Legal')).toBe('법적 고지');
    expect(result.current.translateSitePage('/docs', 'App Guide')).toBe('앱 가이드');
  });
});
