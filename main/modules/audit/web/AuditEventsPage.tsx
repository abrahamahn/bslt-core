// main/modules/audit/web/AuditEventsPage.tsx
import { useCallback, useState, type ReactElement } from 'react';

import {
  Badge,
  Button,
  EmptyState,
  Heading,
  Input,
  PageContainer,
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
import { useModuleMessages } from '@bslt/web-platform';

import { AUDIT_CATEGORIES, type AuditCategory, type ListAuditEventsQuery } from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { auditSeverityTone, formatAuditDateTime, truncateAuditText } from './format';
import { useAuditEvents } from './hooks';

const LIMITS = [50, 100, 200, 500] as const;

function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

export function AuditEventsPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const [actionFilter, setActionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [limit, setLimit] = useState(100);

  const filter: ListAuditEventsQuery = {
    ...(actionFilter !== '' ? { action: actionFilter } : {}),
    ...(isAuditCategory(categoryFilter) ? { category: categoryFilter } : {}),
    limit,
  };

  const { data, isLoading, isError, error, refetch } = useAuditEvents({ filter });

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-3 py-4">
          <Skeleton width="8rem" height="1.75rem" />
          <Skeleton width="100%" height="2.5rem" radius="var(--ui-radius-md)" />
          <Skeleton width="100%" height="2rem" />
          <Skeleton width="100%" height="2rem" />
          <Skeleton width="100%" height="2rem" />
          <Skeleton width="100%" height="2rem" />
          <Skeleton width="100%" height="2rem" />
        </div>
      </PageContainer>
    );
  }

  if (isError) {
    return (
      <PageContainer>
        <Heading as="h1">{t('audit.auditLogTitle')}</Heading>
        <Text tone="danger">{error?.message ?? t('audit.auditLogLoadError')}</Text>
      </PageContainer>
    );
  }

  const events = data?.events ?? [];
  const eventsCountSummary = `${String(events.length)} ${t('audit.auditLogEventsSuffix')}`;

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-4">
        <div>
          <Heading as="h1">{t('audit.auditLogTitle')}</Heading>
          <Text tone="muted">{eventsCountSummary}</Text>
        </div>
        <Button type="button" variant="secondary" size="small" onClick={handleRefresh}>
          {t('audit.refresh')}
        </Button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div className="flex flex-col gap-1">
          <Text as="label" size="sm" tone="muted">
            {t('audit.filterActionLabel')}
          </Text>
          <Input
            placeholder={t('audit.filterActionPlaceholder')}
            value={actionFilter}
            onChange={(e: { target: { value: string } }) => {
              setActionFilter(e.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Text as="label" size="sm" tone="muted">
            {t('audit.filterCategoryLabel')}
          </Text>
          <Select
            value={categoryFilter}
            onChange={(value: string) => {
              setCategoryFilter(value);
            }}
          >
            <option value="">{t('audit.filterAllCategories')}</option>
            {AUDIT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Text as="label" size="sm" tone="muted">
            {t('audit.filterLimitLabel')}
          </Text>
          <Select
            value={String(limit)}
            onChange={(value: string) => {
              setLimit(Number(value));
            }}
          >
            {LIMITS.map((l) => (
              <option key={l} value={String(l)}>
                {String(l)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title={t('audit.auditLogEmptyTitle')}
          description={t('audit.auditLogEmptyDescription')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('audit.colTime')}</TableHead>
              <TableHead>{t('audit.colAction')}</TableHead>
              <TableHead>{t('audit.colCategory')}</TableHead>
              <TableHead>{t('audit.colSeverity')}</TableHead>
              <TableHead>{t('audit.colResource')}</TableHead>
              <TableHead>{t('audit.colActor')}</TableHead>
              <TableHead>{t('audit.colIp')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const resourceLabel =
                event.resourceId !== null
                  ? `${event.resource}:${truncateAuditText(event.resourceId, 8)}`
                  : event.resource;
              return (
                <TableRow key={event.id} className="hover-row">
                  <TableCell>
                    <Text size="sm">{formatAuditDateTime(event.createdAt)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm" className="font-mono">
                      {event.action}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Badge>{event.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={auditSeverityTone(event.severity)}>{event.severity}</Badge>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">{resourceLabel}</Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm" className="font-mono">
                      {event.actorId !== null
                        ? truncateAuditText(event.actorId, 8)
                        : t('audit.none')}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size="sm">{event.ipAddress ?? t('audit.none')}</Text>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </PageContainer>
  );
}
