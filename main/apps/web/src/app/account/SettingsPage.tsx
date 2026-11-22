// main/apps/web/src/app/account/SettingsPage.tsx
import { DataControlsSection, LegalDocumentsSection } from '@bslt/compliance/web';
import { getAccountStatus, type User } from '@bslt/identity/contract';
import {
  ApiKeysSection,
  BackupCodesDisplay,
  DangerZone,
  DevicesList,
  EmailChangeForm,
  ForgotPasswordShortcut,
  identityMeQueryKey,
  identityProfileCompletenessQueryKey,
  OAuthConnectionsList,
  PasskeyManagement,
  PasswordChangeForm,
  PasswordSetupForm,
  PhoneManagement,
  ProfileCompleteness,
  ProfileForm,
  SessionsList,
  TotpManagement,
  useAuth,
  UsernameForm,
} from '@bslt/identity/web';
import { useLocation, useNavigate } from '@bslt/react/router';
import { Alert, Heading, Skeleton, Text } from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  hasBillingModule,
  hasFilesModule,
  OptionalAvatarUpload,
  OptionalNotificationPreferencesForm,
} from '../../generated/modules';
import { getAccessToken } from '../authToken';
import { useClientEnvironment } from '../ClientEnvironment';

import { PreferencesSection } from './PreferencesSection';
import { SettingsLayout } from './SettingsLayout';
import { getActiveSettingsTab, getSettingsNavItems } from './settingsTabs';

type SettingsSectionProps = {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  title: string;
};

const SettingsSection = ({
  action,
  children,
  className,
  description,
  title,
}: SettingsSectionProps): ReactElement => {
  const sectionClassName = `settings-section${className !== undefined ? ` ${className}` : ''}`;

  return (
    <section className={sectionClassName}>
      <div className="settings-section__header">
        <div className="settings-section__title-block">
          <Heading as="h3" size="md">
            {title}
          </Heading>
          {description !== undefined ? (
            <Text tone="muted" size="sm" className="settings-section__description">
              {description}
            </Text>
          ) : null}
        </div>
        {action !== undefined ? <div className="settings-section__action">{action}</div> : null}
      </div>
      <div className="settings-section__body">{children}</div>
    </section>
  );
};

const SettingsTabIntro = ({
  description,
  title,
}: {
  description: string;
  title: string;
}): ReactElement => (
  <div className="settings-tab-intro">
    <Heading as="h2" size="lg">
      {title}
    </Heading>
    <Text tone="muted" size="sm" className="settings-tab-intro__description">
      {description}
    </Text>
  </div>
);

