// main/apps/web/src/features/settings/components/DevicesList.tsx
/**
 * DevicesList — Displays and manages trusted devices.
 */

import { useAuth } from '@auth/hooks';
import { useDevices } from '@bslt/react';
import { Alert, Button, Card, Heading, Modal, Skeleton, Text } from '@bslt/ui';
import { DeviceRowCard } from '@bslt/ui/components';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import type { DeviceItem } from '@bslt/api';

// ============================================================================
// DevicesList
// ============================================================================

interface DevicesListProps {
  baseUrl: string;
  getToken?: () => string | null;
}

type GroupedDevice = DeviceItem & {
  memberIds: string[];
};

function getDeviceGroupKey(device: DeviceItem): string {
  const normalizedUserAgent = device.userAgent?.trim().toLowerCase() ?? '';
  if (normalizedUserAgent !== '') {
    return `ua:${normalizedUserAgent}`;
  }
  return `fingerprint:${device.deviceFingerprint}`;
}

function isBefore(left: string, right: string): boolean {
  return new Date(left).getTime() < new Date(right).getTime();
}

function isAfter(left: string, right: string): boolean {
  return new Date(left).getTime() > new Date(right).getTime();
}

export const DevicesList = ({ baseUrl, getToken }: DevicesListProps): ReactElement => {
  const { logout } = useAuth();
  const [invalidateMessage, setInvalidateMessage] = useState<string | null>(null);
  const [invalidateDialogOpen, setInvalidateDialogOpen] = useState(false);
  const clientConfig = useMemo(() => {
    const config: { baseUrl: string; getToken?: () => string | null } = { baseUrl };
    if (getToken !== undefined) {
      config.getToken = getToken;
    }
    return config;
  }, [baseUrl, getToken]);
  const { devices, isLoading, error, trustDevice, revokeDevice, invalidateSessions } = useDevices({
    clientConfig,
    autoFetch: true,
  });

  const groupedDevices = useMemo(() => {
    const groups = new Map<string, GroupedDevice>();

    for (const device of devices) {
      const key = getDeviceGroupKey(device);
      const existing = groups.get(key);

      if (existing === undefined) {
        groups.set(key, { ...device, memberIds: [device.id] });
        continue;
      }

      existing.memberIds.push(device.id);
      existing.trusted = existing.trusted && device.trusted;

      if (existing.label === null && device.label !== null) {
        existing.label = device.label;
      }
      if (isBefore(device.firstSeenAt, existing.firstSeenAt)) {
        existing.firstSeenAt = device.firstSeenAt;
      }
      if (isBefore(device.createdAt, existing.createdAt)) {
        existing.createdAt = device.createdAt;
      }
      if (isAfter(device.lastSeenAt, existing.lastSeenAt)) {
        existing.id = device.id;
        existing.deviceFingerprint = device.deviceFingerprint;
        existing.ipAddress = device.ipAddress;
        existing.userAgent = device.userAgent;
        existing.lastSeenAt = device.lastSeenAt;
      }
    }

    return [...groups.values()];
  }, [devices]);

  const getMemberIds = useCallback(
    (id: string): string[] => groupedDevices.find((device) => device.id === id)?.memberIds ?? [id],
    [groupedDevices],
  );

  const handleTrust = useCallback(
    (id: string) => {
      void Promise.all(getMemberIds(id).map((deviceId) => trustDevice(deviceId)));
    },
    [getMemberIds, trustDevice],
  );

  const handleRevoke = useCallback(
    (id: string) => {
      void Promise.all(getMemberIds(id).map((deviceId) => revokeDevice(deviceId)));
    },
    [getMemberIds, revokeDevice],
  );

  const handleInvalidateSessions = useCallback(() => {
    setInvalidateDialogOpen(true);
  }, []);

  const handleConfirmInvalidateSessions = useCallback(() => {
    setInvalidateDialogOpen(false);
    void invalidateSessions()
      .then(async () => {
        // Every session (including this one) is now invalid server-side —
        // clear the local session too; the route guard redirects to login.
        await logout();
      })
      .catch(() => {
        setInvalidateMessage('Could not sign out everywhere. Please try again.');
      });
  }, [invalidateSessions, logout]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton height="4rem" className="w-full" />
        <Skeleton height="4rem" className="w-full" />
      </div>
    );
  }

  if (error !== null) {
    return <Alert tone="danger">{error.message}</Alert>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Heading as="h4" size="sm">
            Known Devices ({String(groupedDevices.length)})
          </Heading>
          <Text tone="muted" size="sm">
            Devices are tracked when you sign in. Trust devices to skip new device alerts, or remove
            devices you no longer use.
          </Text>
        </div>
        {groupedDevices.length > 0 && (
          <Button type="button" variant="text" size="small" onClick={handleInvalidateSessions}>
            Sign out untrusted
          </Button>
        )}
      </div>
      {invalidateMessage !== null && <Alert tone="danger">{invalidateMessage}</Alert>}
      {groupedDevices.length === 0 ? (
        <Card className="p-4">
          <Text tone="muted">No devices recorded yet.</Text>
        </Card>
      ) : (
        <div className="space-y-3">
          {groupedDevices.map((device) => (
            <DeviceRowCard
              key={device.id}
              device={device}
              onTrust={handleTrust}
              onRevoke={handleRevoke}
            />
          ))}
        </div>
      )}
      <Modal.Root
        open={invalidateDialogOpen}
        onClose={() => {
          setInvalidateDialogOpen(false);
        }}
      >
        <Modal.Header>
          <Modal.Title>Sign Out Untrusted Devices</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Modal.Description>
            This will end every active session from devices you have not trusted.
          </Modal.Description>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setInvalidateDialogOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirmInvalidateSessions}>
            Confirm
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </section>
  );
};
