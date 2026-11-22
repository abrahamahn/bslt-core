// main/apps/web/src/app/account/AccountModal.tsx
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
import { Alert, Button, Dialog, Heading, Skeleton, Text } from '@bslt/ui';
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
  hasFilesModule,
  OptionalAvatarUpload,
  OptionalNotificationPreferencesForm,
} from '../../generated/modules';
import { getAccessToken } from '../authToken';
import { useClientEnvironment } from '../ClientEnvironment';

import {
  closeAccountModal,
  isAccountModalSection,
  setAccountModalSection,
  useAccountModal,
  type AccountModalSection,
} from './accountModalStore';
import { PreferencesSection } from './PreferencesSection';
import { getSettingsNavItems, type SettingsNavItem } from './settingsTabs';

import './AccountModal.css';

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

export const AccountModal = (): ReactElement | null => {
  const { open, section } = useAccountModal();
  if (!open) return null;
  return <AccountModalBody section={section} />;
};

const AccountModalBody = ({ section }: { section: AccountModalSection }): ReactElement => {
  const { auth, config, queryCache } = useClientEnvironment();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { hasAuthStrategy, isFlagEnabled } = useCapabilities();
  const advancedAuthEnabled = hasAuthStrategy('magic');
  const billingEnabled = isFlagEnabled('flags.billing');

  const onAccountSurface = pathname === '/profile' || pathname.startsWith('/settings');

  const handleClose = useCallback((): void => {
    closeAccountModal();
    if (onAccountSurface) navigate('/dashboard');
  }, [navigate, onAccountSurface]);

  const handleSelect = useCallback(
    (item: SettingsNavItem): void => {
      if (item.kind === 'route' && item.to !== undefined) {
        if (item.id === 'billing' && !billingEnabled) return;
        closeAccountModal();
        navigate(item.to);
        return;
      }
      if (!isAccountModalSection(item.id)) return;
      setAccountModalSection(item.id);
      if (pathname.startsWith('/settings') || pathname === '/profile') {
        navigate(`/settings?tab=${encodeURIComponent(item.id)}`, { replace: true });
      }
    },
    [billingEnabled, navigate, pathname],
  );

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
        return null;
    }
  }, [advancedAuthEnabled, config.apiUrl, refreshProfileFromServer, section, user]);

  const navItems = useMemo(() => getSettingsNavItems({ billingEnabled }), [billingEnabled]);
  const activeLabel = navItems.find((item) => item.id === section)?.label ?? 'Settings';

  return (
    <Dialog.Root open onClose={handleClose} size="xl" heightMode="tall">
      <div className="account-modal">
        <aside className="account-modal__sidebar" aria-label="Settings control center">
          <div className="account-modal__sidebar-header">
            <Heading as="h2" size="md">
              Settings
            </Heading>
            <Text size="xs" tone="muted">
              Control Center
            </Text>
          </div>
          <nav className="account-modal__nav" aria-label="Settings sections">
            {navItems.map((item) => {
              const isActive = item.id === section;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant={isActive ? 'secondary' : 'text'}
                  className="account-modal__nav-button"
                  aria-current={isActive ? 'page' : undefined}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => {
                    handleSelect(item);
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </nav>
        </aside>
        <div className="account-modal__main settings-page">
          <div
            id={`settings-panel-${section}`}
            className="settings-page__content-panel"
            role="tabpanel"
            tabIndex={0}
            data-active-tab={section}
            aria-label={`${activeLabel} settings`}
          >
            {content}
          </div>
        </div>
      </div>
    </Dialog.Root>
  );
};
