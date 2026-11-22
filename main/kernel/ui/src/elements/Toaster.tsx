// main/kernel/ui/src/elements/Toaster.tsx
import { useCallback, useEffect, type ReactElement } from 'react';

import { Button } from './Button';
import { Icon } from './Icon';

import '../styles/components.css';
import '../styles/elements.css';

import type { ToastMessage } from '@bslt/react';

type ToasterPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

type ToasterProps = {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
  position?: ToasterPosition;
  duration?: number;
};

type ToastCardProps = {
  message: ToastMessage;
  duration: number;
  onDismiss: (id: string) => void;
};

function ToastCard({ message, duration, onDismiss }: ToastCardProps): ReactElement {
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      onDismiss(message.id);
    }, duration);
    return (): void => {
      globalThis.clearTimeout(timer);
    };
  }, [duration, message.id, onDismiss]);

  const handleDismiss = useCallback((): void => {
    onDismiss(message.id);
  }, [onDismiss, message.id]);

  const tone = message.tone ?? 'info';

  return (
    <div className="toast-card" data-tone={tone} role="status">
      <div className="toast-content">
        {message.title != null && message.title !== '' ? (
          <div className="toast-title">{message.title}</div>
        ) : null}
        {message.description != null && message.description !== '' ? (
          <div className="toast-description">{message.description}</div>
        ) : null}
      </div>
      {message.action != null ? (
        <Button className="toast-action" onClick={message.action.onClick}>
          {message.action.label}
        </Button>
      ) : null}
      <Button className="toast-dismiss" aria-label="Dismiss notification" onClick={handleDismiss}>
        <Icon name="close" size="sm" />
      </Button>
    </div>
  );
}

export function Toaster({
  messages,
  onDismiss,
  position = 'top-right',
  duration = 3500,
}: ToasterProps): ReactElement {
  return (
    <div className="toaster" data-position={position}>
      <div className="toast" aria-live="polite" aria-relevant="additions">
        {messages.map((msg) => (
          <ToastCard key={msg.id} message={msg} duration={duration} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}
