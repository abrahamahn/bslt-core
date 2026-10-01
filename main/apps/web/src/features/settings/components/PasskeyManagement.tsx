// main/apps/web/src/features/settings/components/PasskeyManagement.tsx
/**
 * Passkey management UI for Security settings.
 * Lists registered passkeys with rename/delete actions,
 * and provides an "Add Passkey" button.
 *
 * The passkey list/register hooks are only mounted when the server actually has
 * the `webauthn` auth strategy enabled — otherwise every request 404s with
 * "WebAuthn authentication is not enabled", which previously surfaced as a
 * duplicated raw error plus a non-functional button.
 */

import { useClientEnvironment } from '@app/ClientEnvironment';
import { usePasskeys, useRegisterPasskey } from '@auth/hooks';
import { useEnabledAuthStrategies } from '@bslt/react';
import { formatDateTime } from '@bslt/shared/helpers/date';
import { Badge, Button, Card, Input, Skeleton, Text } from '@bslt/ui';
import {
  useCallback,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import type { PasskeyListItem } from '@bslt/shared/core/auth';

// ============================================================================
// Passkey Row
// ============================================================================

interface PasskeyRowProps {
  passkey: PasskeyListItem;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const PasskeyRow = ({ passkey, onRename, onDelete }: PasskeyRowProps): ReactElement => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(passkey.name);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = useCallback(async () => {
    if (editName.trim() === '' || editName === passkey.name) {
      setIsEditing(false);
      return;
    }
    await onRename(passkey.id, editName.trim());
    setIsEditing(false);
  }, [editName, onRename, passkey.id, passkey.name]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditName(passkey.name);
  }, [passkey.name]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete(passkey.id);
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, passkey.id]);

  const deviceLabel =
    passkey.deviceType === 'multiDevice'
      ? 'Synced passkey'
      : passkey.deviceType === 'singleDevice'
        ? 'Device-bound'
        : 'Passkey';

  return (
    <Card className="p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEditName(e.target.value);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                } else if (e.key === 'Escape') {
                  handleCancel();
                }
              }}
              className="flex-1"
            />
            <Button
              size="small"
              onClick={() => {
                void handleSave();
              }}
            >
              Save
            </Button>
            <Button size="small" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <Text>{passkey.name}</Text>
              <Badge tone={passkey.backedUp ? 'success' : 'neutral'}>{deviceLabel}</Badge>
            </div>
            <Text size="sm" className="text-muted">
              Created {formatDateTime(passkey.createdAt)}
              {passkey.lastUsedAt !== null && ` · Last used ${formatDateTime(passkey.lastUsedAt)}`}
            </Text>
          </div>
        )}
      </div>

      {!isEditing && (
        <div className="flex items-center gap-2">
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              setIsEditing(true);
            }}
          >
            Rename
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              void handleDelete();
            }}
            disabled={isDeleting}
            className="text-danger"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      )}
    </Card>
  );
};

// ============================================================================
// Passkey List (only mounted when webauthn is enabled server-side)
// ============================================================================

const PasskeyList = ({ className }: { className?: string | undefined }): ReactElement => {
  const { passkeys, isLoading, error, refetch, rename, remove } = usePasskeys();
  const {
    register,
    isLoading: isRegistering,
    error: registerError,
  } = useRegisterPasskey(() => {
    void refetch();
  });

  if (isLoading) {
    return (
      <div className={className}>
        <Skeleton height="4rem" className="mb-2" />
        <Skeleton height="4rem" />
      </div>
    );
  }

  return (
    <div className={className}>
      {error !== null && (
        <Text tone="danger" className="mb-4">
          {error}
        </Text>
      )}
      {registerError !== null && registerError !== error && (
        <Text tone="danger" className="mb-4">
          {registerError}
        </Text>
      )}

      <div className="flex flex-col gap-3 mb-4">
        {passkeys.length === 0 ? (
          <Text className="text-muted">No passkeys registered yet.</Text>
        ) : (
          passkeys.map((pk) => (
            <PasskeyRow key={pk.id} passkey={pk} onRename={rename} onDelete={remove} />
          ))
        )}
      </div>

      <Button
        onClick={() => {
          void register();
        }}
        disabled={isRegistering}
      >
        {isRegistering ? 'Registering...' : 'Add Passkey'}
      </Button>
    </div>
  );
};

// ============================================================================
// PasskeyManagement
// ============================================================================

export interface PasskeyManagementProps {
  className?: string;
}

export function PasskeyManagement({ className }: PasskeyManagementProps): ReactElement {
  const { config } = useClientEnvironment();
  const strategyState = useEnabledAuthStrategies({ baseUrl: config.apiUrl });

  // WebAuthn requires a supporting browser AND the server strategy to be enabled.
  const isSupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;
  if (!isSupported) {
    return (
      <div className={className}>
        <Text className="text-muted">Passkeys are not supported in this browser.</Text>
      </div>
    );
  }

  if (strategyState.isLoading) {
    return (
      <div className={className}>
        <Skeleton height="4rem" />
      </div>
    );
  }

  const webauthnEnabled =
    strategyState.error === null && strategyState.enabled.includes('webauthn');
  if (!webauthnEnabled) {
    return (
      <div className={`flex flex-col gap-1 ${className ?? ''}`}>
        <Text className="text-muted">Passkeys are not enabled on this server.</Text>
        <Text size="sm" className="text-muted">
          To turn them on, add <code>webauthn</code> to <code>AUTH_STRATEGIES</code> in the server
          environment (e.g. <code>AUTH_STRATEGIES=local,webauthn</code>) and configure the WebAuthn
          relying party. See <code>docs/specs/auth.md</code>.
        </Text>
      </div>
    );
  }

  return <PasskeyList className={className} />;
}
