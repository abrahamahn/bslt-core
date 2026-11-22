// main/kernel/ui/src/elements/TextArea.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type TextAreaProps = ComponentPropsWithRef<'textarea'>;

export function TextArea({ className, ref, ...rest }: TextAreaProps): ReactElement {
  return <textarea ref={ref} className={cn('textarea', className)} {...rest} />;
}
