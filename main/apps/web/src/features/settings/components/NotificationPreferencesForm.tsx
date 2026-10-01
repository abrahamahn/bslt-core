// main/apps/web/src/features/settings/components/NotificationPreferencesForm.tsx
/**
 * NotificationPreferencesForm
 *
 * Component for managing notification preferences including
 * global enable/disable, per-type toggles, and quiet hours.
 */

import { getAccessToken } from '@app/authToken';
import { useAuth } from '@auth/hooks';
import {
  Alert,
  Button,
  Checkbox,
  EmptyState,
  Heading,
  Input,
  Skeleton,
  Switch,
  Text,
} from '@bslt/ui';
import { clientConfig as appClientConfig } from '@config';
import {
  useNotificationPreferences,
  usePushPermission,
  usePushSubscription,
  useTestNotification,
} from '@features/notifications';
import { useMemo, useState } from 'react';

import type { NotificationClientConfig } from '@bslt/api';
import type { NotificationPreferences, NotificationType } from '@bslt/shared/comms/notifications';
import type { ReactElement } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface NotificationPreferencesFormProps {
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const NOTIFICATION_TYPES: { key: NotificationType; label: string; description: string }[] = [
  { key: 'system', label: 'System', description: 'System updates and maintenance notices' },
  { key: 'security', label: 'Security', description: 'Login alerts and security warnings' },
  { key: 'transactional', label: 'Transactional', description: 'Order confirmations and receipts' },
  { key: 'social', label: 'Social', description: 'Mentions, comments, and invitations' },
  { key: 'marketing', label: 'Marketing', description: 'Product updates and promotions' },
];

const CHANNELS = ['push', 'email', 'sms', 'in_app'] as const;

const CHANNEL_LABELS: Record<string, string> = {
  push: 'Push',
  email: 'Email',
  in_app: 'In-App',
  sms: 'SMS',
};

// ============================================================================
// Component
// ============================================================================

export function NotificationPreferencesForm({
  className,
}: NotificationPreferencesFormProps): ReactElement {
  // Refresh the (memory-only) access token and retry once on a 401 so a lapsed
  // token — e.g. after the refresh timer is throttled in a backgrounded tab —
  // self-heals instead of surfacing as a stuck "Unauthorized".
  const { refreshToken } = useAuth();
  const notificationConfig: NotificationClientConfig = useMemo(
    () => ({
      baseUrl: appClientConfig.apiUrl,
      getToken: getAccessToken,
      onUnauthorized: refreshToken,
    }),
    [refreshToken],
  );

  const { preferences, isLoading, isSaving, error, updatePreferences } = useNotificationPreferences(
    { clientConfig: notificationConfig },
  );
  const pushSubscription = usePushSubscription({ clientConfig: notificationConfig });
  const pushPermission = usePushPermission();
  const pushUnavailable = !pushSubscription.isSupported || pushPermission.isDenied;
  const testNotification = useTestNotification(notificationConfig);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleGlobalToggle = (checked: boolean): void => {
    setSaveError(null);
    updatePreferences({ globalEnabled: checked }).catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to update');
    });
  };

  const handleTypeToggle = (type: NotificationType, enabled: boolean): void => {
    setSaveError(null);
    updatePreferences({
      types: { [type]: { enabled } },
    }).catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to update');
    });
  };

  const handleChannelToggle = (
    type: NotificationType,
    channel: string,
    prefs: NotificationPreferences,
  ): void => {
    setSaveError(null);
    const currentChannels = prefs.types[type].channels;
    const newChannels = currentChannels.includes(channel as 'push' | 'email' | 'sms' | 'in_app')
      ? currentChannels.filter((c) => c !== channel)
      : [...currentChannels, channel as 'push' | 'email' | 'sms' | 'in_app'];

    updatePreferences({
      types: { [type]: { channels: newChannels } },
    }).catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to update');
    });
  };

  const handleQuietHoursToggle = (enabled: boolean): void => {
    setSaveError(null);
    updatePreferences({
      quietHours: { enabled },
    }).catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to update');
    });
  };

  const handleQuietHoursChange = (field: 'startHour' | 'endHour', value: string): void => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 23) return;
    setSaveError(null);
    updatePreferences({
      quietHours: { [field]: num },
    }).catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to update');
    });
  };

  const handlePushSubscriptionToggle = (): void => {
    setSaveError(null);
    const action = pushSubscription.isSubscribed
      ? pushSubscription.unsubscribe
      : pushSubscription.subscribe;
    action().catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to update push subscription');
    });
  };

  const handleSendTest = (): void => {
    setSaveError(null);
    testNotification.sendTest().catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to send test notification');
    });
  };

  if (isLoading) {
    return (
      <div className={className}>
        <div className="flex flex-col gap-4">
          <Skeleton width="10rem" height="1.25rem" />
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="3rem" radius="var(--ui-radius-md)" />
        </div>
      </div>
    );
  }

  if (error !== null && preferences === null) {
    return (
      <div className={className}>
        <Alert tone="danger">{error.message}</Alert>
      </div>
    );
  }

  if (preferences === null) {
    return (
      <div className={className}>
        <EmptyState
          title="No preferences found"
          description="Notification preferences will appear once configured"
        />
      </div>
    );
  }

  const rootClassName =
    className === undefined ? 'settings-notifications' : `settings-notifications ${className}`;

  return (
    <div className={rootClassName}>
      {(saveError !== null || error !== null) && (
        <Alert tone="danger">
          {saveError ?? (error !== null ? error.message : 'An error occurred')}
        </Alert>
      )}

      <div className="settings-toggle-row">
        <div className="settings-toggle-row__content">
          <Text className="font-medium">Notifications</Text>
          <Text size="sm" tone="muted">
            Enable or disable all notifications globally.
          </Text>
        </div>
        <Switch
          checked={preferences.globalEnabled}
          onChange={handleGlobalToggle}
          disabled={isSaving}
        />
      </div>

      <section className="settings-notifications__section">
        <div className="settings-toggle-row">
          <div className="settings-toggle-row__content">
            <Heading as="h4" size="sm">
              Push Device
            </Heading>
            <Text size="sm" tone="muted">
              Browser push notifications for this device.
            </Text>
          </div>
          <div className="settings-toggle-row__actions">
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={handlePushSubscriptionToggle}
              disabled={pushUnavailable || pushSubscription.isLoading}
            >
              {pushUnavailable
                ? 'Push is not available in this browser'
                : pushSubscription.isLoading
                  ? 'Updating...'
                  : pushSubscription.isSubscribed
                    ? 'Unsubscribe'
                    : 'Subscribe'}
            </Button>
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={handleSendTest}
              disabled={testNotification.isSending}
            >
              {testNotification.isSending ? 'Sending...' : 'Send Test'}
            </Button>
          </div>
        </div>
        {pushUnavailable && (
          <Text size="sm" tone="muted" className="mt-2">
            Browser push is unavailable. In-app notifications still work.
          </Text>
        )}
        {pushSubscription.error !== null && (
          <Alert tone="danger" className="mt-2">
            {pushSubscription.error.message}
          </Alert>
        )}
        {testNotification.lastResult !== null && (
          <Alert
            tone={testNotification.lastResult.success ? 'success' : 'warning'}
            className="mt-2"
          >
            {testNotification.lastResult.message}
          </Alert>
        )}
        {testNotification.error !== null && (
          <Alert tone="danger" className="mt-2">
            {testNotification.error.message}
          </Alert>
        )}
      </section>

      {preferences.globalEnabled && (
        <>
          <section className="settings-notifications__section">
            <Heading as="h4" size="sm">
              Notification Types
            </Heading>
            <div className="settings-notifications__type-list">
              {NOTIFICATION_TYPES.map(({ key, label, description }) => {
                const typePref = preferences.types[key];
                const isEnabled = typePref.enabled;
                const channels = typePref.channels;

                return (
                  <div key={key} className="settings-toggle-card">
                    <div className="settings-toggle-row settings-toggle-row--compact">
                      <div className="settings-toggle-row__content">
                        <Text size="sm" className="font-medium">
                          {label}
                        </Text>
                        <Text size="sm" tone="muted">
                          {description}
                        </Text>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onChange={(checked: boolean) => {
                          handleTypeToggle(key, checked);
                        }}
                        disabled={isSaving}
                      />
                    </div>
                    {isEnabled && (
                      <div className="settings-channel-list">
                        {CHANNELS.map((channel) => (
                          <Checkbox
                            key={channel}
                            checked={channels.includes(channel)}
                            onChange={() => {
                              handleChannelToggle(key, channel, preferences);
                            }}
                            disabled={isSaving}
                            label={CHANNEL_LABELS[channel] ?? channel}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-notifications__section">
            <div className="settings-toggle-row">
              <div className="settings-toggle-row__content">
                <Heading as="h4" size="sm">
                  Quiet Hours
                </Heading>
                <Text size="sm" tone="muted">
                  Pause notifications during specific hours.
                </Text>
              </div>
              <Switch
                checked={preferences.quietHours.enabled}
                onChange={handleQuietHoursToggle}
                disabled={isSaving}
              />
            </div>
            {preferences.quietHours.enabled && (
              <div className="settings-quiet-hours">
                <div className="settings-quiet-hours__field">
                  <Text as="label" size="sm" tone="muted">
                    From (hour)
                  </Text>
                  <Input
                    value={String(preferences.quietHours.startHour)}
                    onChange={(e: { target: { value: string } }) => {
                      handleQuietHoursChange('startHour', e.target.value);
                    }}
                    className="settings-quiet-hours__input"
                    disabled={isSaving}
                  />
                </div>
                <div className="settings-quiet-hours__field">
                  <Text as="label" size="sm" tone="muted">
                    To (hour)
                  </Text>
                  <Input
                    value={String(preferences.quietHours.endHour)}
                    onChange={(e: { target: { value: string } }) => {
                      handleQuietHoursChange('endHour', e.target.value);
                    }}
                    className="settings-quiet-hours__input"
                    disabled={isSaving}
                  />
                </div>
                <Text size="sm" tone="muted" className="settings-quiet-hours__timezone">
                  ({preferences.quietHours.timezone})
                </Text>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
