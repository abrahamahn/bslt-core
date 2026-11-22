// main/modules/audit/web/SecurityEventDetailPage.tsx
import { useNavigate, useParams } from '@bslt/react/router';
import { Alert, Badge, Button, Heading, PageContainer, Text } from '@bslt/ui';
import { LabeledValueRow, TitledCardSection } from '@bslt/ui/components';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import { formatAuditDateTime, formatSecurityEventType, securitySeverityTone } from './format';
import { useSecurityEvent } from './hooks';

import type { SecurityEventEntry } from '../contract';
import type { ReactElement } from 'react';

function hasValidMetadata(
  event: SecurityEventEntry | undefined,
): event is SecurityEventEntry & { readonly metadata: Record<string, unknown> } {
  return (
    event?.metadata !== undefined &&
    event.metadata !== null &&
    Object.keys(event.metadata).length > 0
  );
}

function SecurityEventCard({
  event,
  isLoading,
}: {
  readonly event: SecurityEventEntry | undefined;
  readonly isLoading: boolean;
}): ReactElement {
  const t = useModuleMessages(enUsMessages);

  return (
    <div className="space-y-6" data-testid="event-detail">
      <TitledCardSection
        title={t('audit.detailSectionEvent')}
        headingAs="h2"
        headingSize="lg"
        cardClassName="p-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-y">
          <LabeledValueRow
            label={t('audit.detailEventId')}
            value={event?.id}
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
          <LabeledValueRow
            label={t('audit.detailCreatedAt')}
            value={event !== undefined ? formatAuditDateTime(event.createdAt) : undefined}
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
          <LabeledValueRow
            label={t('audit.colEventType')}
            value={event !== undefined ? formatSecurityEventType(event.eventType) : undefined}
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
          <LabeledValueRow
            label={t('audit.colSeverity')}
            value={
              event !== undefined ? (
                <Badge tone={securitySeverityTone(event.severity)}>
                  {event.severity.toUpperCase()}
                </Badge>
              ) : undefined
            }
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
        </div>
      </TitledCardSection>

      <TitledCardSection
        title={t('audit.detailSectionUser')}
        headingAs="h3"
        headingSize="md"
        cardClassName="p-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-y">
          <LabeledValueRow
            label={t('audit.filterUserIdLabel')}
            value={event?.userId}
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
          <LabeledValueRow
            label={t('audit.colEmail')}
            value={event?.email}
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
        </div>
      </TitledCardSection>

      <TitledCardSection
        title={t('audit.detailSectionRequest')}
        headingAs="h3"
        headingSize="md"
        cardClassName="p-6"
      >
        <div className="grid grid-cols-1 gap-8 divide-y">
          <LabeledValueRow
            label={t('audit.colIpAddress')}
            value={event?.ipAddress}
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
          <LabeledValueRow
            label={t('audit.detailUserAgent')}
            value={
              event !== undefined && event.userAgent !== null && event.userAgent !== '' ? (
                <Text className="break-all font-mono text-sm">{event.userAgent}</Text>
              ) : undefined
            }
            isLoading={isLoading}
            className="py-2"
            labelClassName="font-medium"
          />
        </div>
      </TitledCardSection>

      {hasValidMetadata(event) ? (
        <TitledCardSection
          title={t('audit.detailSectionMetadata')}
          headingAs="h3"
          headingSize="md"
          cardClassName="p-6"
        >
          <div className="bg-surface rounded-lg p-4 overflow-auto">
            <pre className="text-sm font-mono">{JSON.stringify(event.metadata, null, 2)}</pre>
          </div>
        </TitledCardSection>
      ) : null}
    </div>
  );
}

export function SecurityEventDetailPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const params = useParams();
  const id = params['id'];
  const navigate = useNavigate();

  const { data: event, isLoading, isError, error } = useSecurityEvent(id);

  const handleBack = (): void => {
    navigate('/admin/security');
  };
  const eventIdSummary = event !== undefined ? `${t('audit.detailIdLabel')} ${event.id}` : null;

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={handleBack}>
              {t('audit.backToEvents')}
            </Button>
            <div>
              <Heading as="h1" size="xl">
                {t('audit.securityDetailTitle')}
              </Heading>
              {eventIdSummary !== null ? (
                <Text tone="muted" size="sm">
                  {eventIdSummary}
                </Text>
              ) : null}
            </div>
          </div>
        </div>

        {isError ? (
          <Alert tone="danger">
            <Heading as="h3" size="sm" className="mb-2">
              {t('audit.detailLoadErrorTitle')}
            </Heading>
            <Text>{error?.message ?? t('audit.detailLoadErrorFallback')}</Text>
            <Button variant="secondary" onClick={handleBack} className="mt-4">
              {t('audit.returnToEventsList')}
            </Button>
          </Alert>
        ) : (
          <SecurityEventCard event={event} isLoading={isLoading} />
        )}
      </div>
    </PageContainer>
  );
}
