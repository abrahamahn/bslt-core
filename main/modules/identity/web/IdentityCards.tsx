// main/modules/identity/web/IdentityCards.tsx
import { Badge, Button, Card, Progress, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

import type { ReactElement } from 'react';

interface ParsedIdentityUserAgent {
  readonly browser: string;
  readonly os: string;
}

export function parseIdentityUserAgent(
  userAgent: string | null,
  fallbacks: ParsedIdentityUserAgent = {
    browser: 'Unknown browser',
    os: 'Unknown device',
  },
): ParsedIdentityUserAgent {
  if (userAgent === null || userAgent === '') {
    return fallbacks;
  }

  let browser = fallbacks.browser;
  let os = fallbacks.os;

  if (userAgent.includes('OPR') || userAgent.includes('Opera')) {
    browser = 'Opera';
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge';
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox';
  } else if (userAgent.includes('Chrome')) {
    browser = 'Chrome';
  } else if (userAgent.includes('Safari')) {
    browser = 'Safari';
  }

  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
  } else if (userAgent.includes('Windows')) {
    os = 'Windows';
  } else if (userAgent.includes('Mac OS')) {
    os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  }

  return { browser, os };
}

function formatShortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function formatDateTimeShort(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

export interface SessionCardSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface SessionCardProps {
  session: SessionCardSession;
  onRevoke: () => void;
  isRevoking?: boolean;
}

export const SessionCard = ({
  session,
  onRevoke,
  isRevoking = false,
}: SessionCardProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { browser, os } = parseIdentityUserAgent(session.userAgent, {
    browser: t('identity.cards.unknownBrowser'),
    os: t('identity.cards.unknownDevice'),
  });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Text as="span" className="font-medium">
              {t('identity.cards.sessionTitle', { browser, os })}
            </Text>
            {session.isCurrent && (
              <Badge tone="success">{t('identity.cards.currentSession')}</Badge>
            )}
          </div>

          <div className="text-sm text-muted space-y-1">
            {session.ipAddress !== null && session.ipAddress.length > 0 && (
              <Text>{t('identity.cards.ipPrefix', { ip: session.ipAddress })}</Text>
            )}
            <Text>
              {t('identity.cards.startedPrefix', { date: formatShortDate(session.createdAt) })}
            </Text>
          </div>
        </div>

        {!session.isCurrent && (
          <Button
            variant="text"
            size="small"
            onClick={onRevoke}
            disabled={isRevoking}
            className="text-danger"
          >
            {isRevoking ? t('identity.cards.revoking') : t('identity.cards.revoke')}
          </Button>
        )}
      </div>
    </Card>
  );
};

interface DeviceRowCardDevice {
  id: string;
  label: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  trusted: boolean;
}

interface DeviceRowCardProps {
  device: DeviceRowCardDevice;
  onTrust: (id: string) => void;
  onRevoke: (id: string) => void;
}

export const DeviceRowCard = ({ device, onTrust, onRevoke }: DeviceRowCardProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { browser } = parseIdentityUserAgent(device.userAgent, {
    browser: t('identity.cards.unknownBrowser'),
    os: t('identity.cards.unknownDevice'),
  });

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Text>{device.label ?? browser}</Text>
          {device.trusted && <Badge tone="success">{t('identity.cards.trusted')}</Badge>}
        </div>
        <Text tone="muted" size="sm">
          {t('identity.cards.deviceMeta', {
            ip: device.ipAddress ?? t('identity.cards.unknownIp'),
            date: formatDateTimeShort(device.lastSeenAt),
          })}
        </Text>
      </div>
      <div className="flex gap-2">
        {!device.trusted && (
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              onTrust(device.id);
            }}
          >
            {t('identity.cards.trust')}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() => {
            onRevoke(device.id);
          }}
        >
          {t('identity.cards.remove')}
        </Button>
      </div>
    </Card>
  );
};

interface ProfileCompletenessCardProps {
  percentage: number;
  missingFields: string[];
  className?: string;
}

export const ProfileCompletenessCard = ({
  percentage,
  missingFields,
  className,
}: ProfileCompletenessCardProps): ReactElement | null => {
  const t = useModuleMessages(enUsMessages);
  if (percentage >= 100) return null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <Text size="sm" className="font-medium">
          {t('identity.cards.profileCompleteness')}
        </Text>
        <Text size="sm" tone="muted">
          {t('identity.cards.percentage', { pct: percentage })}
        </Text>
      </div>
      <Progress value={percentage} />
      {missingFields.length > 0 && (
        <Text size="sm" tone="muted" className="mt-2">
          {t('identity.cards.missingPrefix', { fields: missingFields.join(', ') })}
        </Text>
      )}
    </div>
  );
};
