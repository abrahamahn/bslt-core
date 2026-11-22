// main/modules/audit/web/SecurityEventsPage.tsx
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { useNavigate } from '@bslt/react/router';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Heading,
  Input,
  PageContainer,
  Pagination,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@bslt/ui';
import { MetricValue, TitledCardSection } from '@bslt/ui/components';
import { useModuleMessages } from '@bslt/web-platform';

import {
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
  type ListSecurityEventsResponse,
  type SecurityEventEntry,
  type SecurityEventsFilter,
  type SecurityMetricsPeriod,
  type SecurityMetricsResponse,
} from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { formatAuditDateTime, formatSecurityEventType, securitySeverityTone } from './format';
import { useExportEvents, useSecurityEvents, useSecurityMetrics } from './hooks';

import './SecurityEventsPage.css';

function getSeverityClass(variant: 'default' | 'critical' | 'high' | 'medium'): string {
  switch (variant) {
    case 'critical':
      return 'font-bold text-danger';
    case 'high':
    case 'medium':
      return 'font-bold text-warning';
    case 'default':
      return 'font-bold';
  }
}

function SecurityMetricsCard({
  metrics,
  isLoading,
}: {
  readonly metrics: SecurityMetricsResponse | undefined;
  readonly isLoading: boolean;
}): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const metricPeriodSummary =
    metrics !== undefined
      ? `${t('audit.metricPeriodPrefix')} ${formatAuditDateTime(metrics.periodStart)} - ${formatAuditDateTime(metrics.periodEnd)}`
      : null;

  return (
    <TitledCardSection
      title={t('audit.securityOverviewTitle')}
      headingAs="h3"
      headingSize="md"
      cardClassName="p-6"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <MetricValue
          label={t('audit.metricTotalEvents')}
          value={metrics?.totalEvents ?? 0}
          isLoading={isLoading}
          formatNumber={true}
          valueClassName={getSeverityClass('default')}
        />
        <MetricValue
          label={t('audit.metricCritical')}
          value={metrics?.criticalEvents ?? 0}
          isLoading={isLoading}
          formatNumber={true}
          valueClassName={getSeverityClass('critical')}
        />
        <MetricValue
          label={t('audit.metricHigh')}
          value={metrics?.highEvents ?? 0}
          isLoading={isLoading}
          formatNumber={true}
          valueClassName={getSeverityClass('high')}
        />
        <MetricValue
          label={t('audit.metricMedium')}
          value={metrics?.mediumEvents ?? 0}
          isLoading={isLoading}
          formatNumber={true}
          valueClassName={getSeverityClass('medium')}
        />
      </div>

      <div className="mt-6 pt-4 border-t">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricValue
            label={t('audit.metricTokenReuse')}
            value={metrics?.tokenReuseCount ?? 0}
            isLoading={isLoading}
            formatNumber={true}
            valueClassName={getSeverityClass('critical')}
          />
          <MetricValue
            label={t('audit.metricAccountLockouts')}
            value={metrics?.accountLockedCount ?? 0}
            isLoading={isLoading}
            formatNumber={true}
            valueClassName={getSeverityClass('high')}
          />
          <MetricValue
            label={t('audit.metricSuspiciousLogins')}
            value={metrics?.suspiciousLoginCount ?? 0}
            isLoading={isLoading}
            formatNumber={true}
            valueClassName={getSeverityClass('medium')}
          />
        </div>
      </div>

      {metricPeriodSummary !== null ? (
        <div className="mt-4 pt-4 border-t">
          <Text tone="muted" size="xs">
            {metricPeriodSummary}
          </Text>
        </div>
      ) : null}
    </TitledCardSection>
  );
}

