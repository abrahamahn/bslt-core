// main/apps/web/src/features/settings/components/PreferencesSection.tsx
/**
 * Preferences Section
 *
 * Appearance (theme, contrast, density), timezone, and language preferences.
 *
 * Theme / contrast / density read the app-wide ThemeProvider context
 * (`useTheme`), so this section, the command palette, and any other appearance
 * control share a single source of truth and stay in sync.
 */

import { Button, Heading, Select, Text, useTheme } from '@bslt/ui';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { LanguageSelector } from './LanguageSelector';

import type { ContrastMode, Density, ThemeMode } from '@bslt/react/hooks';

import { AUTO_TIMEZONE, getTimezonePreference, TIMEZONE_STORAGE_KEY } from '@/i18n/format';

// ============================================================================
// Types
// ============================================================================

export interface PreferencesSectionProps {
  className?: string;
}

interface OptionGroup<T extends string> {
  readonly testIdPrefix: string;
  readonly ariaLabel: string;
  readonly value: T;
  readonly onSelect: (value: T) => void;
  readonly options: ReadonlyArray<{ value: T; label: string; description: string }>;
}

// ============================================================================
// Constants
// ============================================================================

// The timezone key/reader live in `@/i18n/format`, which consumes the
// preference when formatting dates, so picker and formatters cannot drift.
const THEME_OPTIONS: { value: ThemeMode; label: string; description: string }[] = [
  { value: 'light', label: 'Light', description: 'Always use light theme' },
  { value: 'dark', label: 'Dark', description: 'Always use dark theme' },
  { value: 'system', label: 'System', description: 'Match your operating system setting' },
];

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

/**
 * Get available timezone names from the browser's Intl API.
 */
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
      // Skip invalid timezone
    }
  }

  return options;
}

/** Renders a labelled grid of selectable appearance options. */
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
  const {
    mode: theme,
    setMode: setTheme,
    contrastMode,
    setContrastMode,
    density,
    setDensity,
  } = useTheme();

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
          heading="Theme"
          description="Choose how the application looks, or let it follow your system settings."
          group={{
            testIdPrefix: 'theme-option',
            ariaLabel: 'Theme',
            value: theme,
            onSelect: setTheme,
            options: THEME_OPTIONS,
          }}
        />
        <Text size="sm" tone="muted" className="mt-2">
          Current selection:{' '}
          <Text as="span" size="sm" className="font-medium" data-testid="current-theme">
            {THEME_OPTIONS.find((o) => o.value === theme)?.label ?? 'System'}
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

        {/* Timezone Picker */}
        <div className="settings-preferences__group">
          <Heading as="h4" size="sm" className="mb-2">
            Timezone
          </Heading>
          <Text size="sm" tone="muted" className="mb-4">
            Set your preferred timezone for displaying dates and times.
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

        {/* Language Selector (i18n-aware) */}
        <div className="settings-preferences__group">
          <Heading as="h4" size="sm" className="mb-2">
            Language
          </Heading>
          <Text size="sm" tone="muted" className="mb-4">
            Choose your preferred language for the application interface.
          </Text>

          <LanguageSelector />
        </div>
      </div>
    </div>
  );
};
