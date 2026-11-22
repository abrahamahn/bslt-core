// main/kernel/ui/src/elements/Badge.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ElementType, ReactElement, Ref } from 'react';

type BadgeTone =
  'info' | 'success' | 'danger' | 'warning' | 'neutral' | 'live' | 'premium' | 'locked';

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  as?: ElementType;
  tone?: BadgeTone;
  ref?: Ref<HTMLSpanElement> | Ref<HTMLElement> | undefined;
};

export function Badge({
  as = 'span',
  tone = 'info',
  className,
  ref,
  ...rest
}: BadgeProps): ReactElement {
  const Component: ElementType = as;
  return <Component ref={ref} className={cn('badge', className)} data-tone={tone} {...rest} />;
}
