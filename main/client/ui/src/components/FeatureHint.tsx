// main/client/ui/src/components/FeatureHint.tsx
import { useKeyboardShortcut, useLocalStorage } from '@bslt/react/hooks';
import { Button } from '@elements/Button';
import { Text } from '@elements/Text';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface FeatureHintProps {
  featureKey: string;
  title: string;
  description: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

// Module-level queue so pages with several hints show exactly one callout at a
// time, in mount order; the next appears once the current one is dismissed.
const hintQueue: string[] = [];
const hintListeners = new Set<() => void>();

const notifyHintListeners = (): void => {
  hintListeners.forEach((listener) => {
    listener();
  });
};

const subscribeToHintQueue = (listener: () => void): (() => void) => {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
};

const enqueueHint = (featureKey: string): void => {
  if (hintQueue.includes(featureKey)) return;
  hintQueue.push(featureKey);
  notifyHintListeners();
};

const dequeueHint = (featureKey: string): void => {
  const index = hintQueue.indexOf(featureKey);
  if (index === -1) return;
  hintQueue.splice(index, 1);
  notifyHintListeners();
};

const getActiveHint = (): string | undefined => hintQueue[0];
const getServerActiveHint = (): string | undefined => undefined;

export const FeatureHint = ({
  featureKey,
  title,
  description,
  placement = 'bottom',
  children,
}: FeatureHintProps): ReactElement => {
  const [dismissed, setDismissed] = useLocalStorage(`abe:hint:${featureKey}`, false);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const calloutRef = useRef<HTMLSpanElement | null>(null);

  const activeHint = useSyncExternalStore(subscribeToHintQueue, getActiveHint, getServerActiveHint);
  const visible = !dismissed && activeHint === featureKey;

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, [setDismissed]);

  useEffect(() => {
    if (dismissed) return;
    enqueueHint(featureKey);
    return (): void => {
      dequeueHint(featureKey);
    };
  }, [dismissed, featureKey]);

  const updatePosition = useCallback((): void => {
    const anchor = anchorRef.current;
    const callout = calloutRef.current;
    if (anchor == null || callout == null) return;

    const gap = 8;
    const viewportPadding = 8;
    const anchorRect = anchor.getBoundingClientRect();
    const calloutRect = callout.getBoundingClientRect();

    let top = anchorRect.bottom + gap;
    let left = anchorRect.left;

    if (placement === 'top') {
      top = anchorRect.top - calloutRect.height - gap;
    } else if (placement === 'left') {
      top = anchorRect.top;
      left = anchorRect.left - calloutRect.width - gap;
    } else if (placement === 'right') {
      top = anchorRect.top;
      left = anchorRect.right + gap;
    }

    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - calloutRect.width - viewportPadding,
    );
    const maxTop = Math.max(
      viewportPadding,
      window.innerHeight - calloutRect.height - viewportPadding,
    );
    const clampedLeft = Math.min(Math.max(viewportPadding, left), maxLeft);
    let clampedTop = Math.min(Math.max(viewportPadding, top), maxTop);

    // Keep the callout off the page heading so it never obscures the H1.
    const heading = document.querySelector('main h1') ?? document.querySelector('h1');
    if (heading !== null) {
      const headingRect = heading.getBoundingClientRect();
      const overlapsHeading =
        clampedLeft < headingRect.right &&
        clampedLeft + calloutRect.width > headingRect.left &&
        clampedTop < headingRect.bottom &&
        clampedTop + calloutRect.height > headingRect.top;
      if (overlapsHeading) {
        clampedTop = Math.min(headingRect.bottom + gap, maxTop);
      }
    }

    setPosition({ top: clampedTop, left: clampedLeft, ready: true });
  }, [placement]);

  useKeyboardShortcut({
    key: 'Escape',
    enabled: visible,
    handler: () => {
      dismiss();
    },
    target: typeof document !== 'undefined' ? document : null,
  });

  useEffect(() => {
    if (!visible) return;

    const handleReposition = (): void => {
      updatePosition();
    };

    handleReposition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return (): void => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [visible, updatePosition]);

  if (dismissed) return <>{children}</>;

  const callout = visible ? (
    <span
      ref={calloutRef}
      className="feature-hint-callout"
      role="status"
      aria-live="polite"
      style={{
        top: `${String(position.top)}px`,
        left: `${String(position.left)}px`,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
    >
      <Text size="sm" className="font-semibold mb-1">
        {title}
      </Text>
      <Text size="xs" tone="muted" className="mb-2">
        {description}
      </Text>
      <Button type="button" size="small" variant="secondary" onClick={dismiss}>
        Got it
      </Button>
    </span>
  ) : null;

  return (
    <span ref={anchorRef} className="feature-hint" data-placement={placement}>
      {children}
      {callout !== null && typeof document !== 'undefined'
        ? createPortal(callout, document.body)
        : null}
    </span>
  );
};
