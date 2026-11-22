// main/kernel/ui/src/elements/Skeleton.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement } from 'react';

type SkeletonProps = ComponentPropsWithRef<'div'> & {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
};

export function Skeleton({
  width,
  height,
  radius,
  className,
  style,
  ref,
  ...rest
}: SkeletonProps): ReactElement {
  const cssVars = {
    ...(width !== undefined && {
      ['--skeleton-width']: typeof width === 'number' ? `${String(width)}px` : width,
    }),
    ...(height !== undefined && {
      ['--skeleton-height']: typeof height === 'number' ? `${String(height)}px` : height,
    }),
    ...(radius !== undefined && {
      ['--skeleton-radius']: typeof radius === 'number' ? `${String(radius)}px` : radius,
    }),
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={cn('skeleton', className)}
      style={{ ...cssVars, ...style }}
      {...rest}
    />
  );
}
