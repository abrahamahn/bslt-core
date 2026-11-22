// main/kernel/ui/src/elements/Divider.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type DividerProps = ComponentPropsWithRef<'hr'>;

export function Divider({ className, ref, ...rest }: DividerProps): ReactElement {
  return <hr ref={ref} className={cn('divider', className)} {...rest} />;
}
