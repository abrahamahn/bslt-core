// main/apps/web/src/features/settings/components/DangerZone.tsx
/**
 * Danger Zone Component
 *
 * Red card with account deactivation, deletion, and reactivation actions.
 * Integrates with SudoModal for re-authentication before destructive actions.
 */

import { Alert, Button, FormField, Heading, Input, Text } from '@bslt/ui';
import { useState, type ChangeEvent, type ReactElement } from 'react';

import {
  useDeactivateAccount,
  useDeleteAccount,
  useReactivateAccount,
} from '../hooks/useAccountLifecycle';

import { DeletionStatusIndicator } from './DeletionStatusIndicator';
import { SudoModal } from './SudoModal';

// ============================================================================
// Types
// ============================================================================

type PendingAction = 'deactivate' | 'delete' | null;

/** Copy for the action-confirmation step of the sudo modal, per action. */
const ACTION_COPY: Record<
  Exclude<PendingAction, null>,
  { title: string; description: string; confirmLabel: string }
> = {
  deactivate: {
    title: 'Deactivate Account',
    description:
      'Your account will be temporarily disabled. You can reactivate it at any time, and your data will be preserved.',
    confirmLabel: 'Continue',
  },
  delete: {
    title: 'Delete Account',
    description:
      'Your account and all associated data will be permanently deleted after a 30-day grace period. You can cancel the deletion during the grace period.',
    confirmLabel: 'Continue',
  },
};

export interface DangerZoneProps {
  /** Current account status */
  accountStatus?: 'active' | 'deactivated' | 'pending_deletion';
  /** ISO 8601 timestamp when the deletion grace period ends (drives the countdown copy) */
  gracePeriodEnds?: string | undefined;
  /** Called after a successful action (to reload user state) */
  onActionComplete?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const DangerZone = ({
  accountStatus = 'active',
  gracePeriodEnds,
  onActionComplete,
}: DangerZoneProps): ReactElement => {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  // Each action owns its reason input — shared state would bleed text between forms.
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

  return (
    <>
      <div className="settings-danger-zone">
        <div className="settings-danger-zone__header">
          <Heading as="h3" size="md" className="text-danger">
            Danger Zone
          </Heading>
          <Text tone="muted" size="sm">
            These actions are destructive and may not be reversible. Proceed with caution.
          </Text>
        </div>

        {successMessage !== null && <Alert tone="success">{successMessage}</Alert>}
        {currentError !== null && <Alert tone="danger">{currentError.message}</Alert>}

        {/* Pending deletion with a known grace-period end → rich countdown card
            (progress bar + cancel). Cancelling reactivates the account. */}
        {accountStatus === 'pending_deletion' && gracePeriodEnds !== undefined && (
          <DeletionStatusIndicator
            scheduledDeletionAt={gracePeriodEnds}
            isCanceling={isReactivating}
            onCancelDeletion={() => {
              setSuccessMessage(null);
              reactivate();
            }}
          />
        )}

        {/* Reactivate - shown when deactivated, or pending deletion without a
            known end date (no countdown to render in the richer card). */}
        {(accountStatus === 'deactivated' ||
          (accountStatus === 'pending_deletion' && gracePeriodEnds === undefined)) && (
          <section className="settings-action-panel">
            <div className="settings-action-panel__copy">
              <Text className="font-medium">Reactivate Account</Text>
              <Text size="sm" tone="muted">
                {accountStatus === 'pending_deletion'
                  ? 'Your account is scheduled for deletion. Reactivating will cancel the deletion.'
                  : 'Your account is currently deactivated. Reactivate to restore access.'}
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
                {isReactivating ? 'Reactivating...' : 'Reactivate Account'}
              </Button>
            </div>
          </section>
        )}

        {/* Deactivate - shown when active */}
        {accountStatus === 'active' && (
          <section className="settings-action-panel settings-action-panel--warning">
            <div className="settings-action-panel__copy">
              <Text className="font-medium">Deactivate Account</Text>
              <Text size="sm" tone="muted">
                Temporarily disable your account. You can reactivate it later. Your data will be
                preserved.
              </Text>
            </div>
            <FormField label="Reason (optional)" htmlFor="deactivate-reason">
              <Input
                id="deactivate-reason"
                name="deactivate-reason"
                type="text"
                value={deactivateReason}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setDeactivateReason(e.target.value);
                }}
                placeholder="Why are you deactivating?"
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
                {isDeactivating ? 'Deactivating...' : 'Deactivate Account'}
              </Button>
            </div>
          </section>
        )}

        {/* Delete - shown when active or deactivated */}
        {accountStatus !== 'pending_deletion' && (
          <section className="settings-action-panel settings-action-panel--danger">
            <div className="settings-action-panel__copy">
              <Text className="font-medium text-danger">Delete Account</Text>
              <Text size="sm" tone="muted">
                Permanently delete your account and all associated data. You will have a 30-day
                grace period to cancel this action.
              </Text>
            </div>
            {accountStatus === 'active' && (
              <FormField label="Reason (optional)" htmlFor="delete-reason">
                <Input
                  id="delete-reason"
                  name="delete-reason"
                  type="text"
                  value={deleteReason}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setDeleteReason(e.target.value);
                  }}
                  placeholder="Why are you deleting your account?"
                  maxLength={500}
                  autoComplete="off"
                />
              </FormField>
            )}
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
                {isDeleting ? 'Requesting deletion...' : 'Delete Account'}
              </Button>
            </div>
          </section>
        )}
      </div>

      {/* Conditional render ensures the modal (and its password field) fully
          unmounts between actions — no stale state, no lingering extension overlays. */}
      {pendingAction !== null && (
        <SudoModal
          open={true}
          title={ACTION_COPY[pendingAction].title}
          description={ACTION_COPY[pendingAction].description}
          confirmLabel={ACTION_COPY[pendingAction].confirmLabel}
          onSuccess={handleSudoSuccess}
          onDismiss={handleSudoDismiss}
        />
      )}
    </>
  );
};
