// main/apps/web/src/app/dashboard/DashboardPage.tsx

import { useAuth, useProfileCompleteness, useSessions } from '@bslt/identity/web';
import { Link } from '@bslt/react/router';
import {
  Badge,
  Button,
  Card,
  Heading,
  Kbd,
  PageContainer,
  Progress,
  Skeleton,
  Text,
} from '@bslt/ui';
import { useCapabilities } from '@bslt/web-platform';
import { useMemo, useState } from 'react';

import {
  hasBillingModule,
  hasOrgsModule,
  useOptionalActiveOrg,
  useOptionalMyAvatar,
  useOptionalOrganizations,
  useOptionalSubscription,
} from '../../generated/modules';
import { openCommandPalette } from '../command-palette';
import { isChecklistDismissed, isOnboardingCompleted, setChecklistDismissed } from '../onboarding';
import { webApp } from '../webApp';

import './DashboardPage.css';

import type { Locale } from '#app/i18n';
import type { JSX } from 'react';

import { formatDate, useLocale } from '#app/i18n';

const getGreetingName = ({
  displayName,
  email,
  firstName,
}: {
  displayName: string;
  email: string | undefined;
  firstName: string;
}): string => {
  if (firstName.trim().length > 0) return firstName.trim();
  if (displayName.length > 0) return displayName;
  const emailPrefix = email?.split('@')[0];
  return emailPrefix !== undefined && emailPrefix.length > 0 ? emailPrefix : 'there';
};

const formatPercentage = (value: number): string => `${String(Math.round(value))}%`;

const formatDateShort = (value: string | null | undefined, locale: Locale): string => {
  if (typeof value !== 'string' || value.length === 0) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return formatDate(date, locale, { month: 'short', day: 'numeric' });
};

const getFallbackProfilePercent = ({
  hasAvatar,
  hasName,
}: {
  hasAvatar: boolean;
  hasName: boolean;
}): number => {
  if (hasName && hasAvatar) return 100;
  if (hasName || hasAvatar) return 72;
  return 48;
};

type BadgeTone = 'info' | 'success' | 'danger' | 'warning';

interface DashboardMetricCardProps {
  label: string;
  value: string;
  description: string;
  tone?: BadgeTone;
  loading?: boolean;
  href: string;
  actionLabel: string;
}

interface SurfaceRowProps {
  label: string;
  value: string;
  detail: string;
  tone?: BadgeTone;
}

const DashboardMetricCard = ({
  label,
  value,
  description,
  tone = 'info',
  loading = false,
  href,
  actionLabel,
}: DashboardMetricCardProps): JSX.Element => {
  return (
    <Card className="dashboard-card dashboard-card--metric">
      <div className="dashboard-card__topline">
        <Text tone="muted" size="sm" className="dashboard-card__label">
          {label}
        </Text>
        <Badge tone={tone}>{loading ? 'Loading' : 'Ready'}</Badge>
      </div>
      {loading ? (
        <Skeleton width="7rem" height="2rem" />
      ) : (
        <Heading as="p" size="lg" className="dashboard-card__value">
          {value}
        </Heading>
      )}
      <Text tone="muted" size="sm">
        {description}
      </Text>
      <Link to={href}>
        <Button variant="text" size="small">
          {actionLabel}
        </Button>
      </Link>
    </Card>
  );
};

