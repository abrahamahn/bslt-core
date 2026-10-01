// main/client/ui/src/components/DeviceRowCard.tsx
import { formatDateTime } from '@bslt/shared/helpers/date';
import { parseUserAgent } from '@bslt/shared/system/http';

import { Badge } from '../elements/Badge';
import { Button } from '../elements/Button';
import { Text } from '../elements/Text';

import { Card } from './Card';

import type { ReactElement } from 'react';

export interface DeviceRowCardDevice {
  id: string;
  label: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  trusted: boolean;
}

export interface DeviceRowCardProps {
  device: DeviceRowCardDevice;
  onTrust: (id: string) => void;
  onRevoke: (id: string) => void;
}

export const DeviceRowCard = ({ device, onTrust, onRevoke }: DeviceRowCardProps): ReactElement => {
  const { browser } = parseUserAgent(device.userAgent);

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Text>{device.label ?? browser}</Text>
          {device.trusted && <Badge tone="success">Trusted</Badge>}
        </div>
        <Text tone="muted" size="sm">
          {device.ipAddress ?? 'Unknown IP'} &middot; Last seen {formatDateTime(device.lastSeenAt)}
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
            Trust
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
          Remove
        </Button>
      </div>
    </Card>
  );
};
