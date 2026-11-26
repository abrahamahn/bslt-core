// main/apps/web/src/app/account/PreferencesSection.tsx
import { Button, Heading, Select, Text, useTheme } from '@bslt/ui';
import { useCallback, useContext, useMemo, useState, type ReactElement } from 'react';

import { LanguageSelector } from './LanguageSelector';

import type { ContrastMode, Density, ThemeMode } from '@bslt/react/hooks';

import { enUS, I18nContext } from '#app/i18n';
import { AUTO_TIMEZONE, getTimezonePreference, TIMEZONE_STORAGE_KEY } from '#app/i18n/format';

interface PreferencesSectionProps {
  className?: string;
}

interface OptionGroup<T extends string> {
  readonly testIdPrefix: string;
  readonly ariaLabel: string;
  readonly value: T;
  readonly onSelect: (value: T) => void;
  readonly options: ReadonlyArray<{ value: T; label: string; description: string }>;
}

const CONTRAST_OPTIONS: { value: ContrastMode; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Standard contrast' },
  { value: 'high', label: 'High', description: 'Stronger contrast for readability' },
  { value: 'system', label: 'System', description: 'Match your operating system setting' },
];

const DENSITY_OPTIONS: { value: Density; label: string; description: string }[] = [
  { value: 'compact', label: 'Compact', description: 'Smaller text and tighter spacing' },
  { value: 'normal', label: 'Normal', description: 'Default text size and spacing' },
  { value: 'comfortable', label: 'Comfortable', description: 'Larger text and more spacing' },
];

function getTimezoneOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [
    {
      value: AUTO_TIMEZONE,
      label: `Auto-detect (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    },
  ];

  const commonTimezones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Africa/Cairo',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];

  for (const tz of commonTimezones) {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      });
      const parts = formatter.formatToParts(now);
      const offsetPart = parts.find((p) => p.type === 'timeZoneName');
      const offset = offsetPart?.value ?? '';
      options.push({ value: tz, label: `${tz.replace(/_/g, ' ')} (${offset})` });
    } catch {
      continue;
    }
  }

  return options;
}

function OptionGrid<T extends string>({
  group,
  heading,
  description,
}: {
  group: OptionGroup<T>;
  heading: string;
  description: string;
}): ReactElement {
  return (
    <div className="settings-preferences__group">
      <Heading as="h4" size="sm" className="mb-2">
        {heading}
      </Heading>
      <Text size="sm" tone="muted" className="mb-4">
        {description}
      </Text>
      <div className="settings-preferences__theme-grid" role="group" aria-label={group.ariaLabel}>
        {group.options.map(({ value, label, description: optionDescription }) => {
          const isSelected = group.value === value;
          return (
            <Button
              key={value}
              type="button"
              variant="secondary"
              className="settings-preferences__theme-option"
              onClick={() => {
                group.onSelect(value);
              }}
              aria-pressed={isSelected}
              data-selected={isSelected ? 'true' : 'false'}
              data-testid={`${group.testIdPrefix}-${value}`}
            >
              <span className="settings-preferences__theme-swatch" aria-hidden="true" />
              <span className="settings-preferences__theme-copy">
                <Text className="settings-preferences__theme-label">{label}</Text>
                <Text size="sm" tone="muted" className="settings-preferences__theme-description">
                  {optionDescription}
                </Text>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export const PreferencesSection = ({ className }: PreferencesSectionProps): ReactElement => {
  const i18n = useContext(I18nContext);
  const t = useCallback(
    (key: string): string => (i18n !== undefined ? i18n.t(key) : (enUS[key] ?? key)),
    [i18n],
  );

  const {
    mode: theme,
    setMode: setTheme,
    contrastMode,
    setContrastMode,
    density,
    setDensity,
  } = useTheme();

  const themeOptions = useMemo<{ value: ThemeMode; label: string; description: string }[]>(
    () => [
      {
        value: 'light',
        label: t('settings.preferences.theme.light'),
        description: t('settings.preferences.theme.lightDescription'),
      },
      {
        value: 'dark',
        label: t('settings.preferences.theme.dark'),
        description: t('settings.preferences.theme.darkDescription'),
      },
      {
        value: 'system',
        label: t('settings.preferences.theme.system'),
        description: t('settings.preferences.theme.systemDescription'),
      },
    ],
    [t],
  );

  const [selectedTimezone, setSelectedTimezone] = useState<string>(getTimezonePreference);
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  const handleTimezoneChange = useCallback((value: string): void => {
    setSelectedTimezone(value);
    localStorage.setItem(TIMEZONE_STORAGE_KEY, value);
  }, []);

  return (
    <div className={className}>
      <div className="settings-preferences">
        <OptionGrid
          heading={t('settings.preferences.theme.title')}
          description={t('settings.preferences.theme.description')}
          group={{
            testIdPrefix: 'theme-option',
            ariaLabel: t('settings.preferences.theme.title'),
            value: theme,
            onSelect: setTheme,
            options: themeOptions,
          }}
        />
        <Text size="sm" tone="muted" className="mt-2">
          {t('settings.preferences.theme.currentSelection')}{' '}
          <Text as="span" size="sm" className="font-medium" data-testid="current-theme">
            {themeOptions.find((o) => o.value === theme)?.label ??
              t('settings.preferences.theme.system')}
          </Text>
        </Text>

        <OptionGrid
          heading="Contrast"
          description="Increase contrast for improved legibility."
          group={{
            testIdPrefix: 'contrast-option',
            ariaLabel: 'Contrast',
            value: contrastMode,
            onSelect: setContrastMode,
            options: CONTRAST_OPTIONS,
          }}
        />

        <OptionGrid
          heading="Text size & density"
          description="Adjust text size and spacing across the application."
          group={{
            testIdPrefix: 'density-option',
            ariaLabel: 'Text size and density',
            value: density,
            onSelect: setDensity,
            options: DENSITY_OPTIONS,
          }}
        />

        <div className="settings-preferences__group">
          <Heading as="h4" size="sm" className="mb-2">
            {t('settings.preferences.timezone.title')}
          </Heading>
          <Text size="sm" tone="muted" className="mb-4">
            {t('settings.preferences.timezone.description')}
          </Text>

          <Select
            value={selectedTimezone}
            onChange={(value: string) => {
              handleTimezoneChange(value);
            }}
            data-testid="timezone-select"
            className="settings-preferences__control"
          >
            {timezoneOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="settings-preferences__group">
          <Heading as="h4" size="sm" className="mb-2">
            {t('settings.preferences.language.title')}
          </Heading>
          <Text size="sm" tone="muted" className="mb-4">
            {t('settings.preferences.language.description')}
          </Text>

          <LanguageSelector />
        </div>
      </div>
    </div>
  );
};
