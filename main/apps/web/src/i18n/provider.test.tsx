// main/apps/web/src/i18n/provider.test.tsx
/**
 * Tests for the I18nProvider component (en-US foundation).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTranslation } from './hooks';
import { I18nProvider } from './provider';

import type { ReactElement } from 'react';

const TranslatedText = ({ translationKey }: { translationKey: string }): ReactElement => {
  const { t } = useTranslation();
  return <span data-testid="translated">{t(translationKey)}</span>;
};

const InterpolatedText = ({
  translationKey,
  params,
}: {
  translationKey: string;
  params: Record<string, string | number>;
}): ReactElement => {
  const { t } = useTranslation();
  return <span data-testid="interpolated">{t(translationKey, params)}</span>;
};

const LocaleDisplay = (): ReactElement => {
  const { locale, setLocale, t } = useTranslation();
  return (
    <div>
      <span data-testid="current-locale">{locale}</span>
      <span data-testid="translated-save">{t('common.save')}</span>
      <button
        data-testid="switch-en"
        onClick={() => {
          setLocale('en-US');
        }}
      >
        Set English
      </button>
    </div>
  );
};

describe('I18nProvider', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders children and translates known en-US keys', () => {
    render(
      <I18nProvider initialLocale="en-US">
        <TranslatedText translationKey="common.save" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('translated')).toHaveTextContent('Save');
  });

  it('translates auth keys', () => {
    render(
      <I18nProvider initialLocale="en-US">
        <TranslatedText translationKey="auth.login.title" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('translated')).toHaveTextContent('Sign In');
  });

  it('returns the raw key when no translation exists', () => {
    render(
      <I18nProvider initialLocale="en-US">
        <TranslatedText translationKey="nonexistent.key" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('translated')).toHaveTextContent('nonexistent.key');
  });

  it('leaves unmatched interpolation placeholders untouched', () => {
    render(
      <I18nProvider initialLocale="en-US">
        <InterpolatedText translationKey="Hello, {name} ({role})!" params={{ name: 'John' }} />
      </I18nProvider>,
    );

    expect(screen.getByTestId('interpolated')).toHaveTextContent('Hello, John ({role})!');
  });

  it('ignores unsupported stored locale preferences in localStorage and falls back to en-US', () => {
    window.localStorage.setItem('abe-locale-preference', 'fr');
    render(
      <I18nProvider>
        <LocaleDisplay />
      </I18nProvider>,
    );

    expect(screen.getByTestId('current-locale')).toHaveTextContent('en-US');
    expect(screen.getByTestId('translated-save')).toHaveTextContent('Save');
  });

  it('recovers cleanly to en-US when localStorage access throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    render(
      <I18nProvider>
        <LocaleDisplay />
      </I18nProvider>,
    );

    expect(screen.getByTestId('current-locale')).toHaveTextContent('en-US');
  });

  it('keeps en-US and dir="ltr" when setLocale("en-US") is invoked', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en-US">
        <LocaleDisplay />
      </I18nProvider>,
    );

    await user.click(screen.getByTestId('switch-en'));
    expect(screen.getByTestId('current-locale')).toHaveTextContent('en-US');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en-US');
  });
});
