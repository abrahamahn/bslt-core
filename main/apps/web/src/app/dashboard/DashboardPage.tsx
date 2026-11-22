// main/apps/web/src/app/dashboard/DashboardPage.tsx

import { useAuth, useProfileCompleteness, useSessions } from '@bslt/identity/web';
import { Link } from '@bslt/react/router';
import { Badge, Button, Card, Heading, PageContainer, Progress, Skeleton, Text } from '@bslt/ui';

import { useOptionalMyAvatar } from '../../generated/modules';
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
          <div>
            <Heading as="h1" size="xl">
              Dashboard
            </Heading>
            <Text tone="muted" size="sm" className="dashboard-page__subtitle">
              Welcome back, {greetingName}.
            </Text>
          </div>
          <div className="dashboard-command__actions">
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
          href="/settings/security"
          actionLabel="Open security"
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
      </div>
    </PageContainer>
  );
};
