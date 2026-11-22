// main/apps/web/src/app/admin/AdminDashboardPage.tsx
import { useAuditEvents, useSecurityMetrics } from '@bslt/audit/web';
import { useAdminUsers } from '@bslt/identity/web';
import { useNavigate } from '@bslt/react/router';
import { Alert, Badge, Button, Card, Heading, Skeleton, Text } from '@bslt/ui';

import {
  hasAdminModule,
  hasBillingModule,
  hasOrgsModule,
  healthStatusTone,
  useOptionalAdminHealth,
  useOptionalAdminMetrics,
  useOptionalAdminOrgs,
  useOptionalAdminPlans,
  useOptionalJobsList,
  useOptionalQueueStats,
  type SignalTone,
} from '../../generated/modules';

import type { Locale } from '#app/i18n';
import type { AdminSurfaceId } from './adminSurface';
import type { ReactElement, ReactNode } from 'react';

import { formatDate, useLocale } from '#app/i18n';

import './AdminDashboardPage.css';

interface MetricCardProps {
  title: string;
  value: ReactNode;
  detail: string;
  tone: SignalTone;
  statusLabel: string;
  href: string;
  actionLabel: string;
  isLoading?: boolean;
}

interface SignalRowProps {
  label: string;
  value: ReactNode;
  detail: string;
  href: string;
  tone?: SignalTone;
}

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: SignalTone;
}

interface SurfaceLink {
  id: AdminSurfaceId;
  label: string;
  detail: string;
  href: string;
  status: string;
  tone: SignalTone;
}

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

const formatMs = (value: number): string => {
  return `${String(Math.round(value))} ms`;
};

const formatDecimal = (value: number | null | undefined): string => {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '0.0';
};

const formatEventDate = (value: string | null | undefined, locale: Locale): string => {
  if (value === null || value === undefined || value === '') return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return formatDate(date, locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getServiceLabel = (status: string | undefined): string => {
  if (status === undefined) return 'Loading';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const MetricCard = ({
  title,
  value,
  detail,
  tone,
  statusLabel,
  href,
  actionLabel,
  isLoading = false,
}: MetricCardProps): ReactElement => {
  const navigate = useNavigate();

  return (
    <Card className="p-4">
      <div className="admin-dashboard-metric-card flex flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Text size="sm" tone="muted">
              {title}
            </Text>
            {isLoading ? (
              <Skeleton width="7rem" height="2rem" className="mt-3" />
            ) : (
              <div className="mt-2 text-xl font-semibold">{value}</div>
            )}
          </div>
          <Badge tone={tone}>{statusLabel}</Badge>
        </div>
        <div className="flex items-end justify-between gap-3">
          <Text size="sm" tone="muted" className="max-w-xs">
            {detail}
          </Text>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => {
              navigate(href);
            }}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
};

const SignalRow = ({ label, value, detail, href, tone = 'info' }: SignalRowProps): ReactElement => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <Text className="font-medium">{label}</Text>
        <Text size="sm" tone="muted" className="block">
          {detail}
        </Text>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <Badge tone={tone}>{value}</Badge>
        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => {
            navigate(href);
          }}
        >
          Open
        </Button>
      </div>
    </div>
  );
};

const SurfaceLinkRow = ({ surface }: { surface: SurfaceLink }): ReactElement => {
  const navigate = useNavigate();

  return (
    <Button
      type="button"
      variant="text"
      className="flex w-full items-center justify-between gap-4 rounded-md border bg-surface p-4 text-left transition hover-row"
      onClick={() => {
        navigate(surface.href);
      }}
    >
      <span className="min-w-0">
        <span className="block font-medium">{surface.label}</span>
        <span className="mt-1 block text-sm text-muted">{surface.detail}</span>
      </span>
      <span className="flex-shrink-0">
        <Badge tone={surface.tone}>{surface.status}</Badge>
      </span>
    </Button>
  );
};

