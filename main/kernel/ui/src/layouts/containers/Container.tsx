// main/kernel/ui/src/layouts/containers/Container.tsx
import { cn } from '../../utils/cn';

import '../../styles/layouts.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type ContainerProps = ComponentPropsWithRef<'div'> & {
  /** Maximum width preset: 'sm' (narrow), 'md' (default), or 'lg' (wide) */
  size?: 'sm' | 'md' | 'lg';
};

const sizeClasses: Record<NonNullable<ContainerProps['size']>, string> = {
  sm: 'container--sm',
  md: 'container--md',
  lg: 'container--lg',
};

export function Container({ size = 'md', className, ref, ...rest }: ContainerProps): ReactElement {
  const sizeClass = size in sizeClasses ? sizeClasses[size] : undefined;
  return <div ref={ref} className={cn('container', sizeClass, className)} {...rest} />;
}
