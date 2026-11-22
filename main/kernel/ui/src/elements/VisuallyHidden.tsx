// main/kernel/ui/src/elements/VisuallyHidden.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type VisuallyHiddenProps = ComponentPropsWithRef<'span'>;

export function VisuallyHidden({ className, ref, ...rest }: VisuallyHiddenProps): ReactElement {
  return <span ref={ref} className={cn('visually-hidden', className)} {...rest} />;
}
