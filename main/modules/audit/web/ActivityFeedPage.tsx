// main/modules/audit/web/ActivityFeedPage.tsx
import { Alert, Badge, Card, cn, EmptyState, Heading, PageContainer, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import {
  actorTypeTone,
  formatActivityActionLabel,
  formatActivitySummary,
  formatAuditTimeAgo,
} from './format';
import { useActivities } from './hooks';

import type { ActivityEntry } from '../contract';
import type { ReactElement } from 'react';

export interface ActivityFeedProps {
  readonly limit?: number | undefined;
  readonly className?: string | undefined;
}

function ActivityItem({ activity }: { readonly activity: ActivityEntry }): ReactElement {
  const actorTone = actorTypeTone(activity.actorType);
  const actionLabel = formatActivityActionLabel(activity.action);
  const summary = formatActivitySummary(activity);

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex-shrink-0 mt-1">
        <Badge tone={actorTone}>{activity.actorType}</Badge>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Text size="sm" className="font-medium">
            {actionLabel}
          </Text>
        </div>
        {summary !== null ? (
          <Text size="sm" tone="muted" className="mt-1">
            {summary}
          </Text>
        ) : null}
      </div>
      <Text size="sm" tone="muted" className="flex-shrink-0">
        {formatAuditTimeAgo(activity.createdAt)}
      </Text>
    </div>
  );
}

export function ActivityFeed({ limit = 20, className }: ActivityFeedProps): ReactElement {
  const t = useModuleMessages(enUsMessages);
  const { activities, isLoading, isError, error } = useActivities({ limit });

  if (isLoading) {
    return (
      <div className={className}>
        <Text tone="muted">{t('audit.activitiesLoading')}</Text>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={className}>
        <Alert tone="danger">{error?.message ?? t('audit.activitiesLoadError')}</Alert>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          title={t('audit.activitiesEmptyTitle')}
          description={t('audit.activitiesEmptyDescription')}
        />
      </div>
    );
  }

  return (
    <div className={cn('divide-y', className)}>
      {activities.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

export function ActivityFeedPage(): ReactElement {
  const t = useModuleMessages(enUsMessages);

  return (
    <PageContainer>
      <section className="mb-4">
        <Heading as="h1" size="xl">
          {t('audit.activitiesTitle')}
        </Heading>
        <Text tone="muted" className="mt-1">
          {t('audit.activitiesSubtitle')}
        </Text>
      </section>

      <Card>
        <ActivityFeed limit={50} />
      </Card>
    </PageContainer>
  );
}
