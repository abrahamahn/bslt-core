// main/modules/identity/web/IdentityAccountSettings.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';

import { Alert, Button, Card, Dialog, FormField, Heading, Input, Skeleton, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import { ACCOUNT_DELETION_GRACE_PERIOD_DAYS, type DeviceItem } from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { useAuth } from './authService';
import {
  useDeactivateAccount,
  useDeleteAccount,
  useDevices,
  useLogoutAll,
  useReactivateAccount,
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useSudo,
} from './hooks';
import {
  DeviceRowCard,
  SessionCard,
  type SessionCardProps,
  type SessionCardSession,
} from './IdentityCards';

export { SessionCard, type SessionCardProps, type SessionCardSession };

// ============================================================================
// SessionsList
// ============================================================================

interface SessionLocal {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  isCurrent: boolean;
}

type PendingConfirmation =
  | { kind: 'revoke'; sessionId: string }
  | { kind: 'revoke-all-other'; count: number }
  | { kind: 'logout-all' }
  | null;

export interface SessionsListProps {
  onRevokeSuccess?: () => void;
}

export const SessionsList = ({ onRevokeSuccess }: SessionsListProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { logout } = useAuth();
  const logoutAll = useLogoutAll();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<Error | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);

  const { sessions, isLoading, isError, error, refetch } = useSessions();
  const allSessions = sessions as SessionLocal[];
  const otherSessions = allSessions.filter((s: SessionLocal) => !s.isCurrent);
  const currentSession = allSessions.find((s: SessionLocal) => s.isCurrent);

  const {
    revokeSession,
    isLoading: isRevokingSingle,
    error: revokeError,
  } = useRevokeSession({
    onSuccess: () => {
      setRevokingId(null);
      refetch();
      onRevokeSuccess?.();
    },
    onError: () => {
      setRevokingId(null);
    },
  });

  const {
    revokeAllSessions,
    isLoading: isRevokingAll,
    error: revokeAllError,
    revokedCount,
  } = useRevokeAllSessions({
    onSuccess: () => {
      refetch();
      onRevokeSuccess?.();
    },
  });

  const handleRevoke = (sessionId: string): void => {
    setPendingConfirmation({ kind: 'revoke', sessionId });
  };

  const handleRevokeAll = (): void => {
    if (otherSessions.length === 0) return;
    setPendingConfirmation({ kind: 'revoke-all-other', count: otherSessions.length });
  };

  const handleLogoutAll = (): void => {
    setPendingConfirmation({ kind: 'logout-all' });
  };

  const handleConfirmAction = (): void => {
    const action = pendingConfirmation;
    setPendingConfirmation(null);
    if (action === null) return;

    if (action.kind === 'revoke') {
      setRevokingId(action.sessionId);
      revokeSession(action.sessionId);
      return;
    }

    if (action.kind === 'revoke-all-other') {
      revokeAllSessions();
      return;
    }

    setLogoutAllLoading(true);
    setLogoutAllError(null);
    void logoutAll()
      .then(async () => {
        await logout();
      })
      .catch((caught: unknown) => {
        setLogoutAllError(caught instanceof Error ? caught : new Error(String(caught)));
        setLogoutAllLoading(false);
      });
  };

  const confirmationCopy = useMemo(() => {
    if (pendingConfirmation?.kind === 'revoke') {
      return {
        title: t('identity.sessions.confirmEndTitle'),
        description: t('identity.sessions.confirmEndBody'),
        confirmLabel: t('identity.sessions.confirmAction'),
      };
    }
    if (pendingConfirmation?.kind === 'revoke-all-other') {
      return {
        title: t('identity.sessions.confirmOtherTitle'),
        description:
          pendingConfirmation.count === 1
            ? t('identity.sessions.confirmOtherSingle')
            : t('identity.sessions.confirmOtherPlural', {
                count: String(pendingConfirmation.count),
              }),
        confirmLabel: t('identity.sessions.confirmAction'),
      };
    }
    return {
      title: t('identity.sessions.confirmEverywhereTitle'),
      description: t('identity.sessions.confirmEverywhereBody'),
      confirmLabel: t('identity.sessions.confirmAction'),
    };
  }, [pendingConfirmation, t]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton height="6rem" className="w-full" />
        <Skeleton height="6rem" className="w-full" />
        <Skeleton height="6rem" className="w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert tone="danger">
        {t('identity.sessions.loadFailed', {
          error: error?.message ?? t('identity.sessions.unknownError'),
        })}
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {revokedCount !== null && revokedCount > 0 ? (
        <Alert tone="success">
          {revokedCount === 1
            ? t('identity.sessions.revokedSingle')
            : t('identity.sessions.revokedPlural', { count: String(revokedCount) })}
        </Alert>
      ) : null}

      {revokeError !== null || revokeAllError !== null ? (
        <Alert tone="danger">{revokeError?.message ?? revokeAllError?.message}</Alert>
      ) : null}

      {logoutAllError !== null ? <Alert tone="danger">{logoutAllError.message}</Alert> : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="text"
          size="small"
          className="text-danger"
          onClick={handleLogoutAll}
          disabled={logoutAllLoading}
        >
          {logoutAllLoading
            ? t('identity.sessions.signingOut')
            : t('identity.sessions.signOutEverywhere')}
        </Button>
      </div>

      {currentSession !== undefined ? (
        <SessionCard session={currentSession} onRevoke={() => {}} />
      ) : null}

      {otherSessions.length > 0 ? (
        <div className="border-t mt-6 pt-6">
          <div className="flex items-center justify-between mb-4">
            <Heading as="h3" className="font-medium">
              {t('identity.sessions.otherDevicesHeading', {
                count: String(otherSessions.length),
              })}
            </Heading>
            <Button
              variant="text"
              size="small"
              onClick={handleRevokeAll}
              disabled={isRevokingAll || isRevokingSingle}
              className="text-danger"
            >
              {isRevokingAll
                ? t('identity.sessions.loggingOut')
                : t('identity.sessions.logOutOtherDevices')}
            </Button>
          </div>

          <div className="space-y-3">
            {otherSessions.map((session: SessionLocal) => (
              <SessionCard
                key={session.id}
                session={session}
                onRevoke={() => {
                  handleRevoke(session.id);
                }}
                isRevoking={revokingId === session.id}
              />
            ))}
          </div>
        </div>
      ) : null}

      {sessions.length === 1 ? (
        <Text size="sm" tone="muted" className="text-center py-4">
          {t('identity.sessions.onlyActiveSession')}
        </Text>
      ) : null}

      <Dialog.Root
        open={pendingConfirmation !== null}
        onClose={() => {
          setPendingConfirmation(null);
        }}
      >
        <Dialog.Header>
          <Dialog.Title>{confirmationCopy.title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Dialog.Description>{confirmationCopy.description}</Dialog.Description>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPendingConfirmation(null);
            }}
          >
            {t('identity.sessions.cancelAction')}
          </Button>
          <Button type="button" onClick={handleConfirmAction}>
            {confirmationCopy.confirmLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Root>
    </div>
  );
};

// ============================================================================
// DevicesList
// ============================================================================

export interface DevicesListProps {
  baseUrl?: string;
  getToken?: () => string | null;
}

type GroupedDevice = {
  -readonly [K in keyof DeviceItem]: DeviceItem[K];
} & {
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

export const DevicesList = (_props: DevicesListProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const { logout } = useAuth();
  const [invalidateMessage, setInvalidateMessage] = useState<string | null>(null);
  const [invalidateDialogOpen, setInvalidateDialogOpen] = useState(false);
  const { devices, isLoading, error, trustDevice, revokeDevice, invalidateSessions } = useDevices({
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
        await logout();
      })
      .catch(() => {
        setInvalidateMessage(t('identity.devices.invalidateFailed'));
      });
  }, [invalidateSessions, logout, t]);

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
            {t('identity.devices.knownDevicesHeading', { count: String(groupedDevices.length) })}
          </Heading>
          <Text tone="muted" size="sm">
            {t('identity.devices.knownDevicesDescription')}
          </Text>
        </div>
        {groupedDevices.length > 0 ? (
          <Button type="button" variant="text" size="small" onClick={handleInvalidateSessions}>
            {t('identity.devices.signOutUntrusted')}
          </Button>
        ) : null}
      </div>
      {invalidateMessage !== null ? <Alert tone="danger">{invalidateMessage}</Alert> : null}
      {groupedDevices.length === 0 ? (
        <Card className="p-4">
          <Text tone="muted">{t('identity.devices.empty')}</Text>
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
      <Dialog.Root
        open={invalidateDialogOpen}
        onClose={() => {
          setInvalidateDialogOpen(false);
        }}
      >
        <Dialog.Header>
          <Dialog.Title>{t('identity.devices.dialogTitle')}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Dialog.Description>{t('identity.devices.dialogBody')}</Dialog.Description>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setInvalidateDialogOpen(false);
            }}
          >
            {t('identity.devices.cancelAction')}
          </Button>
          <Button type="button" onClick={handleConfirmInvalidateSessions}>
            {t('identity.devices.confirmAction')}
          </Button>
        </Dialog.Footer>
      </Dialog.Root>
    </section>
  );
};

