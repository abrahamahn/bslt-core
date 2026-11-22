// main/kernel/ui/src/layouts/layers/Overlay.tsx
import { createPortal } from 'react-dom';

import { cn } from '../../utils/cn';

import '../../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type OverlayProps = ComponentPropsWithRef<'div'> & {
  /** Whether the overlay is visible */
  open: boolean;
  /** Callback invoked when the overlay is clicked (typically to dismiss) */
  onClick?: () => void;
};

export function Overlay({
  open,
  className,
  onClick,
  ref,
  ...rest
}: OverlayProps): ReactElement | null {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      role="presentation"
      className={cn('overlay', className)}
      onClick={onClick}
      {...rest}
    />,
    document.body,
  );
}
