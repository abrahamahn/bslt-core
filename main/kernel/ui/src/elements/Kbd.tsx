// main/kernel/ui/src/elements/Kbd.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type KbdProps = ComponentPropsWithRef<'kbd'> & {
  size?: 'sm' | 'md';
};

export function Kbd({ size = 'md', className, children, ref, ...rest }: KbdProps): ReactElement {
  return (
    <kbd ref={ref} className={cn('kbd', className)} data-size={size} {...rest}>
      {children}
    </kbd>
  );
}
