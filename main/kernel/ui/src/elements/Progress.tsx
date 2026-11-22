// main/kernel/ui/src/elements/Progress.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { CSSProperties, ComponentPropsWithRef, ReactElement } from 'react';

type ProgressProps = ComponentPropsWithRef<'div'> & {
  value: number;
};

export function Progress({
  value,
  className,
  style,
  'aria-label': ariaLabel = 'Progress',
  ref,
  ...rest
}: ProgressProps): ReactElement {
  const safeValue = Number.isNaN(value) ? 0 : value;
  const clamped = Math.min(100, Math.max(0, safeValue));

  return (
    <div
      ref={ref}
      className={cn('progress', className)}
      style={style}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      {...rest}
    >
      <div
        className="progress-bar"
        style={{ ['--progress-value']: `${String(clamped)}%` } as CSSProperties}
      />
    </div>
  );
}
