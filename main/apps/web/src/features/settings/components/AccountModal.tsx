// main/apps/web/src/features/settings/components/AccountModal.tsx
/**
 * Account modal — the unified Profile + Settings surface.
 *
 * A single large modal with a left sidebar of sections (Profile, Security, …)
 * and a content panel, replacing the old standalone /settings and /profile
 * pages. Opened by the header avatar menu or by the URL-preserving route stubs
 * (deep links like /settings?tab=security still work). Section state lives in
 * the account-modal store; only the billing entry navigates (it is a real page).
 */

import { getAccessToken } from '@app/authToken';
import { isAdvancedAuthEnabled, isBillingEnabled } from '@app/capabilities';
import { useClientEnvironment } from '@app/ClientEnvironment';
import { useAuth } from '@auth/hooks';
import { useLocation, useNavigate } from '@bslt/react/router';
import { getAccountStatus } from '@bslt/shared/core/users';
import { Alert, Button, Heading, Modal, Skeleton, Text } from '@bslt/ui';
import {
  currentUserProfileQueryKey,
  profileCompletenessQueryKey,
} from '@features/profile/queryKeys';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  closeAccountModal,
  setAccountModalSection,
  useAccountModal,
  type AccountModalSection,
} from '../accountModalStore';
import { getSettingsNavItems, normalizeSettingsTab, type SettingsTabId } from '../settingsTabs';

import './AccountModal.css';

import {
  ApiKeysSection,
  AvatarUpload,
  BackupCodesDisplay,
  DangerZone,
  DataControlsSection,
  DevicesList,
  EmailChangeForm,
  ForgotPasswordShortcut,
  LegalDocumentsSection,
  NotificationPreferencesForm,
  OAuthConnectionsList,
  PasskeyManagement,
  PasswordChangeForm,
  PasswordSetupForm,
  PhoneManagement,
  PreferencesSection,
  ProfileCompleteness,
  ProfileForm,
  SessionsList,
  TotpManagement,
  UsernameForm,
} from './index';

import type { User } from '@bslt/shared/core/users';

// ============================================================================
// Section scaffolding
// ============================================================================

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

// ============================================================================
// Section content
// ============================================================================

const ProfileTab = ({
  onProfileSaved,
  user,
}: {
  onProfileSaved: () => void;
  user: User;
}): ReactElement => {
  const displayName = `${user.firstName} ${user.lastName}`.trim();
  // Success feedback lives here, not in ProfileForm: saving refreshes the user,
  // which changes ProfileForm's key and remounts it, wiping its local state.
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

      <SettingsSection title="Avatar">
        <AvatarUpload
          currentAvatarUrl={user.avatarUrl ?? null}
          userName={displayName}
          onSuccess={onProfileSaved}
        />
      </SettingsSection>

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
      <NotificationPreferencesForm />
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

// ============================================================================
// Account modal
// ============================================================================

export const AccountModal = (): ReactElement | null => {
  const { open, section } = useAccountModal();
  // The closed modal renders nothing and must not require any app context —
  // it is mounted unconditionally in AppLayout.
  if (!open) return null;
  return <AccountModalBody section={section} />;
};

const AccountModalBody = ({ section }: { section: AccountModalSection }): ReactElement => {
  const { auth, config, queryCache } = useClientEnvironment();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const advancedAuthEnabled = isAdvancedAuthEnabled();
  const billingEnabled = isBillingEnabled();

  const onAccountSurface = pathname === '/profile' || pathname.startsWith('/settings');

  const handleClose = useCallback((): void => {
    closeAccountModal();
    // Deep-link stubs keep the /settings or /profile URL while the modal is
    // open; don't strand the user on an empty stub after closing.
    if (onAccountSurface) navigate('/dashboard');
  }, [navigate, onAccountSurface]);

  const handleSelect = useCallback(
    (tabId: SettingsTabId): void => {
      if (tabId === 'billing') {
        if (!billingEnabled) return;
        closeAccountModal();
        navigate('/settings/billing');
        return;
      }
      setAccountModalSection(tabId);
      // Keep the URL truthful while on the settings surface so refresh and
      // share/bookmark land on the same section.
      if (pathname.startsWith('/settings') || pathname === '/profile') {
        navigate(`/settings?tab=${encodeURIComponent(tabId)}`, { replace: true });
      }
    },
    [billingEnabled, navigate, pathname],
  );

  const refreshProfileFromServer = useCallback((): void => {
    queryCache.invalidateQuery(['user', 'me']);
    queryCache.invalidateQuery(currentUserProfileQueryKey);
    queryCache.invalidateQuery(profileCompletenessQueryKey);
    queryCache.invalidateQuery(['users']);
    void auth.fetchCurrentUser().catch(() => {
      // Keep the form success state visible; the next navigation/focus can retry.
    });
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
    }
  }, [advancedAuthEnabled, config.apiUrl, refreshProfileFromServer, section, user]);

  const navItems = useMemo(() => getSettingsNavItems({ billingEnabled }), [billingEnabled]);
  const activeLabel = navItems.find((item) => item.id === section)?.label ?? 'Settings';

  return (
    <Modal.Root open onClose={handleClose} size="xl" heightMode="tall">
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
                    const tab = normalizeSettingsTab(item.id);
                    if (tab !== null) handleSelect(tab);
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
    </Modal.Root>
  );
};
