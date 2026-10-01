// main/apps/web/src/features/settings/components/ConsentPreferences.tsx
/**
 * Consent Preferences Component
 *
 * Form section for managing user consent preferences.
 * Displays toggle switches for different consent categories with descriptions.
 */

import { Alert, Button, Heading, Switch, Text } from '@bslt/ui';
import { CardAsyncState } from '@bslt/ui/components';
import { useEffect, useState, type ReactElement } from 'react';

import { useConsent, useUpdateConsent } from '../hooks/useConsent';

import type { UpdateConsentInput } from '../hooks/useConsent';

import { fromServerConsent, hydrateConsent } from '@/lib/consent';

// ============================================================================
// Types
// ============================================================================

interface ConsentCategory {
  key: 'analytics' | 'marketing_email' | 'third_party_sharing' | 'profiling';
  label: string;
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  {
    key: 'analytics',
    label: 'Analytics tracking',
    description: 'Help us improve by sharing usage data',
  },
  {
    key: 'marketing_email',
    label: 'Marketing communications',
    description: 'Receive product updates and offers',
  },
  {
    key: 'third_party_sharing',
    label: 'Third-party sharing',
    description: 'Allow sharing data with trusted partners',
  },
  {
    key: 'profiling',
    label: 'Profiling',
    description: 'Enable personalized experience',
  },
] as const;

// ============================================================================
// Component
// ============================================================================

export const ConsentPreferences = (): ReactElement => {
  const { preferences, isLoading, error: fetchError, refetch } = useConsent();
  const { updateConsent, isUpdating, error: updateError } = useUpdateConsent();

  const [formValues, setFormValues] = useState<UpdateConsentInput>({});

  // The server record is the durable copy for signed-in users; the local store
  // is what the script gate reads. Mirror every server answer into it so this
  // surface, the banner and the gate govern ONE decision — a category the
  // server has not answered must not erase a local one (hydrateConsent skips
  // `unset`).
  useEffect(() => {
    if (preferences !== null) hydrateConsent(fromServerConsent(preferences));
  }, [preferences]);

  const getCurrentValue = (key: ConsentCategory['key']): boolean => {
    if (formValues[key] !== undefined) {
      return formValues[key] ?? false;
    }
    return preferences?.[key] ?? false;
  };

  const handleToggle = (key: ConsentCategory['key'], value: boolean): void => {
    setFormValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async (): Promise<void> => {
    try {
      const result = await updateConsent(formValues);
      // Mirror the saved answers into the local gate store even if the refetch
      // below fails — the two surfaces must not disagree.
      hydrateConsent(fromServerConsent(result.preferences));
      setFormValues({});
      await refetch();
    } catch {
      // Error is already stored in the hook
    }
  };

  const hasChanges = Object.keys(formValues).length > 0;
  const error = fetchError ?? updateError;

  if (isLoading) {
    return (
      <CardAsyncState
        isLoading={true}
        cardClassName="p-4"
        loadingContent={<Text>Loading consent preferences...</Text>}
      />
    );
  }

  return (
    <div className="settings-consent">
      <div className="settings-consent__header">
        <Heading as="h4" size="sm" className="mb-1">
          Consent Preferences
        </Heading>
        <Text tone="muted" size="sm">
          Manage your data privacy and communication preferences.
        </Text>
      </div>

      {error !== null && (
        <Alert tone="danger" data-testid="consent-error">
          {error.message}
        </Alert>
      )}

      <div className="settings-consent__list">
        {CONSENT_CATEGORIES.map((category) => (
          <div key={category.key} className="settings-toggle-row settings-toggle-row--bordered">
            <div className="settings-toggle-row__content">
              <label htmlFor={`consent-${category.key}`}>
                <Text className="font-medium">{category.label}</Text>
              </label>
              <Text tone="muted" size="sm">
                {category.description}
              </Text>
            </div>
            <Switch
              id={`consent-${category.key}`}
              checked={getCurrentValue(category.key)}
              onChange={(checked) => {
                handleToggle(category.key, checked);
              }}
              disabled={isUpdating}
            />
          </div>
        ))}
      </div>

      <div className="settings-consent__actions">
        <Button
          onClick={() => {
            void handleSave();
          }}
          disabled={!hasChanges || isUpdating}
          data-testid="consent-save-button"
        >
          {isUpdating ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
};
