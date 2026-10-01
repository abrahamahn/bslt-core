// main/apps/web/src/features/settings/components/BackupCodesDisplay.tsx
import { Alert, Button, Card, Heading, Input, Skeleton, Text } from '@bslt/ui';
import { useState, type ChangeEvent, type ReactElement } from 'react';

import { useBackupCodes } from '../hooks/useBackupCodes';

export interface BackupCodesDisplayProps {
  className?: string;
}

export const BackupCodesDisplay = ({ className }: BackupCodesDisplayProps): ReactElement => {
  const { status, isLoading, isRegenerating, newCodes, error, regenerate, dismissCodes } =
    useBackupCodes();
  const [confirmCode, setConfirmCode] = useState('');
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const handleRegenerate = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await regenerate(confirmCode);
    setConfirmCode('');
    setShowRegenerateForm(false);
  };

  const handleCopyAll = async (): Promise<void> => {
    if (newCodes === null) return;
    try {
      await navigator.clipboard.writeText(newCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => {
        setCopiedCodes(false);
      }, 2000);
    } catch {
      // Clipboard API may not be available in all contexts.
    }
  };

  const handleDismissCodes = (): void => {
    setCopiedCodes(false);
    dismissCodes();
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <Card.Body>
          <div className="space-y-3">
            <Skeleton height="1.25rem" width="12rem" />
            <Skeleton height="1rem" width="8rem" />
          </div>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <Card.Body>
        <div className="space-y-4">
          <div>
            <Heading as="h4" size="sm" className="mb-2">
              Backup Codes
            </Heading>
            <Text size="sm" tone="muted">
              Use these one-time codes to sign in if your authenticator app is unavailable.
            </Text>
          </div>

          {status !== null ? (
            <div
              className="flex items-center gap-3 p-3 bg-surface rounded border"
              data-testid="backup-codes-status"
            >
              {status.total === 0 ? (
                <Text size="sm" tone="muted">
                  No backup codes generated yet.
                </Text>
              ) : (
                <div className="flex flex-col">
                  <Text size="sm" className="font-medium">
                    {status.remaining} of {status.total} codes remaining
                  </Text>
                  <Text size="sm" tone="muted">
                    {status.remaining === 0
                      ? 'All codes have been used. Generate new codes immediately.'
                      : status.remaining <= 2
                        ? 'Running low on backup codes. Consider regenerating.'
                        : 'You have backup codes available for account recovery.'}
                  </Text>
                </div>
              )}
            </div>
          ) : null}

          {newCodes !== null ? (
            <div className="space-y-3" data-testid="new-codes-display">
              <Alert tone="warning">
                <Text size="sm" className="font-medium">
                  Save these backup codes now. They will not be shown again.
                </Text>
              </Alert>

              <div className="grid grid-cols-2 gap-1 px-3 py-2 bg-surface rounded border">
                {newCodes.map((code) => (
                  <code key={code} className="text-sm font-mono">
                    {code}
                  </code>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void handleCopyAll();
                  }}
                  data-testid="copy-codes-button"
                >
                  {copiedCodes ? 'Copied' : 'Copy All Codes'}
                </Button>
                <Button
                  type="button"
                  variant="text"
                  onClick={handleDismissCodes}
                  data-testid="dismiss-codes-button"
                >
                  I Saved My Codes
                </Button>
              </div>
            </div>
          ) : null}

          {error !== null ? <Alert tone="danger">{error}</Alert> : null}

          {newCodes === null && !showRegenerateForm ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowRegenerateForm(true);
              }}
              disabled={isRegenerating}
              data-testid="regenerate-button"
            >
              Regenerate Backup Codes
            </Button>
          ) : null}

          {showRegenerateForm && newCodes === null ? (
            <div className="border-t pt-4">
              <Alert tone="warning">
                <Text size="sm">
                  Regenerating backup codes invalidates all existing backup codes.
                </Text>
              </Alert>
              <form
                onSubmit={(event) => {
                  void handleRegenerate(event);
                }}
                className="mt-3 space-y-3"
              >
                <Input.Field
                  label="Enter your TOTP or backup code to confirm"
                  type="text"
                  value={confirmCode}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setConfirmCode(event.target.value);
                  }}
                  placeholder="Enter code"
                  maxLength={16}
                  autoComplete="one-time-code"
                  disabled={isRegenerating}
                  required
                  data-testid="confirm-code-input"
                />

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={isRegenerating || confirmCode.length < 6}
                    data-testid="confirm-regenerate-button"
                  >
                    {isRegenerating ? 'Regenerating...' : 'Regenerate Codes'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowRegenerateForm(false);
                      setConfirmCode('');
                    }}
                    disabled={isRegenerating}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </Card.Body>
    </Card>
  );
};
