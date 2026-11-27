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

import { formatDate } from '#app/i18n';
import { useChromeTranslation } from '#app/i18n/chromeLabels';

const getGreetingName = ({
  displayName,
  email,
  fallback,
  firstName,
}: {
  displayName: string;
  email: string | undefined;
  fallback: string;
  firstName: string;
}): string => {
  if (firstName.trim().length > 0) return firstName.trim();
  if (displayName.length > 0) return displayName;
  const emailPrefix = email?.split('@')[0];
  return emailPrefix !== undefined && emailPrefix.length > 0 ? emailPrefix : fallback;
};

const formatPercentage = (value: number): string => `${String(Math.round(value))}%`;

const formatDateShort = (
  value: string | null | undefined,
  locale: Locale,
  fallback: string,
): string => {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
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
  statusLabel: string;
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
  statusLabel,
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
        <Badge tone={tone}>{statusLabel}</Badge>
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
  const { locale, t, translateDashboardAction, translateDashboardTile } = useChromeTranslation();
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
    fallback: t('dashboard.greetingFallback'),
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
      : t('dashboard.plan.free');
  const showUpgradeCta =
    billingEnabled && subscription?.status !== 'active' && subscription?.status !== 'trialing';

  const checklistItems = useMemo(
    () => [
      {
        id: 'profile',
        label: t('dashboard.checklist.profileLabel'),
        detail: hasName
          ? t('dashboard.checklist.profileDone')
          : t('dashboard.checklist.profileTodo'),
        done: hasName,
        to: '/profile',
      },
      {
        id: 'email',
        label: t('dashboard.checklist.emailLabel'),
        detail:
          user?.emailVerified === true
            ? t('dashboard.checklist.emailDone')
            : t('dashboard.checklist.emailTodo'),
        done: user?.emailVerified === true,
        to: '/settings/security',
      },
      {
        id: 'onboarding',
        label: t('dashboard.checklist.onboardingLabel'),
        detail: onboardingDone
          ? t('dashboard.checklist.onboardingDone')
          : t('dashboard.checklist.onboardingTodo'),
        done: onboardingDone,
        to: '/onboarding',
      },
      ...(teamsEnabled
        ? [
            {
              id: 'workspace',
              label: t('dashboard.checklist.workspaceLabel'),
              detail:
                activeOrg !== null
                  ? t('dashboard.checklist.workspaceDone', { name: activeOrg.name })
                  : t('dashboard.checklist.workspaceTodo'),
              done: activeOrg !== null,
              to: '/workspace',
            },
          ]
        : []),
    ],
    [activeOrg, hasName, onboardingDone, t, teamsEnabled, user?.emailVerified],
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

  const readyLabel = t('dashboard.status.ready');
  const loadingLabel = t('dashboard.status.loading');

  return (
    <PageContainer className="dashboard-page" maxWidth={1180}>
      <section className="dashboard-command">
        <div className="dashboard-command__main">
          <div className="dashboard-command__identity">
            <div className="dashboard-command__workspace-row">
              <Heading as="h1" size="xl">
                {t('dashboard.title')}
              </Heading>
              {activeOrg !== null ? <Badge tone="info">{activeOrg.name}</Badge> : null}
              {billingEnabled ? (
                <Badge tone={showUpgradeCta ? 'neutral' : 'premium'}>{activePlanLabel}</Badge>
              ) : null}
            </div>
            <Text tone="muted" size="sm" className="dashboard-page__subtitle">
              {t('dashboard.welcome', { name: greetingName })}
            </Text>
          </div>
          <div className="dashboard-command__actions">
            {showUpgradeCta ? (
              <Link to="/pricing">
                <Button variant="primary" size="small">
                  {t('dashboard.action.upgradePlan')}
                </Button>
              </Link>
            ) : null}
            {activeOrg !== null ? (
              <Link to="/workspace">
                <Button variant="secondary" size="small">
                  {t('dashboard.action.workspace')}
                </Button>
              </Link>
            ) : null}
            {webApp.dashboardQuickActions.map((action) => (
              <Link key={action.to} to={action.to}>
                <Button variant="secondary" size="small">
                  {translateDashboardAction(action.to, action.label)}
                </Button>
              </Link>
            ))}
          </div>
        </div>
        <div className="dashboard-command__status">
          <div className="dashboard-command__score">
            <div className="dashboard-command__score-header">
              <Text size="sm" tone="muted">
                {t('dashboard.readiness.label')}
              </Text>
              <Text size="sm" className="font-medium">
                {formatPercentage(profilePercent)}
              </Text>
            </div>
            <Progress value={profilePercent} aria-label={t('dashboard.readiness.label')} />
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
              {profileCompletenessError || sessionsError
                ? t('dashboard.status.review')
                : t('dashboard.status.active')}
            </Badge>
            <Text tone="muted" size="sm">
              {t('dashboard.readiness.summary')}
            </Text>
          </div>
        </div>
      </section>

      <div className="dashboard-metrics">
        {teamsEnabled ? (
          <DashboardMetricCard
            label={t('dashboard.metric.workspace.label')}
            value={activeOrg !== null ? activeOrg.name : t('dashboard.metric.workspace.personal')}
            description={
              organizations.length === 1
                ? t('dashboard.metric.workspace.activeOne', { count: 1 })
                : organizations.length > 1
                  ? t('dashboard.metric.workspace.activeMany', { count: organizations.length })
                  : t('dashboard.metric.workspace.empty')
            }
            statusLabel={readyLabel}
            tone={activeOrg !== null ? 'success' : 'info'}
            href="/workspace"
            actionLabel={t('dashboard.metric.workspace.action')}
          />
        ) : null}

        {billingEnabled ? (
          <DashboardMetricCard
            label={t('dashboard.metric.billing.label')}
            value={activePlanLabel}
            description={
              subscription?.status === 'active'
                ? t('dashboard.metric.billing.active')
                : subscription?.status === 'trialing'
                  ? t('dashboard.metric.billing.trialing')
                  : t('dashboard.metric.billing.starter')
            }
            statusLabel={readyLabel}
            tone={showUpgradeCta ? 'info' : 'success'}
            href={showUpgradeCta ? '/pricing' : '/workspace/billing'}
            actionLabel={
              showUpgradeCta
                ? t('dashboard.metric.billing.compareAction')
                : t('dashboard.metric.billing.manageAction')
            }
          />
        ) : null}

        <DashboardMetricCard
          label={t('dashboard.metric.profile.label')}
          value={formatPercentage(profilePercent)}
          description={
            missingProfileFields === 0
              ? t('dashboard.metric.profile.complete')
              : missingProfileFields === 1
                ? t('dashboard.metric.profile.missingOne', { count: 1 })
                : t('dashboard.metric.profile.missingMany', { count: missingProfileFields })
          }
          statusLabel={profileCompletenessLoading ? loadingLabel : readyLabel}
          tone={profilePercent >= 85 ? 'success' : profilePercent >= 60 ? 'warning' : 'danger'}
          loading={profileCompletenessLoading}
          href="/profile"
          actionLabel={t('dashboard.metric.profile.action')}
        />

        <DashboardMetricCard
          label={t('dashboard.metric.sessions.label')}
          value={
            sessionsError
              ? t('dashboard.status.review')
              : sessionsLoading
                ? t('dashboard.status.checking')
                : sessions.length === 1
                  ? t('dashboard.metric.sessions.countOne', { count: 1 })
                  : t('dashboard.metric.sessions.countMany', { count: sessions.length })
          }
          description={
            currentSession !== null
              ? t('dashboard.metric.sessions.lastUsed', {
                  date: formatDateShort(
                    currentSession.lastUsedAt,
                    locale,
                    t('dashboard.notAvailable'),
                  ),
                })
              : t('dashboard.metric.sessions.unavailable')
          }
          statusLabel={sessionsLoading ? loadingLabel : readyLabel}
          tone={sessionsError ? 'warning' : 'success'}
          loading={sessionsLoading}
          href="/settings/sessions"
          actionLabel={t('dashboard.metric.sessions.action')}
        />

        {webApp.dashboardTiles.map((tile) => {
          const translatedTile = translateDashboardTile(tile);
          return (
            <DashboardMetricCard
              key={tile.id}
              label={translatedTile.label}
              value={translatedTile.value}
              description={translatedTile.description}
              statusLabel={readyLabel}
              tone="info"
              href={tile.href}
              actionLabel={translatedTile.actionLabel}
            />
          );
        })}
      </div>

      {!checklistDismissed && completedChecklistCount < checklistItems.length ? (
        <Card className="dashboard-checklist">
          <div className="dashboard-checklist__header">
            <div>
              <Heading as="h2" size="sm">
                {t('dashboard.checklist.title')}
              </Heading>
              <Text tone="muted" size="sm">
                {t('dashboard.checklist.progress', {
                  completed: completedChecklistCount,
                  total: checklistItems.length,
                })}
              </Text>
            </div>
            <Button type="button" variant="text" size="small" onClick={handleDismissChecklist}>
              {t('dashboard.checklist.dismiss')}
            </Button>
          </div>
          <div className="dashboard-checklist__progress">
            <Progress value={checklistPercent} aria-label={t('dashboard.checklist.progressAria')} />
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
                <Badge tone={item.done ? 'success' : 'info'}>
                  {item.done ? t('dashboard.checklist.done') : t('dashboard.checklist.start')}
                </Badge>
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
                {t('dashboard.account.title')}
              </Heading>
              <Text tone="muted" size="sm">
                {t('dashboard.account.subtitle')}
              </Text>
            </div>
            <Link to="/settings">
              <Button variant="text" size="small">
                {t('nav.settings')}
              </Button>
            </Link>
          </div>
          <div className="dashboard-profile-list">
            <SurfaceRow
              label={t('dashboard.account.emailLabel')}
              value={
                user?.emailVerified === true
                  ? t('dashboard.account.emailVerified')
                  : t('dashboard.account.emailCheck')
              }
              detail={user?.email ?? t('dashboard.account.emailEmpty')}
              tone={user?.emailVerified === true ? 'success' : 'warning'}
            />
            <SurfaceRow
              label={t('dashboard.account.nameLabel')}
              value={
                hasName ? t('dashboard.account.statusSet') : t('dashboard.account.statusMissing')
              }
              detail={hasName ? displayName : t('dashboard.account.notProvided')}
              tone={hasName ? 'success' : 'warning'}
            />
            <SurfaceRow
              label={t('dashboard.account.usernameLabel')}
              value={
                hasUsername
                  ? t('dashboard.account.statusSet')
                  : t('dashboard.account.statusMissing')
              }
              detail={hasUsername ? `@${username}` : t('dashboard.account.notProvided')}
              tone={hasUsername ? 'success' : 'warning'}
            />
            <SurfaceRow
              label={t('dashboard.account.userIdLabel')}
              value={t('dashboard.account.statusLinked')}
              detail={user?.id ?? t('dashboard.account.noUserId')}
              tone="info"
            />
          </div>
        </Card>

        <Card className="dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <Heading as="h2" size="sm">
                {t('dashboard.shortcuts.title')}
              </Heading>
              <Text tone="muted" size="sm">
                {t('dashboard.shortcuts.subtitle')}
              </Text>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="small"
              title={t('header.jumpToTitle')}
              onClick={openCommandPalette}
            >
              <span>{t('header.jumpTo')}</span>
              <Kbd aria-hidden="true">⌘K</Kbd>
            </Button>
          </div>
          <div className="dashboard-shortcuts">
            <Link to="/settings/security" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  {t('dashboard.shortcuts.securityTitle')}
                </Text>
                <Text as="span" tone="muted" size="sm">
                  {t('dashboard.shortcuts.securityDesc')}
                </Text>
              </div>
              <Badge tone="info">{t('dashboard.shortcuts.securityBadge')}</Badge>
            </Link>
            <Link to="/settings/api-keys" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  {t('dashboard.shortcuts.apiKeysTitle')}
                </Text>
                <Text as="span" tone="muted" size="sm">
                  {t('dashboard.shortcuts.apiKeysDesc')}
                </Text>
              </div>
              <Badge tone="info">{t('dashboard.shortcuts.apiKeysBadge')}</Badge>
            </Link>
            <Link to="/settings/data-controls" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  {t('dashboard.shortcuts.privacyTitle')}
                </Text>
                <Text as="span" tone="muted" size="sm">
                  {t('dashboard.shortcuts.privacyDesc')}
                </Text>
              </div>
              <Badge tone="info">{t('dashboard.shortcuts.privacyBadge')}</Badge>
            </Link>
            <Link to="/settings/preferences" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  {t('dashboard.shortcuts.preferencesTitle')}
                </Text>
                <Text as="span" tone="muted" size="sm">
                  {t('dashboard.shortcuts.preferencesDesc')}
                </Text>
              </div>
              <Badge tone="info">{t('dashboard.shortcuts.preferencesBadge')}</Badge>
            </Link>
            <Link to="/docs" className="dashboard-shortcut-row">
              <div className="dashboard-surface-row__copy">
                <Text as="span" size="sm" className="dashboard-surface-row__label">
                  {t('dashboard.shortcuts.docsTitle')}
                </Text>
                <Text as="span" tone="muted" size="sm">
                  {t('dashboard.shortcuts.docsDesc')}
                </Text>
              </div>
              <Badge tone="info">{t('dashboard.shortcuts.docsBadge')}</Badge>
            </Link>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
};