const SurfaceRow = ({ label, value, detail, tone = 'info' }: SurfaceRowProps): JSX.Element => {
  return (
    <div className="dashboard-surface-row">
      <div className="dashboard-surface-row__copy">
        <Text size="sm" className="dashboard-surface-row__label">
          {label}
        </Text>
        <Text tone="muted" size="sm">
          {detail}
        </Text>
      </div>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
};

export const DashboardPage = (): JSX.Element => {
  const { user, isLoading } = useAuth();
  const locale = useLocale();
  const { isFlagEnabled } = useCapabilities();
  const teamsEnabled = hasOrgsModule && isFlagEnabled('orgs.teams');
  const billingEnabled = hasBillingModule && isFlagEnabled('flags.billing');
  const firstName = user?.firstName ?? '';
  const lastName = user?.lastName ?? '';
  const hasName = firstName.length > 0 || lastName.length > 0;
  const displayName = `${firstName} ${lastName}`.trim();
  const greetingName = getGreetingName({
    displayName,
    email: user?.email,
    firstName,
  });
  const myAvatar = useOptionalMyAvatar({ enabled: user !== null && !isLoading });
  const hasAvatar = myAvatar.avatarUrl !== null;
  const profileReady = hasName && hasAvatar;
  const username = user?.username?.trim() ?? '';
  const hasUsername = username.length > 0;
  const { activeOrgId } = useOptionalActiveOrg();
  const { organizations } = useOptionalOrganizations({
    enabled: teamsEnabled && user !== null && !isLoading,
  });
  const activeOrg = useMemo(() => {
    if (!teamsEnabled || organizations.length === 0) return null;
    if (activeOrgId !== null) {
      return organizations.find((org) => org.id === activeOrgId) ?? organizations[0] ?? null;
    }
    return organizations[0] ?? null;
  }, [activeOrgId, organizations, teamsEnabled]);
  const { subscription } = useOptionalSubscription({
    enabled: billingEnabled && user !== null && !isLoading,
  });
  const [checklistDismissed, setDismissedState] = useState<boolean>(() =>
    isChecklistDismissed(user?.id),
  );
  const onboardingDone = isOnboardingCompleted(user?.id);
  const {
    data: profileCompleteness,
    isLoading: profileCompletenessLoading,
    isError: profileCompletenessError,
  } = useProfileCompleteness();
  const { sessions, isLoading: sessionsLoading, isError: sessionsError } = useSessions();

  const profilePercent =
    profileCompleteness?.percentage ?? getFallbackProfilePercent({ hasAvatar, hasName });
  const missingProfileFields = profileCompleteness?.missingFields.length ?? (profileReady ? 0 : 1);
  const currentSession = sessions.find((session) => session.isCurrent) ?? null;

  const activePlanLabel =
    subscription?.status === 'active' || subscription?.status === 'trialing'
      ? subscription.plan.name
      : 'Free';
  const showUpgradeCta =
    billingEnabled && subscription?.status !== 'active' && subscription?.status !== 'trialing';

  const checklistItems = useMemo(
    () => [
      {
        id: 'profile',
        label: 'Complete your profile name',
        detail: hasName ? 'Profile display name is configured.' : 'Add your first and last name.',
        done: hasName,
        to: '/profile',
      },
      {
        id: 'email',
        label: 'Verify your email address',
        detail:
          user?.emailVerified === true
            ? 'Email address is verified.'
            : 'Confirm your email for account recovery and notifications.',
        done: user?.emailVerified === true,
        to: '/settings/security',
      },
      {
        id: 'onboarding',
        label: 'Run workspace setup wizard',
        detail: onboardingDone
          ? 'Initial workspace setup completed.'
          : 'Walk through profile, workspace branding, and team invites.',
        done: onboardingDone,
        to: '/onboarding',
      },
      ...(teamsEnabled
        ? [
            {
              id: 'workspace',
              label: 'Configure your team workspace',
              detail:
                activeOrg !== null
                  ? `Active workspace: ${activeOrg.name}`
                  : 'Create or switch into a shared team workspace.',
              done: activeOrg !== null,
              to: '/workspace',
            },
          ]
        : []),
    ],
    [activeOrg, hasName, onboardingDone, teamsEnabled, user?.emailVerified],
  );
  const completedChecklistCount = checklistItems.filter((item) => item.done).length;
  const checklistPercent =
    checklistItems.length > 0
      ? Math.round((completedChecklistCount / checklistItems.length) * 100)
      : 100;

  const handleDismissChecklist = (): void => {
    setChecklistDismissed(user?.id, true);
    setDismissedState(true);
  };

  if (isLoading) {
    return (
      <PageContainer className="dashboard-page" maxWidth={1180}>
        <div className="dashboard-loading">
          <Skeleton width="14rem" height="2rem" />
          <Skeleton width="100%" height="8rem" radius="var(--ui-radius-md)" />
          <div className="dashboard-metrics">
            <Skeleton width="100%" height="9rem" radius="var(--ui-radius-md)" />
            <Skeleton width="100%" height="9rem" radius="var(--ui-radius-md)" />
            <Skeleton width="100%" height="9rem" radius="var(--ui-radius-md)" />
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="dashboard-page" maxWidth={1180}>
      <section className="dashboard-command">
        <div className="dashboard-command__main">
          <div className="dashboard-command__identity">
            <div className="dashboard-command__workspace-row">
              <Heading as="h1" size="xl">
                Dashboard
              </Heading>
              {activeOrg !== null ? <Badge tone="info">{activeOrg.name}</Badge> : null}
              {billingEnabled ? (
                <Badge tone={showUpgradeCta ? 'neutral' : 'premium'}>{activePlanLabel}</Badge>
              ) : null}
            </div>
            <Text tone="muted" size="sm" className="dashboard-page__subtitle">
              Welcome back, {greetingName}.
            </Text>
          </div>
          <div className="dashboard-command__actions">
            {showUpgradeCta ? (
              <Link to="/pricing">
                <Button variant="primary" size="small">
                  Upgrade plan
                </Button>
              </Link>
            ) : null}
            {activeOrg !== null ? (
              <Link to="/workspace">
                <Button variant="secondary" size="small">
                  Workspace
                </Button>
              </Link>
            ) : null}
            {webApp.dashboardQuickActions.map((action) => (
              <Link key={action.to} to={action.to}>
                <Button variant="secondary" size="small">
                  {action.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
        <div className="dashboard-command__status">
          <div className="dashboard-command__score">
            <div className="dashboard-command__score-header">
              <Text size="sm" tone="muted">
                Account readiness
              </Text>
              <Text size="sm" className="font-medium">
                {formatPercentage(profilePercent)}
              </Text>
            </div>
            <Progress value={profilePercent} aria-label="Account readiness" />
          </div>
          <div className="dashboard-command__issue">
            <Badge
              tone={
                profileCompletenessError || sessionsError
                  ? 'warning'
                  : profilePercent >= 85
                    ? 'success'
                    : 'info'
              }
            >
              {profileCompletenessError || sessionsError ? 'Review' : 'Active'}
            </Badge>
            <Text tone="muted" size="sm">
              Profile and session basics are available.
            </Text>
          </div>
        </div>
      </section>

      <div className="dashboard-metrics">
        {teamsEnabled ? (
          <DashboardMetricCard
            label="Workspace"
            value={activeOrg !== null ? activeOrg.name : 'Personal'}
            description={
              organizations.length > 0
                ? `${String(organizations.length)} active workspace${organizations.length === 1 ? '' : 's'} available.`
                : 'Create a shared workspace to collaborate with teammates.'
            }
            tone={activeOrg !== null ? 'success' : 'info'}
            href="/workspace"
            actionLabel="Manage workspace"
          />
        ) : null}

        {billingEnabled ? (
          <DashboardMetricCard
            label="Plan & Billing"
            value={activePlanLabel}
            description={
              subscription?.status === 'active'
                ? 'Subscription is active and synced to your workspace.'
                : subscription?.status === 'trialing'
                  ? 'Free trial active — review billing before renewal.'
                  : 'Starter tier active. Upgrade anytime for higher quotas.'
            }
            tone={showUpgradeCta ? 'info' : 'success'}
            href={showUpgradeCta ? '/pricing' : '/workspace/billing'}
            actionLabel={showUpgradeCta ? 'Compare plans' : 'Manage billing'}
          />
        ) : null}

        <DashboardMetricCard
          label="Profile"
          value={formatPercentage(profilePercent)}
          description={
            missingProfileFields === 0
              ? 'Profile details are complete.'
              : `${String(missingProfileFields)} profile field${
                  missingProfileFields === 1 ? '' : 's'
                } still ${missingProfileFields === 1 ? 'needs' : 'need'} attention.`
          }
          tone={profilePercent >= 85 ? 'success' : profilePercent >= 60 ? 'warning' : 'danger'}
          loading={profileCompletenessLoading}
          href="/profile"
          actionLabel="View profile"
        />

        <DashboardMetricCard
          label="Sessions"
          value={
            sessionsError
              ? 'Review'
              : sessionsLoading
                ? 'Checking'
                : `${String(sessions.length)} session${sessions.length === 1 ? '' : 's'}`
          }
          description={
            currentSession !== null
              ? `Current session last used ${formatDateShort(currentSession.lastUsedAt, locale)}.`
              : 'Session details are not available yet.'
          }
          tone={sessionsError ? 'warning' : 'success'}
          loading={sessionsLoading}
          href="/settings/sessions"
          actionLabel="Manage sessions"
        />

        {webApp.dashboardTiles.map((tile) => (
          <DashboardMetricCard
            key={tile.id}
            label={tile.label}
            value={tile.value}
            description={tile.description}
            tone="info"
            href={tile.href}
            actionLabel={tile.actionLabel}
          />
        ))}
      </div>

      {!checklistDismissed && completedChecklistCount < checklistItems.length ? (
        <Card className="dashboard-checklist">
          <div className="dashboard-checklist__header">
            <div>
              <Heading as="h2" size="sm">
                Workspace Setup Checklist
              </Heading>
              <Text tone="muted" size="sm">
                {String(completedChecklistCount)} of {String(checklistItems.length)} steps complete.
              </Text>
            </div>
            <Button type="button" variant="text" size="small" onClick={handleDismissChecklist}>
              Dismiss
            </Button>
          </div>
          <div className="dashboard-checklist__progress">
            <Progress value={checklistPercent} aria-label="Setup checklist progress" />
          </div>
          <div className="dashboard-checklist__list">
            {checklistItems.map((item) => (
              <Link key={item.id} to={item.to} className="dashboard-checklist__item">
                <div className="dashboard-surface-row__copy">
                  <Text as="span" size="sm" className="dashboard-surface-row__label">
                    {item.label}
                  </Text>
                  <Text as="span" tone="muted" size="sm">
                    {item.detail}
                  </Text>
                </div>
                <Badge tone={item.done ? 'success' : 'info'}>{item.done ? 'Done' : 'Start'}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="dashboard-content-grid">
        <Card className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <Heading as="h2" size="sm">
                Account
              </Heading>
              <Text tone="muted" size="sm">
                Profile and access details for the signed-in user.
              </Text>
            </div>
            <Link to="/settings">
              <Button variant="text" size="small">
                Settings
              </Button>
            </Link>
          </div>
          <div className="dashboard-profile-list">
            <SurfaceRow
              label="Email"
              value={user?.emailVerified === true ? 'Verified' : 'Check'}
              detail={user?.email ?? 'No email on file'}
              tone={user?.emailVerified === true ? 'success' : 'warning'}
            />
            <SurfaceRow
              label="Name"
              value={hasName ? 'Set' : 'Missing'}
              detail={hasName ? displayName : 'Not provided'}
              tone={hasName ? 'success' : 'warning'}
            />
            <SurfaceRow
              label="Username"
              value={hasUsername ? 'Set' : 'Missing'}
              detail={hasUsername ? `@${username}` : 'Not provided'}
              tone={hasUsername ? 'success' : 'warning'}
            />
            <SurfaceRow
              label="User ID"
              value="Linked"
              detail={user?.id ?? 'No user id available'}
              tone="info"
            />
          </div>
        </Card>

        <Card className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <Heading as="h2" size="sm">
                Security &amp; Shortcuts
              </Heading>
              <Text tone="muted" size="sm">
                Jump directly to account controls or open the command palette.
              </Text>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="small"
              title="Open command palette (⌘K)"
              onClick={openCommandPalette}
            >
              <span>Jump to…</span>
              <Kbd aria-hidden="true">⌘K</Kbd>
            </Button>
          </div>
          <div className="dashboard-shortcuts">
            <Link to="/settings/security" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  Security &amp; Sign-in
                </Text>
                <Text as="span" tone="muted" size="sm">
                  Password, passkeys, 2FA, and connected sign-in methods.
                </Text>
              </div>
              <Badge tone="info">Manage</Badge>
            </Link>
            <Link to="/settings/api-keys" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  Personal API Keys
                </Text>
                <Text as="span" tone="muted" size="sm">
                  Create, inspect, and revoke programmatic access tokens.
                </Text>
              </div>
              <Badge tone="info">Keys</Badge>
            </Link>
            <Link to="/settings/data-controls" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  Data Controls &amp; Privacy
                </Text>
                <Text as="span" tone="muted" size="sm">
                  Consent preferences, GDPR exports, and age assurance.
                </Text>
              </div>
              <Badge tone="info">Privacy</Badge>
            </Link>
            <Link to="/settings/preferences" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  Preferences
                </Text>
                <Text as="span" tone="muted" size="sm">
                  Appearance theme, timezone, and display language.
                </Text>
              </div>
              <Badge tone="info">Theme</Badge>
            </Link>
            <Link to="/docs" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  App Guide &amp; Docs
                </Text>
                <Text as="span" tone="muted" size="sm">
                  Tour every space, module, and live route inside this app.
                </Text>
              </div>
              <Badge tone="info">Guide</Badge>
            </Link>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
};
