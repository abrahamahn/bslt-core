// main/kernel/ui/src/elements/Heading.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ElementType, ReactElement, Ref } from 'react';

type HeadingSize = 'display' | '3xl' | '2xl' | 'xl' | 'lg' | 'md' | 'sm';

type HeadingProps = ComponentPropsWithoutRef<'h2'> & {
  as?: ElementType;
  size?: HeadingSize;
  ref?: Ref<HTMLHeadingElement> | Ref<HTMLElement> | undefined;
};

export function Heading({
  as = 'h2',
  size = 'lg',
  className,
  ref,
  ...rest
}: HeadingProps): ReactElement {
  const Component: ElementType = as;
  return <Component ref={ref} className={cn('heading', className)} data-size={size} {...rest} />;
}
