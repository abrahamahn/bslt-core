// main/apps/web/src/features/settings/components/SessionsList.tsx
/**
 * Sessions List Component
 *
 * Displays list of user sessions with revoke functionality.
 */

import { getAccessToken } from '@app/authToken';
import { useClientEnvironment } from '@app/ClientEnvironment';
import { useAuth } from '@auth/hooks';
import { getApiClient } from '@bslt/api';
import { Alert, Button, Heading, Modal, Skeleton, Text } from '@bslt/ui';
import { useMemo, useState, type ReactElement } from 'react';

import { useRevokeAllSessions, useRevokeSession, useSessions } from '../hooks';

import { SessionCard } from './SessionCard';

// ============================================================================
// Local Types (for ESLint type resolution)
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

// ============================================================================
// Types
// ============================================================================

export interface SessionsListProps {
  onRevokeSuccess?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const SessionsList = ({ onRevokeSuccess }: SessionsListProps): ReactElement => {
  const { config } = useClientEnvironment();
  const { logout } = useAuth();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<Error | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);

  const api = useMemo(
    () =>
      getApiClient({
        baseUrl: config.apiUrl,
        getToken: getAccessToken,
      }),
    [config.apiUrl],
  );

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
    if (otherSessions.length === 0) {
      return;
    }

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
    void api
      .logoutAll()
      .then(async () => {
        // The server killed every session (token-version bump + refresh
        // revocation). Honor the "including this browser" promise: clear the
        // local session too — the route guard then redirects to login.
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
        title: 'End Session',
        description: 'This device will be signed out immediately.',
        confirmLabel: 'Confirm',
      };
    }
    if (pendingConfirmation?.kind === 'revoke-all-other') {
      return {
        title: 'Log Out All Other Devices',
        description: `This will end ${String(pendingConfirmation.count)} other active session${
          pendingConfirmation.count === 1 ? '' : 's'
        }.`,
        confirmLabel: 'Confirm',
      };
    }
    return {
      title: 'Sign Out Everywhere',
      description: 'This will end every active session, including this browser.',
      confirmLabel: 'Confirm',
    };
  }, [pendingConfirmation]);

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
      <Alert tone="danger">Failed to load sessions: {error?.message ?? 'Unknown error'}</Alert>
    );
  }

  return (
    <div className="space-y-4">
      {revokedCount !== null && revokedCount > 0 && (
        <Alert tone="success">
          Successfully logged out from {revokedCount} device{revokedCount === 1 ? '' : 's'}.
        </Alert>
      )}

      {(revokeError !== null || revokeAllError !== null) && (
        <Alert tone="danger">{revokeError?.message ?? revokeAllError?.message}</Alert>
      )}

      {logoutAllError !== null && <Alert tone="danger">{logoutAllError.message}</Alert>}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="text"
          size="small"
          className="text-danger"
          onClick={handleLogoutAll}
          disabled={logoutAllLoading}
        >
          {logoutAllLoading ? 'Signing out...' : 'Sign out everywhere'}
        </Button>
      </div>

      {/* Current Session */}
      {currentSession !== undefined && <SessionCard session={currentSession} onRevoke={() => {}} />}

      {/* Other Sessions */}
      {otherSessions.length > 0 && (
        <>
          <div className="border-t mt-6 pt-6">
            <div className="flex items-center justify-between mb-4">
              <Heading as="h3" className="font-medium">
                Other Devices ({otherSessions.length})
              </Heading>
              <Button
                variant="text"
                size="small"
                onClick={handleRevokeAll}
                disabled={isRevokingAll || isRevokingSingle}
                className="text-danger"
              >
                {isRevokingAll ? 'Logging out...' : 'Log out all other devices'}
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
        </>
      )}

      {sessions.length === 1 && (
        <Text size="sm" tone="muted" className="text-center py-4">
          This is your only active session.
        </Text>
      )}

      <Modal.Root
        open={pendingConfirmation !== null}
        onClose={() => {
          setPendingConfirmation(null);
        }}
      >
        <Modal.Header>
          <Modal.Title>{confirmationCopy.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Modal.Description>{confirmationCopy.description}</Modal.Description>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPendingConfirmation(null);
            }}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirmAction}>
            {confirmationCopy.confirmLabel}
          </Button>
        </Modal.Footer>
      </Modal.Root>
    </div>
  );
};
