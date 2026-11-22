// main/kernel/ui/src/elements/Text.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ElementType, ReactElement, Ref } from 'react';

type Tone = 'default' | 'muted' | 'danger' | 'success';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

type TextProps = ComponentPropsWithoutRef<'p'> & {
  as?: ElementType;
  tone?: Tone;
  size?: Size;
  ref?: Ref<HTMLParagraphElement> | Ref<HTMLSpanElement> | Ref<HTMLElement> | undefined;
};

export function Text({
  as,
  tone = 'default',
  size,
  className,
  ref,
  ...rest
}: TextProps): ReactElement {
  const Component: ElementType = as ?? 'p';
  const sizeClass = size != null ? `text-${size}` : null;
  return (
    <Component ref={ref} className={cn('text', sizeClass, className)} data-tone={tone} {...rest} />
  );
}