export function AdminDashboardPage(): ReactElement {
  const navigate = useNavigate();
  const locale = useLocale();

  const health = useOptionalAdminHealth();
  const metrics = useOptionalAdminMetrics();
  const users = useAdminUsers({ limit: 10 });
  const tenants = useOptionalAdminOrgs();
  const security = useSecurityMetrics({ period: 'day' });
  const queue = useOptionalQueueStats();
  const jobs = useOptionalJobsList({ pagination: { limit: 5 } });
  const audit = useAuditEvents({ filter: { limit: 5 } });
  const billing = useOptionalAdminPlans();

  const serviceEntries = Object.entries(health.data?.services ?? {});
  const unhealthyServices = serviceEntries.filter(([, status]) => status !== 'up');
  const upServiceCount = serviceEntries.length - unhealthyServices.length;
  const totalServiceCount = serviceEntries.length;
  const healthTone = healthStatusTone(health.data?.status);

  const userList = users.users;
  const tenantList = tenants.tenants;
  const operationalMetrics = metrics.data?.metrics ?? null;
  const queueStats = queue.data ?? null;
  const securityMetrics = security.data ?? null;
  const auditEvents = audit.data?.events ?? [];
  const billingPlans = billing.plans;
  const userTotal = users.total;
  const tenantTotal = tenants.total;

  const lockedUsers = userList.filter((user) => user.lockedUntil !== null).length;
  const unverifiedUsers = userList.filter((user) => !user.emailVerified).length;
  const inactiveTenants = tenantList.filter((tenant) => !tenant.isActive).length;
  const activeTenants = tenantList.filter((tenant) => tenant.isActive).length;
  const activePlans = billingPlans.filter((plan) => plan.isActive).length;
  const totalPlans = billingPlans.length;
  const latestAuditEvent = auditEvents[0];

  const attentionItems: AttentionItem[] = [
    ...(health.data?.status === 'degraded' || health.data?.status === 'down'
      ? [
          {
            id: 'health',
            title: 'System health is not healthy',
            detail: `${formatNumber(unhealthyServices.length)} service(s) require inspection.`,
            href: '/admin/health',
            tone: healthTone,
          } satisfies AttentionItem,
        ]
      : []),
    ...(operationalMetrics !== null && operationalMetrics.errorRate > 0
      ? [
          {
            id: 'error-rate',
            title: 'Request errors are present',
            detail: `${formatDecimal(operationalMetrics.errorRate)}% error rate across recent traffic.`,
            href: '/admin/health',
            tone: operationalMetrics.errorRate >= 5 ? 'danger' : 'warning',
          } satisfies AttentionItem,
        ]
      : []),
    ...(securityMetrics !== null &&
    (securityMetrics.criticalEvents > 0 || securityMetrics.highEvents > 0)
      ? [
          {
            id: 'security',
            title: 'High priority security events',
            detail: `${formatNumber(securityMetrics.criticalEvents)} critical and ${formatNumber(securityMetrics.highEvents)} high severity events.`,
            href: '/admin/security',
            tone: securityMetrics.criticalEvents > 0 ? 'danger' : 'warning',
          } satisfies AttentionItem,
        ]
      : []),
    ...(queueStats !== null && (queueStats.failed > 0 || queueStats.deadLetter > 0)
      ? [
          {
            id: 'queue',
            title: 'Queue failures need review',
            detail: `${formatNumber(queueStats.failed)} failed jobs and ${formatNumber(queueStats.deadLetter)} dead letter jobs.`,
            href: '/admin/jobs',
            tone: queueStats.deadLetter > 0 ? 'danger' : 'warning',
          } satisfies AttentionItem,
        ]
      : []),
  ];

  const surfaces: SurfaceLink[] = [
    ...(hasAdminModule
      ? [
          {
            id: 'health',
            label: 'System Health',
            detail: 'Services, request metrics, active connections, and queue telemetry.',
            href: '/admin/health',
            status: getServiceLabel(health.data?.status),
            tone: healthTone,
          } satisfies SurfaceLink,
          {
            id: 'users',
            label: 'Users',
            detail: 'User listing, roles, locks, verification, and impersonation workflows.',
            href: '/admin/users',
            status: `${formatNumber(userTotal)} total`,
            tone: users.error !== null ? 'danger' : 'info',
          } satisfies SurfaceLink,
        ]
      : []),
    ...(hasOrgsModule
      ? [
          {
            id: 'tenants',
            label: 'Tenants',
            detail: 'Tenant listing, account state, and tenant-specific operations.',
            href: '/admin/tenants',
            status: `${formatNumber(tenantTotal)} total`,
            tone: tenants.error !== null ? 'danger' : 'info',
          } satisfies SurfaceLink,
        ]
      : []),
    {
      id: 'security',
      label: 'Security',
      detail: 'Security event stream and severity metrics.',
      href: '/admin/security',
      status: `${formatNumber(securityMetrics?.totalEvents ?? 0)} today`,
      tone:
        securityMetrics !== null && securityMetrics.criticalEvents > 0
          ? 'danger'
          : securityMetrics !== null && securityMetrics.highEvents > 0
            ? 'warning'
            : 'success',
    },
    ...(hasAdminModule
      ? [
          {
            id: 'jobs',
            label: 'Jobs',
            detail: 'Background jobs, queue pressure, retries, and dead letter review.',
            href: '/admin/jobs',
            status: `${formatNumber(queueStats?.pending ?? 0)} pending`,
            tone:
              queueStats !== null && queueStats.deadLetter > 0
                ? 'danger'
                : queueStats !== null && queueStats.failed > 0
                  ? 'warning'
                  : 'success',
          } satisfies SurfaceLink,
        ]
      : []),
    ...(hasBillingModule
      ? [
          {
            id: 'billing',
            label: 'Billing Plans',
            detail: 'Plan catalogue, Stripe sync, active plan state, and pricing controls.',
            href: '/admin/billing/plans',
            status: `${formatNumber(activePlans)} active`,
            tone: billing.error !== null ? 'danger' : 'info',
          } satisfies SurfaceLink,
        ]
      : []),
    {
      id: 'audit',
      label: 'Audit Log',
      detail: 'Admin, security, billing, and system audit events.',
      href: '/admin/audit',
      status: `${formatNumber(auditEvents.length)} loaded`,
      tone: audit.isError ? 'danger' : 'info',
    },
    {
      id: 'legal',
      label: 'Legal Documents',
      detail: 'Publish and manage policy document versions.',
      href: '/admin/legal',
      status: 'Ready',
      tone: 'info',
    },
  ];

  const handleRefreshAll = (): void => {
    void health.refetch();
    void metrics.refetch();
    void users.refresh();
    void tenants.refresh();
    void security.refetch();
    void queue.refetch();
    void jobs.refetch();
    void audit.refetch();
    void billing.refresh();
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-surface p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={healthTone}>{getServiceLabel(health.data?.status)}</Badge>
              <Badge tone={attentionItems.length > 0 ? 'warning' : 'success'}>
                {attentionItems.length} attention item{attentionItems.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <Heading as="h1" size="lg">
              Admin Dashboard
            </Heading>
            <Text tone="muted" className="mt-2 block">
              System health, people, tenants, security, jobs, billing, webhooks, flags, audit
              events, and route coverage in one operational view.
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={handleRefreshAll}>
              Refresh All
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {hasAdminModule ? (
          <MetricCard
            title="System Health"
            value={`${formatNumber(upServiceCount)} / ${formatNumber(totalServiceCount)}`}
            detail="Services reporting up across database, cache, queue, storage, and email."
            tone={healthTone}
            statusLabel={getServiceLabel(health.data?.status)}
            href="/admin/health"
            actionLabel="Health"
            isLoading={health.isLoading}
          />
        ) : null}
        <MetricCard
          title="Users"
          value={formatNumber(userTotal)}
          detail={`${formatNumber(lockedUsers)} locked, ${formatNumber(unverifiedUsers)} unverified in the current page.`}
          tone={users.error !== null ? 'danger' : 'info'}
          statusLabel={users.error !== null ? 'Error' : 'Loaded'}
          href="/admin/users"
          actionLabel="Users"
          isLoading={users.isLoading}
        />
        {hasOrgsModule ? (
          <MetricCard
            title="Tenants"
            value={formatNumber(tenantTotal)}
            detail={`${formatNumber(activeTenants)} active, ${formatNumber(inactiveTenants)} inactive tenant scopes.`}
            tone={tenants.error !== null ? 'danger' : 'info'}
            statusLabel={tenants.error !== null ? 'Error' : 'Loaded'}
            href="/admin/tenants"
            actionLabel="Tenants"
            isLoading={tenants.isLoading}
          />
        ) : null}
        <MetricCard
          title="Security"
          value={formatNumber(securityMetrics?.totalEvents ?? 0)}
          detail={`${formatNumber(securityMetrics?.criticalEvents ?? 0)} critical and ${formatNumber(securityMetrics?.highEvents ?? 0)} high severity events today.`}
          tone={
            securityMetrics !== null && securityMetrics.criticalEvents > 0
              ? 'danger'
              : securityMetrics !== null && securityMetrics.highEvents > 0
                ? 'warning'
                : 'success'
          }
          statusLabel={
            securityMetrics !== null &&
            (securityMetrics.criticalEvents > 0 || securityMetrics.highEvents > 0)
              ? 'Review'
              : 'Clear'
          }
          href="/admin/security"
          actionLabel="Security"
          isLoading={security.isLoading}
        />
        {hasAdminModule ? (
          <MetricCard
            title="Jobs"
            value={formatNumber(queueStats?.pending ?? 0)}
            detail={`${formatNumber(queueStats?.failed ?? 0)} failed, ${formatNumber(queueStats?.deadLetter ?? 0)} dead letter, ${formatDecimal(queueStats?.failureRate)}% failure rate.`}
            tone={
              queueStats !== null && queueStats.deadLetter > 0
                ? 'danger'
                : queueStats !== null && queueStats.failed > 0
                  ? 'warning'
                  : 'success'
            }
            statusLabel={
              queueStats !== null && (queueStats.failed > 0 || queueStats.deadLetter > 0)
                ? 'Review'
                : 'Clear'
            }
            href="/admin/jobs"
            actionLabel="Jobs"
            isLoading={queue.isLoading}
          />
        ) : null}
        {hasBillingModule ? (
          <MetricCard
            title="Billing Plans"
            value={`${formatNumber(activePlans)} / ${formatNumber(totalPlans)}`}
            detail="Active plan catalogue entries available for pricing and Stripe sync."
            tone={billing.error !== null ? 'danger' : 'info'}
            statusLabel={billing.error !== null ? 'Error' : 'Loaded'}
            href="/admin/billing/plans"
            actionLabel="Billing"
            isLoading={billing.isLoading}
          />
        ) : null}
      </section>

      {attentionItems.length > 0 && (
        <section>
          <Heading as="h2" size="sm" className="mb-3">
            Attention Queue
          </Heading>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {attentionItems.map((item) => (
              <Alert key={item.id} tone={item.tone}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Text className="font-medium">{item.title}</Text>
                    <Text size="sm" className="mt-1 block">
                      {item.detail}
                    </Text>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      navigate(item.href);
                    }}
                  >
                    Review
                  </Button>
                </div>
              </Alert>
            ))}
          </div>
        </section>
      )}

      <section className="admin-dashboard-split">
        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Heading as="h2" size="sm">
                Operational Signals
              </Heading>
              <Text size="sm" tone="muted" className="mt-1 block">
                Live counters pulled from the admin API surface.
              </Text>
            </div>
            <Badge tone={metrics.isError ? 'danger' : 'info'}>live</Badge>
          </div>
          <div className="divide-y">
            <SignalRow
              label="Request throughput"
              value={`${formatDecimal(operationalMetrics?.requestsPerSecond)} rps`}
              detail={`${formatNumber(operationalMetrics?.totalRequests ?? 0)} total requests`}
              href="/admin/health"
              tone={metrics.isError ? 'danger' : 'info'}
            />
            <SignalRow
              label="Response latency"
              value={formatMs(operationalMetrics?.p95ResponseTime ?? 0)}
              detail={`Average ${formatMs(operationalMetrics?.avgResponseTime ?? 0)}, P99 ${formatMs(operationalMetrics?.p99ResponseTime ?? 0)}`}
              href="/admin/health"
              tone={
                operationalMetrics !== null && operationalMetrics.p95ResponseTime > 1000
                  ? 'warning'
                  : 'success'
              }
            />
            <SignalRow
              label="Active connections"
              value={formatNumber(operationalMetrics?.activeConnections ?? 0)}
              detail="Current real-time and request connections."
              href="/admin/health"
            />
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Heading as="h2" size="sm">
                Recent Activity
              </Heading>
              <Text size="sm" tone="muted" className="mt-1 block">
                Latest audit activity from the core admin API surface.
              </Text>
            </div>
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={() => {
                navigate('/admin/audit');
              }}
            >
              Audit Log
            </Button>
          </div>
          <div className="space-y-4">
            <div>
              <Text size="sm" tone="muted">
                Latest Audit Event
              </Text>
              {audit.isLoading ? (
                <Skeleton width="100%" height="3rem" className="mt-2" />
              ) : latestAuditEvent !== undefined ? (
                <div className="mt-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Text className="font-medium">{latestAuditEvent.action}</Text>
                    <Badge
                      tone={
                        latestAuditEvent.severity === 'critical' ||
                        latestAuditEvent.severity === 'error'
                          ? 'danger'
                          : latestAuditEvent.severity === 'warn'
                            ? 'warning'
                            : 'info'
                      }
                    >
                      {latestAuditEvent.severity}
                    </Badge>
                  </div>
                  <Text size="sm" tone="muted" className="mt-1 block">
                    {latestAuditEvent.category} ·{' '}
                    {formatEventDate(latestAuditEvent.createdAt, locale)}
                  </Text>
                </div>
              ) : (
                <Text size="sm" tone="muted" className="mt-2 block">
                  No recent audit events loaded.
                </Text>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <Heading as="h2" size="sm">
              Admin Surfaces
            </Heading>
            <Text size="sm" tone="muted" className="mt-1 block">
              Entry points for every admin page currently registered in the app.
            </Text>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {surfaces.map((surface) => (
            <SurfaceLinkRow key={surface.id} surface={surface} />
          ))}
        </div>
      </section>
    </div>
  );
}
