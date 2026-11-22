// main/apps/web/src/app/account/LanguageSelector.tsx
import { Select, Text } from '@bslt/ui';
import { useCallback, type ReactElement } from 'react';

import type { Locale } from '#app/i18n';

import { LOCALE_METADATA, SUPPORTED_LOCALES, useTranslation } from '#app/i18n';

const LOCALE_STORAGE_KEY = 'abe-locale-preference';

interface LanguageSelectorProps {
  className?: string;
}

export const LanguageSelector = ({ className }: LanguageSelectorProps): ReactElement => {
  const { locale, setLocale, t } = useTranslation();

  const handleLocaleChange = useCallback(
    (value: string): void => {
      const isSupported = SUPPORTED_LOCALES.includes(value as Locale);
      if (!isSupported) {
        return;
      }

      const newLocale = value as Locale;
      setLocale(newLocale);
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
      document.documentElement.setAttribute('lang', newLocale);
      document.documentElement.setAttribute('dir', LOCALE_METADATA[newLocale].direction);
    },
    [setLocale],
  );

  return (
    <div className={className} data-testid="language-selector">
      <Select
        value={locale}
        onChange={(value: string) => {
          handleLocaleChange(value);
        }}
        data-testid="language-select"
        className="max-w-md"
        aria-label={t('settings.preferences.language.title')}
      >
        {SUPPORTED_LOCALES.map((code) => {
          const meta = LOCALE_METADATA[code];
          return (
            <option key={code} value={code}>
              {meta.nativeName} ({meta.name})
            </option>
          );
        })}
      </Select>

      <Text size="sm" tone="muted" className="mt-2" data-testid="language-current">
        {t('settings.preferences.language.saved')}
      </Text>
    </div>
  );
};
