// main/modules/compliance/web/TosAcceptanceModal.tsx
import { useCallback, useState, type ReactElement } from 'react';

import { Button, Dialog, Text } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import enUsMessages from '../i18n/en-US.json';

export interface TosAcceptanceModalProps {
  /** Whether the modal is open */
  readonly open: boolean;
  /** Document ID of the ToS to accept */
  readonly documentId: string | null;
  /** Required ToS version number */
  readonly requiredVersion: number | null;
  /** Called when the user accepts the ToS */
  readonly onAccept: (documentId: string) => Promise<void>;
  /** Called when the modal is dismissed */
  readonly onDismiss?: () => void;
}

export function TosAcceptanceModal({
  open,
  documentId,
  requiredVersion,
  onAccept,
  onDismiss,
}: TosAcceptanceModalProps): ReactElement | null {
  const t = useModuleMessages(enUsMessages);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = useCallback(async () => {
    if (documentId === null) return;

    setIsAccepting(true);
    setError(null);

    try {
      await onAccept(documentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('compliance.tosModalAcceptError');
      setError(message);
    } finally {
      setIsAccepting(false);
    }
  }, [documentId, onAccept, t]);

  if (!open || documentId === null) return null;

  return (
    <Dialog.Root open={open} {...(onDismiss !== undefined ? { onClose: onDismiss } : {})}>
      <Dialog.Header>
        <Dialog.Title>{t('compliance.tosModalTitle')}</Dialog.Title>
        <Dialog.Description>
          {requiredVersion !== null
            ? t('compliance.tosModalVersionDescription').replace(
                '{version}',
                String(requiredVersion),
              )
            : t('compliance.tosModalFallbackDescription')}
        </Dialog.Description>
      </Dialog.Header>

      <Dialog.Body>
        <Text size="sm" tone="muted">
          {t('compliance.tosModalBody')}
        </Text>

        {error !== null && (
          <Text size="sm" tone="danger">
            {error}
          </Text>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        <Button
          type="button"
          onClick={() => {
            void handleAccept();
          }}
          disabled={isAccepting}
        >
          {isAccepting ? t('compliance.tosModalAccepting') : t('compliance.tosModalAcceptButton')}
        </Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}