// ============================================================================
// SudoModal
// ============================================================================

type SudoStep = 'action' | 'identity';

export interface SudoModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onSuccess: (sudoToken: string) => void;
  onDismiss: () => void;
}

export const SudoModal = ({
  open,
  title,
  description,
  confirmLabel,
  onSuccess,
  onDismiss,
}: SudoModalProps): ReactElement | null => {
  const t = useModuleMessages(enUsMessages);
  const [step, setStep] = useState<SudoStep>('action');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const { sudo, isLoading, error, reset } = useSudo({
    onSuccess: (response) => {
      setStep('action');
      setPassword('');
      setTotpCode('');
      reset();
      onSuccess(response.sudoToken);
    },
  });

  const clearIdentityStep = (): void => {
    setPassword('');
    setTotpCode('');
    reset();
  };

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const data: { password?: string; totpCode?: string } = {};
    if (password.length > 0) {
      data.password = password;
    }
    if (totpCode.length > 0) {
      data.totpCode = totpCode;
    }
    sudo(data);
  };

  const handleClose = (): void => {
    clearIdentityStep();
    setStep('action');
    onDismiss();
  };

  const handleBackToAction = (): void => {
    clearIdentityStep();
    setStep('action');
  };

  if (!open) return null;

  return (
    <Dialog.Root open={open} onClose={handleClose}>
      {step === 'action' ? (
        <>
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Footer>
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('identity.sudo.cancelAction')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setStep('identity');
              }}
            >
              {confirmLabel ?? t('identity.sudo.continueAction')}
            </Button>
          </Dialog.Footer>
        </>
      ) : (
        <>
          <Dialog.Header>
            <Dialog.Title>{t('identity.sudo.confirmIdentityTitle')}</Dialog.Title>
            <Dialog.Description>{t('identity.sudo.confirmIdentityBody')}</Dialog.Description>
            <Dialog.Close />
          </Dialog.Header>

          <form onSubmit={handleSubmit}>
            <Dialog.Body>
              <div className="space-y-4">
                <FormField label={t('identity.sudo.passwordLabel')} htmlFor="sudo-password">
                  <Input
                    id="sudo-password"
                    name="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                    }}
                    placeholder={t('identity.sudo.passwordPlaceholder')}
                    autoComplete="current-password"
                    required
                  />
                </FormField>

                <FormField label={t('identity.sudo.totpLabel')} htmlFor="sudo-totp">
                  <Input
                    id="sudo-totp"
                    type="text"
                    value={totpCode}
                    onChange={(e) => {
                      setTotpCode(e.target.value);
                    }}
                    placeholder={t('identity.sudo.totpPlaceholder')}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <Text size="sm" tone="muted" className="mt-1">
                    {t('identity.sudo.totpHint')}
                  </Text>
                </FormField>

                {error !== null ? <Alert tone="danger">{error.message}</Alert> : null}
              </div>
            </Dialog.Body>

            <Dialog.Footer>
              <Button type="button" variant="secondary" onClick={handleBackToAction}>
                {t('identity.sudo.cancelAction')}
              </Button>
              <Button type="submit" disabled={password.length === 0 || isLoading}>
                {isLoading ? t('identity.sudo.verifying') : t('identity.sudo.confirmAction')}
              </Button>
            </Dialog.Footer>
          </form>
        </>
      )}
    </Dialog.Root>
  );
};

