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
  });

  it('translates app frame and module chrome labels when ko-KR and module overrides are active', async () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <I18nProvider
        initialLocale="ko-KR"
        loadModuleMessages={async () => ({
          'audit.activitiesNav': '활동 내역',
          'audit.auditLogAdminNav': '감사 로그',
          'status.siteTitle': '시스템 상태',
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
    expect(result.current.translatePrimaryNav('/dashboard', 'Dashboard')).toBe('대시보드');
    expect(result.current.translateAdminSurface('audit', 'Audit')).toBe('감사 로그');
    expect(result.current.translateSettingsSection('preferences', 'Preferences')).toBe('환경설정');
    expect(result.current.translateSiteSection('legal', 'Legal')).toBe('법적 고지');
    expect(result.current.translateSitePage('/docs', 'App Guide')).toBe('앱 가이드');
  });
});
