// main/apps/web/src/features/settings/components/SudoModal.tsx
/**
 * Sensitive Action Modal (sudo)
 *
 * A single-surface, two-step modal for sensitive account actions:
 * step 1 confirms the action itself, step 2 swaps the SAME modal's content to
 * identity confirmation (password + optional TOTP) via the sudo endpoint.
 * No stacked modals — cancel on the identity step returns to the action step.
 */

import { Alert, Button, FormField, Input, Modal, Text } from '@bslt/ui';
import { useState, type ReactElement } from 'react';

import { useSudo } from '../hooks/useSudo';

// ============================================================================
// Types
// ============================================================================

type Step = 'action' | 'identity';

export interface SudoModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Action-step title, e.g. "Deactivate Account" */
  title: string;
  /** Action-step copy describing the consequences of the action */
  description: string;
  /** Action-step confirm button label (default: "Continue") */
  confirmLabel?: string;
  /** Called with the sudo token when re-authentication succeeds */
  onSuccess: (sudoToken: string) => void;
  /** Called when the modal is dismissed */
  onDismiss: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const SudoModal = ({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  onSuccess,
  onDismiss,
}: SudoModalProps): ReactElement | null => {
  const [step, setStep] = useState<Step>('action');
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

  // Cancel on the identity step returns to the action step (single surface).
  const handleBackToAction = (): void => {
    clearIdentityStep();
    setStep('action');
  };

  if (!open) return null;

  return (
    <Modal.Root open={open} onClose={handleClose}>
      {step === 'action' ? (
        <>
          <Modal.Header>
            <Modal.Title>{title}</Modal.Title>
            <Modal.Description>{description}</Modal.Description>
            <Modal.Close />
          </Modal.Header>

          <Modal.Footer>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setStep('identity');
              }}
            >
              {confirmLabel}
            </Button>
          </Modal.Footer>
        </>
      ) : (
        <>
          <Modal.Header>
            <Modal.Title>Confirm Your Identity</Modal.Title>
            <Modal.Description>
              Please re-enter your password to continue with this sensitive action.
            </Modal.Description>
            <Modal.Close />
          </Modal.Header>

          <form onSubmit={handleSubmit}>
            <Modal.Body>
              <div className="space-y-4">
                <FormField label="Password" htmlFor="sudo-password">
                  <Input
                    id="sudo-password"
                    name="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                    }}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                </FormField>

                <FormField label="Two-Factor Code (optional)" htmlFor="sudo-totp">
                  <Input
                    id="sudo-totp"
                    type="text"
                    value={totpCode}
                    onChange={(e) => {
                      setTotpCode(e.target.value);
                    }}
                    placeholder="6-digit code"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <Text size="sm" tone="muted" className="mt-1">
                    Required if you have two-factor authentication enabled.
                  </Text>
                </FormField>

                {error !== null && <Alert tone="danger">{error.message}</Alert>}
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button type="button" variant="secondary" onClick={handleBackToAction}>
                Cancel
              </Button>
              <Button type="submit" disabled={password.length === 0 || isLoading}>
                {isLoading ? 'Verifying...' : 'Confirm'}
              </Button>
            </Modal.Footer>
          </form>
        </>
      )}
    </Modal.Root>
  );
};