// ============================================================================
// DeletionStatusIndicator
// ============================================================================

const MS_PER_DAY = 86_400_000;

export interface DeletionStatusIndicatorProps {
  scheduledDeletionAt: string;
  isCanceling?: boolean;
  onCancelDeletion?: () => void;
  className?: string;
}

function calculateDaysLeft(scheduledAt: string): number {
  const diff = new Date(scheduledAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / MS_PER_DAY));
}

function calculateProgress(scheduledAt: string, gracePeriodDays: number): number {
  const daysLeft = calculateDaysLeft(scheduledAt);
  const elapsed = gracePeriodDays - daysLeft;
  const pct = (elapsed / gracePeriodDays) * 100;
  return Math.min(100, Math.max(0, pct));
}

export const DeletionStatusIndicator = ({
  scheduledDeletionAt,
  isCanceling = false,
  onCancelDeletion,
  className,
}: DeletionStatusIndicatorProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const fillRef = useRef<HTMLDivElement>(null);
  const daysLeft = useMemo(() => calculateDaysLeft(scheduledDeletionAt), [scheduledDeletionAt]);

  const progressPct = useMemo(
    () => calculateProgress(scheduledDeletionAt, ACCOUNT_DELETION_GRACE_PERIOD_DAYS),
    [scheduledDeletionAt],
  );

  useEffect(() => {
    if (fillRef.current !== null) {
      fillRef.current.style.width = `${String(progressPct)}%`;
    }
  }, [progressPct]);

  const handleCancel = useCallback(() => {
    onCancelDeletion?.();
  }, [onCancelDeletion]);

  const isExpired = daysLeft === 0;
  const roundedPct = String(Math.round(progressPct));

  return (
    <Card
      className={`p-4 border-2 border-danger ${className ?? ''}`}
      data-testid="deletion-status-indicator"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading as="h4" size="sm" className="text-danger">
            {t('identity.deletionStatus.heading')}
          </Heading>
        </div>

        <Alert tone="danger" data-testid="deletion-countdown-alert">
          {isExpired
            ? t('identity.deletionStatus.expiredAlert')
            : daysLeft === 1
              ? t('identity.deletionStatus.countdownSingular')
              : t('identity.deletionStatus.countdownPlural', { days: String(daysLeft) })}
        </Alert>

        <div className="space-y-1">
          <div className="flex justify-between">
            <Text size="xs" tone="muted">
              {t('identity.deletionStatus.gracePeriodLabel')}
            </Text>
            <Text size="xs" tone="muted">
              {t('identity.deletionStatus.elapsedPct', { pct: roundedPct })}
            </Text>
          </div>
          <div
            className="settings-deletion-progress"
            role="progressbar"
            aria-valuenow={Math.round(progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('identity.deletionStatus.progressAria', { pct: roundedPct })}
            data-testid="deletion-progress-bar"
          >
            <div ref={fillRef} className="settings-deletion-progress__fill" />
          </div>
        </div>

        <Text size="sm" tone="muted">
          {isExpired
            ? t('identity.deletionStatus.expiredBody')
            : daysLeft === 1
              ? t('identity.deletionStatus.remainingSingular')
              : t('identity.deletionStatus.remainingPlural', { days: String(daysLeft) })}
        </Text>

        {!isExpired && onCancelDeletion !== undefined ? (
          <Button
            type="button"
            variant="primary"
            onClick={handleCancel}
            disabled={isCanceling}
            data-testid="cancel-deletion-button"
          >
            {isCanceling
              ? t('identity.deletionStatus.canceling')
              : t('identity.deletionStatus.cancelAction')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
};

// ============================================================================
// DangerZone
// ============================================================================

type PendingAction = 'deactivate' | 'delete' | null;

export interface DangerZoneProps {
  accountStatus?: 'active' | 'deactivated' | 'pending_deletion';
  gracePeriodEnds?: string | undefined;
  onActionComplete?: () => void;
}

export const DangerZone = ({
  accountStatus = 'active',
  gracePeriodEnds,
  onActionComplete,
}: DangerZoneProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    deactivate,
    isLoading: isDeactivating,
    error: deactivateError,
    reset: resetDeactivate,
  } = useDeactivateAccount({
    onSuccess: (response) => {
      setSuccessMessage(response.message);
      setDeactivateReason('');
      onActionComplete?.();
    },
  });

  const {
    requestDeletion,
    isLoading: isDeleting,
    error: deleteError,
    reset: resetDelete,
  } = useDeleteAccount({
    onSuccess: (response) => {
      setSuccessMessage(response.message);
      setDeleteReason('');
      onActionComplete?.();
    },
  });

  const {
    reactivate,
    isLoading: isReactivating,
    error: reactivateError,
    reset: resetReactivate,
  } = useReactivateAccount({
    onSuccess: (response) => {
      setSuccessMessage(response.message);
      onActionComplete?.();
    },
  });

  const handleStartAction = (action: PendingAction): void => {
    setPendingAction(action);
    setSuccessMessage(null);
    resetDeactivate();
    resetDelete();
    resetReactivate();
  };

  const handleSudoSuccess = (sudoToken: string): void => {
    const trimmedReason = (pendingAction === 'deactivate' ? deactivateReason : deleteReason).trim();
    const normalizedReason = trimmedReason !== '' ? trimmedReason : undefined;
    if (pendingAction === 'deactivate') {
      deactivate({ reason: normalizedReason }, sudoToken);
    } else if (pendingAction === 'delete') {
      requestDeletion({ reason: normalizedReason }, sudoToken);
    }
    setPendingAction(null);
  };

  const handleSudoDismiss = (): void => {
    setPendingAction(null);
  };

  const currentError = deactivateError ?? deleteError ?? reactivateError;
  const isAnyLoading = isDeactivating || isDeleting || isReactivating;

  const actionCopy =
    pendingAction === 'deactivate'
      ? {
          title: t('identity.dangerZone.deactivateModalTitle'),
          description: t('identity.dangerZone.deactivateModalBody'),
          confirmLabel: t('identity.sudo.continueAction'),
        }
      : pendingAction === 'delete'
        ? {
            title: t('identity.dangerZone.deleteModalTitle'),
            description: t('identity.dangerZone.deleteModalBody'),
            confirmLabel: t('identity.sudo.continueAction'),
          }
        : null;

  return (
    <>
      <div className="settings-danger-zone">
        <div className="settings-danger-zone__header">
          <Heading as="h3" size="md" className="text-danger">
            {t('identity.dangerZone.heading')}
          </Heading>
          <Text tone="muted" size="sm">
            {t('identity.dangerZone.subtitle')}
          </Text>
        </div>

        {successMessage !== null ? <Alert tone="success">{successMessage}</Alert> : null}
        {currentError !== null ? <Alert tone="danger">{currentError.message}</Alert> : null}

        {accountStatus === 'pending_deletion' && gracePeriodEnds !== undefined ? (
          <DeletionStatusIndicator
            scheduledDeletionAt={gracePeriodEnds}
            isCanceling={isReactivating}
            onCancelDeletion={() => {
              setSuccessMessage(null);
              reactivate();
            }}
          />
        ) : null}

        {accountStatus === 'deactivated' ||
        (accountStatus === 'pending_deletion' && gracePeriodEnds === undefined) ? (
          <section className="settings-action-panel">
            <div className="settings-action-panel__copy">
              <Text className="font-medium">{t('identity.dangerZone.reactivateHeading')}</Text>
              <Text size="sm" tone="muted">
                {accountStatus === 'pending_deletion'
                  ? t('identity.dangerZone.reactivatePendingBody')
                  : t('identity.dangerZone.reactivateDeactivatedBody')}
              </Text>
            </div>
            <div className="settings-action-panel__actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setSuccessMessage(null);
                  reactivate();
                }}
                disabled={isAnyLoading}
              >
                {isReactivating
                  ? t('identity.dangerZone.reactivating')
                  : t('identity.dangerZone.reactivateAction')}
              </Button>
            </div>
          </section>
        ) : null}

        {accountStatus === 'active' ? (
          <section className="settings-action-panel settings-action-panel--warning">
            <div className="settings-action-panel__copy">
              <Text className="font-medium">{t('identity.dangerZone.deactivateHeading')}</Text>
              <Text size="sm" tone="muted">
                {t('identity.dangerZone.deactivateBody')}
              </Text>
            </div>
            <FormField
              label={t('identity.dangerZone.reasonOptionalLabel')}
              htmlFor="deactivate-reason"
            >
              <Input
                id="deactivate-reason"
                name="deactivate-reason"
                type="text"
                value={deactivateReason}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setDeactivateReason(e.target.value);
                }}
                placeholder={t('identity.dangerZone.deactivateReasonPlaceholder')}
                maxLength={500}
                autoComplete="off"
              />
            </FormField>
            <div className="settings-action-panel__actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  handleStartAction('deactivate');
                }}
                disabled={isAnyLoading}
              >
                {isDeactivating
                  ? t('identity.dangerZone.deactivating')
                  : t('identity.dangerZone.deactivateAction')}
              </Button>
            </div>
          </section>
        ) : null}

        {accountStatus !== 'pending_deletion' ? (
          <section className="settings-action-panel settings-action-panel--danger">
            <div className="settings-action-panel__copy">
              <Text className="font-medium text-danger">
                {t('identity.dangerZone.deleteHeading')}
              </Text>
              <Text size="sm" tone="muted">
                {t('identity.dangerZone.deleteBody')}
              </Text>
            </div>
            {accountStatus === 'active' ? (
              <FormField
                label={t('identity.dangerZone.reasonOptionalLabel')}
                htmlFor="delete-reason"
              >
                <Input
                  id="delete-reason"
                  name="delete-reason"
                  type="text"
                  value={deleteReason}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setDeleteReason(e.target.value);
                  }}
                  placeholder={t('identity.dangerZone.deleteReasonPlaceholder')}
                  maxLength={500}
                  autoComplete="off"
                />
              </FormField>
            ) : null}
            <div className="settings-action-panel__actions">
              <Button
                type="button"
                variant="secondary"
                className="text-danger border-danger"
                onClick={() => {
                  handleStartAction('delete');
                }}
                disabled={isAnyLoading}
              >
                {isDeleting
                  ? t('identity.dangerZone.requestingDeletion')
                  : t('identity.dangerZone.deleteAction')}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      {actionCopy !== null ? (
        <SudoModal
          open={true}
          title={actionCopy.title}
          description={actionCopy.description}
          confirmLabel={actionCopy.confirmLabel}
          onSuccess={handleSudoSuccess}
          onDismiss={handleSudoDismiss}
        />
      ) : null}
    </>
  );
};