const ProfileTab = ({
  onProfileSaved,
  user,
}: {
  onProfileSaved: () => void;
  user: User;
}): ReactElement => {
  const displayName = `${user.firstName} ${user.lastName}`.trim();
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    if (!profileSaved) return;
    const timer = setTimeout(() => {
      setProfileSaved(false);
    }, 3000);
    return () => {
      clearTimeout(timer);
    };
  }, [profileSaved]);

  const handleProfileSaved = (): void => {
    setProfileSaved(true);
    onProfileSaved();
  };

  return (
    <div className="settings-stack">
      <ProfileCompleteness className="mb-6" />

      {hasFilesModule ? (
        <SettingsSection title="Avatar">
          <OptionalAvatarUpload userName={displayName} onSuccess={onProfileSaved} />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Username">
        <UsernameForm currentUsername={user.username} onSuccess={onProfileSaved} />
      </SettingsSection>

      <SettingsSection title="Profile Information">
        {profileSaved ? <Alert tone="success">Profile updated successfully</Alert> : null}
        <ProfileForm
          key={`${user.id}-${user.updatedAt}`}
          user={user}
          onSuccess={handleProfileSaved}
        />
      </SettingsSection>
    </div>
  );
};

const SecurityTab = ({
  advancedAuthEnabled,
  apiUrl,
  user,
}: {
  advancedAuthEnabled: boolean;
  apiUrl: string;
  user: User;
}): ReactElement => {
  return (
    <div className="settings-stack">
      {advancedAuthEnabled ? (
        <>
          <SettingsSection title="Passkeys">
            <PasskeyManagement />
          </SettingsSection>

          <SettingsSection title="Two-Factor Authentication">
            <TotpManagement />
          </SettingsSection>

          <SettingsSection
            title="Backup Codes"
            description="Backup codes provide account recovery when your authenticator is unavailable."
          >
            <BackupCodesDisplay />
          </SettingsSection>

          <SettingsSection title="SMS Authentication">
            <PhoneManagement user={user} baseUrl={apiUrl} getToken={getAccessToken} />
          </SettingsSection>
        </>
      ) : null}

      <SettingsSection title="Change Password">
        <PasswordChangeForm />
        <div className="settings-section__secondary-action">
          <ForgotPasswordShortcut email={user.email} />
        </div>
      </SettingsSection>

      {advancedAuthEnabled ? (
        <SettingsSection title="Set Password">
          <PasswordSetupForm />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Change Email">
        <EmailChangeForm />
      </SettingsSection>

      {advancedAuthEnabled ? (
        <SettingsSection title="Connected Accounts">
          <OAuthConnectionsList />
        </SettingsSection>
      ) : null}
    </div>
  );
};

const SessionsTab = ({ apiUrl }: { apiUrl: string }): ReactElement => {
  return (
    <div className="settings-stack">
      <SettingsSection
        title="Active Sessions"
        description="Manage your active sessions across devices. Revoking a session will log you out from that device."
      >
        <SessionsList />
      </SettingsSection>

      <SettingsSection title="Trusted Devices">
        <DevicesList baseUrl={apiUrl} getToken={getAccessToken} />
      </SettingsSection>
    </div>
  );
};

const NotificationsTab = (): ReactElement => {
  return (
    <SettingsSection
      title="Notification Preferences"
      description="Control how and when you receive notifications."
    >
      <OptionalNotificationPreferencesForm />
    </SettingsSection>
  );
};

const toLifecycleDate = (value: string | null | undefined): Date | null =>
  value != null ? new Date(value) : null;

const AccountTab = (): ReactElement => {
  const { user, reloadUser } = useAuth();
  const accountStatus =
    user !== null
      ? getAccountStatus({
          deactivatedAt: toLifecycleDate(user.deactivatedAt),
          deletedAt: toLifecycleDate(user.deletedAt),
          deletionGracePeriodEnds: toLifecycleDate(user.deletionGracePeriodEnds),
        })
      : 'active';

  return (
    <div className="settings-stack">
      <SettingsTabIntro
        title="Account Management"
        description="Manage your account status. Destructive actions require password confirmation."
      />
      <DangerZone
        accountStatus={accountStatus}
        gracePeriodEnds={user?.deletionGracePeriodEnds ?? undefined}
        onActionComplete={() => {
          void reloadUser();
        }}
      />
    </div>
  );
};

const LegalTab = (): ReactElement => {
  return (
    <SettingsSection
      title="Legal"
      description="Review current documents and your account agreements."
    >
      <LegalDocumentsSection />
    </SettingsSection>
  );
};

const SettingsPanelContent = ({ section }: { readonly section: string }): ReactElement => {
  const { auth, config, queryCache } = useClientEnvironment();
  const { user } = useAuth();
  const { hasAuthStrategy } = useCapabilities();
  const advancedAuthEnabled = hasAuthStrategy('magic');

  const refreshProfileFromServer = useCallback((): void => {
    queryCache.invalidateQuery(['user', 'me']);
    queryCache.invalidateQuery(identityMeQueryKey);
    queryCache.invalidateQuery(identityProfileCompletenessQueryKey);
    queryCache.invalidateQuery(['users']);
    void auth.fetchCurrentUser().catch(() => null);
  }, [auth, queryCache]);

  const content = useMemo((): ReactNode => {
    if (user === null) {
      return (
        <div className="settings-stack" aria-label="Loading settings">
          <Skeleton height="1.5rem" width="8rem" />
          <Skeleton height="12rem" className="w-full rounded-md" />
        </div>
      );
    }
    switch (section) {
      case 'profile':
        return <ProfileTab user={user} onProfileSaved={refreshProfileFromServer} />;
      case 'security':
        return (
          <SecurityTab
            advancedAuthEnabled={advancedAuthEnabled}
            apiUrl={config.apiUrl}
            user={user}
          />
        );
      case 'sessions':
        return <SessionsTab apiUrl={config.apiUrl} />;
      case 'notifications':
        return <NotificationsTab />;
      case 'preferences':
        return (
          <SettingsSection
            title="Theme"
            description="Customize the application appearance, plus timezone and language."
          >
            <PreferencesSection />
          </SettingsSection>
        );
      case 'account':
        return <AccountTab />;
      case 'data-controls':
        return (
          <SettingsSection
            title="Data Controls"
            description="Manage your account status and personal data."
          >
            <DataControlsSection />
          </SettingsSection>
        );
      case 'api-keys':
        return (
          <SettingsSection
            title="API Keys"
            description="Create and revoke personal API keys for programmatic access to your account."
          >
            <ApiKeysSection />
          </SettingsSection>
        );
      case 'legal':
        return <LegalTab />;
      default:
        return <ProfileTab user={user} onProfileSaved={refreshProfileFromServer} />;
    }
  }, [advancedAuthEnabled, config.apiUrl, refreshProfileFromServer, section, user]);

  return <SettingsLayout activeSection={section}>{content}</SettingsLayout>;
};

export const SettingsPage = (): ReactElement => {
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const { isFlagEnabled, status } = useCapabilities();
  const billingEnabled = isFlagEnabled('flags.billing');

  const section = getActiveSettingsTab({ hash, pathname, search });
  const matched = useMemo(
    () => getSettingsNavItems({ billingEnabled }).find((item) => item.id === section),
    [billingEnabled, section],
  );
  const isRouteRedirect =
    section === 'billing' || (matched?.kind === 'route' && matched.to !== undefined);

  useEffect(() => {
    if (section === 'billing') {
      if (status === 'loading') return;
      navigate(hasBillingModule && billingEnabled ? '/settings/billing' : '/settings', {
        replace: true,
      });
      return;
    }
    if (matched?.kind === 'route' && matched.to !== undefined) {
      navigate(matched.to, { replace: true });
    }
  }, [billingEnabled, matched, navigate, section, status]);

  if (isRouteRedirect) {
    return (
      <SettingsLayout activeSection={section}>
        <div className="settings-stack" aria-label="Loading settings">
          <Skeleton height="1.5rem" width="8rem" />
          <Skeleton height="12rem" className="w-full rounded-md" />
        </div>
      </SettingsLayout>
    );
  }

  return <SettingsPanelContent section={section} />;
};

export const ProfilePage = (): ReactElement => <SettingsPanelContent section="profile" />;
