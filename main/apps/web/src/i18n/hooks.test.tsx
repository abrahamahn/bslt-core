// main/apps/web/src/i18n/hooks.test.tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLocale, useTranslation } from './hooks';
import { I18nProvider } from './provider';

import type { ReactNode } from 'react';

describe('i18n hooks', () => {
  it('throws clear errors when called outside I18nProvider', () => {
    expect(() => renderHook(() => useLocale())).toThrow(/I18nProvider/u);
    expect(() => renderHook(() => useTranslation())).toThrow(/I18nProvider/u);
  });

  it('returns active locale and translation helpers inside I18nProvider', () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <I18nProvider initialLocale="ko-KR">{children}</I18nProvider>
    );

    const localeHook = renderHook(() => useLocale(), { wrapper });
    expect(localeHook.result.current).toBe('ko-KR');

    const translationHook = renderHook(() => useTranslation(), { wrapper });
    expect(translationHook.result.current.locale).toBe('ko-KR');
    expect(translationHook.result.current.t('common.save')).toBe('저장');
  });
});