function SecurityEventsFilters({
  filter,
  onFilterChange,
}: {
  readonly filter: SecurityEventsFilter;
  readonly onFilterChange: (filter: SecurityEventsFilter) => void;
}): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const [localFilter, setLocalFilter] = useState<SecurityEventsFilter>(filter);

  useEffect(() => {
    setLocalFilter(filter);
  }, [filter]);

  const handleInputChange = useCallback((field: keyof SecurityEventsFilter, value: string) => {
    setLocalFilter((prev) => {
      const without = Object.fromEntries(
        Object.entries(prev).filter(([key]) => key !== field),
      ) as SecurityEventsFilter;
      return value === '' ? without : { ...without, [field]: value };
    });
  }, []);

  const handleApply = useCallback(() => {
    onFilterChange(localFilter);
  }, [localFilter, onFilterChange]);

  const handleClear = useCallback(() => {
    const emptyFilter: SecurityEventsFilter = {};
    setLocalFilter(emptyFilter);
    onFilterChange(emptyFilter);
  }, [onFilterChange]);

  return (
    <div className="bg-surface p-4 rounded-lg border">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div>
          <label htmlFor="event-type-select" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterEventTypeLabel')}
          </label>
          <Select
            id="event-type-select"
            data-testid="event-type-filter"
            value={localFilter.eventType ?? ''}
            onChange={(value) => {
              handleInputChange('eventType', value);
            }}
          >
            <option value="">{t('audit.filterAllEventTypes')}</option>
            {SECURITY_EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {formatSecurityEventType(eventType)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="severity-select" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterSeverityLabel')}
          </label>
          <Select
            id="severity-select"
            value={localFilter.severity ?? ''}
            onChange={(value) => {
              handleInputChange('severity', value);
            }}
          >
            <option value="">{t('audit.filterAllSeverities')}</option>
            {SECURITY_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {formatSecurityEventType(severity)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="email-input" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterEmailLabel')}
          </label>
          <Input
            id="email-input"
            type="email"
            placeholder={t('audit.filterEmailPlaceholder')}
            value={localFilter.email ?? ''}
            onChange={(e) => {
              handleInputChange('email', e.target.value);
            }}
          />
        </div>

        <div>
          <label htmlFor="ip-address-input" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterIpLabel')}
          </label>
          <Input
            id="ip-address-input"
            type="text"
            placeholder={t('audit.filterIpPlaceholder')}
            value={localFilter.ipAddress ?? ''}
            onChange={(e) => {
              handleInputChange('ipAddress', e.target.value);
            }}
          />
        </div>

        <div>
          <label htmlFor="start-date-input" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterStartDateLabel')}
          </label>
          <Input
            id="start-date-input"
            type="datetime-local"
            value={localFilter.startDate ?? ''}
            onChange={(e) => {
              handleInputChange('startDate', e.target.value);
            }}
          />
        </div>

        <div>
          <label htmlFor="end-date-input" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterEndDateLabel')}
          </label>
          <Input
            id="end-date-input"
            type="datetime-local"
            value={localFilter.endDate ?? ''}
            onChange={(e) => {
              handleInputChange('endDate', e.target.value);
            }}
          />
        </div>

        <div>
          <label htmlFor="user-id-input" className="block text-sm font-medium text-muted mb-1">
            {t('audit.filterUserIdLabel')}
          </label>
          <Input
            id="user-id-input"
            type="text"
            placeholder={t('audit.filterUserIdPlaceholder')}
            value={localFilter.userId ?? ''}
            onChange={(e) => {
              handleInputChange('userId', e.target.value);
            }}
          />
        </div>

        <div className="flex items-end gap-2">
          <Button onClick={handleApply}>{t('audit.applyFilters')}</Button>
          <Button variant="secondary" onClick={handleClear}>
            {t('audit.clearFilters')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SecurityEventsTable({
  data,
  isLoading,
  page,
  onPageChange,
}: {
  readonly data: ListSecurityEventsResponse | undefined;
  readonly isLoading: boolean;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const navigate = useNavigate();

  const handleRowClick = (event: SecurityEventEntry): void => {
    navigate(`/admin/security/${event.id}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} height="3rem" />
        ))}
      </div>
    );
  }

  if (data === undefined || data.data.length === 0) {
    return (
      <EmptyState
        title={t('audit.securityEmptyTitle')}
        description={t('audit.securityEmptyDescription')}
      />
    );
  }

  const showingSummary = `${t('audit.showingPrefix')} ${String(data.data.length)} ${t('audit.showingOf')} ${String(data.total)} ${t('audit.auditLogEventsSuffix')}`;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('audit.colTime')}</TableHead>
            <TableHead>{t('audit.colEventType')}</TableHead>
            <TableHead>{t('audit.colSeverity')}</TableHead>
            <TableHead>{t('audit.colEmail')}</TableHead>
            <TableHead>{t('audit.colIpAddress')}</TableHead>
            <TableHead>{t('audit.colActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.data.map((event) => (
            <TableRow
              key={event.id}
              data-testid="event-row"
              className="cursor-pointer hover-row"
              onClick={() => {
                handleRowClick(event);
              }}
            >
              <TableCell>
                <Text size="sm">{formatAuditDateTime(event.createdAt)}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm">{formatSecurityEventType(event.eventType)}</Text>
              </TableCell>
              <TableCell>
                <Badge tone={securitySeverityTone(event.severity)}>
                  {event.severity.toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell>
                <Text size="sm">{event.email ?? t('audit.none')}</Text>
              </TableCell>
              <TableCell>
                <Text size="sm" className="font-mono">
                  {event.ipAddress ?? t('audit.none')}
                </Text>
              </TableCell>
              <TableCell>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRowClick(event);
                  }}
                >
                  {t('audit.view')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <Text tone="muted" size="sm">
          {showingSummary}
        </Text>
        <Pagination value={page} totalPages={data.totalPages} onChange={onPageChange} />
      </div>
    </div>
  );
}

function ExportDialog({
  isOpen,
  onClose,
  filter,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly filter: SecurityEventsFilter;
}): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const [selectedFormat, setSelectedFormat] = useState<'csv' | 'json'>('csv');
  const { downloadExport, isExporting, isError, error } = useExportEvents();

  const handleExport = useCallback(() => {
    downloadExport(selectedFormat, filter);
    onClose();
  }, [selectedFormat, filter, downloadExport, onClose]);
  const exportErrorSummary = `${t('audit.exportFailedPrefix')} ${error?.message ?? t('audit.detailLoadErrorFallback')}`;

  return (
    <Dialog.Root open={isOpen} onClose={onClose}>
      <Dialog.Header>
        <Dialog.Title>{t('audit.exportModalTitle')}</Dialog.Title>
        <Dialog.Description>{t('audit.exportModalDescription')}</Dialog.Description>
      </Dialog.Header>

      <Dialog.Body>
        <div className="py-4 space-y-4">
          <div>
            <Text className="mb-2 font-medium">{t('audit.exportSelectFormat')}</Text>
            <RadioGroup
              name="format"
              value={selectedFormat}
              onValueChange={(value) => {
                setSelectedFormat(value === 'json' ? 'json' : 'csv');
              }}
              aria-label={t('audit.exportFormatAria')}
              className="flex gap-4"
            >
              <Radio value="csv" label={t('audit.exportCsv')} />
              <Radio value="json" label={t('audit.exportJson')} />
            </RadioGroup>
          </div>

          {Object.keys(filter).length > 0 ? (
            <div className="bg-surface rounded-lg p-3">
              <Text size="sm" tone="muted">
                {t('audit.exportActiveFiltersNote')}
              </Text>
            </div>
          ) : null}

          {isError ? (
            <div className="bg-danger-muted rounded-lg p-3">
              <Text size="sm" tone="danger">
                {exportErrorSummary}
              </Text>
            </div>
          ) : null}

          <Text size="sm" tone="muted">
            {t('audit.exportMaxNote')}
          </Text>
        </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="secondary" onClick={onClose}>
          {t('audit.cancel')}
        </Button>
        <Button onClick={handleExport} disabled={isExporting}>
          {isExporting ? t('audit.exporting') : t('audit.export')}
        </Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}

function isMetricsPeriod(value: string): value is SecurityMetricsPeriod {
  return value === 'hour' || value === 'day' || value === 'week' || value === 'month';
}

export function SecurityEventsPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  const eventsResult = useSecurityEvents();
  const metricsResult = useSecurityMetrics();

  const handlePeriodChange = useCallback(
    (value: string) => {
      if (isMetricsPeriod(value)) {
        metricsResult.setPeriod(value);
      }
    },
    [metricsResult],
  );

  const activeFilterCount = Object.keys(eventsResult.filter).length;
  const activeFiltersSummary = `${String(activeFilterCount)} ${t('audit.activeFiltersSuffix')}`;

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <Heading as="h1" size="xl">
              {t('audit.securityTitle')}
            </Heading>
            <Text tone="muted">{t('audit.securitySubtitle')}</Text>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={metricsResult.period}
              onChange={handlePeriodChange}
              className="security-events-period"
            >
              <option value="hour">{t('audit.periodHour')}</option>
              <option value="day">{t('audit.periodDay')}</option>
              <option value="week">{t('audit.periodWeek')}</option>
              <option value="month">{t('audit.periodMonth')}</option>
            </Select>
            <Button
              variant="secondary"
              onClick={() => {
                void eventsResult.refetch();
              }}
            >
              {t('audit.refresh')}
            </Button>
            <Button
              onClick={() => {
                setIsExportDialogOpen(true);
              }}
            >
              {t('audit.export')}
            </Button>
          </div>
        </div>

        <SecurityMetricsCard metrics={metricsResult.data} isLoading={metricsResult.isLoading} />

        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={() => {
              setShowFilters((prev) => !prev);
            }}
          >
            {showFilters ? t('audit.hideFilters') : t('audit.showFilters')}
          </Button>
          {activeFilterCount > 0 ? (
            <Text tone="muted" size="sm">
              {activeFiltersSummary}
            </Text>
          ) : null}
        </div>

        {showFilters ? (
          <SecurityEventsFilters
            filter={eventsResult.filter}
            onFilterChange={eventsResult.setFilter}
          />
        ) : null}

        <SecurityEventsTable
          data={eventsResult.data}
          isLoading={eventsResult.isLoading}
          page={eventsResult.pagination.page}
          onPageChange={eventsResult.setPage}
        />

        <ExportDialog
          isOpen={isExportDialogOpen}
          onClose={() => {
            setIsExportDialogOpen(false);
          }}
          filter={eventsResult.filter}
        />
      </div>
    </PageContainer>
  );
}
