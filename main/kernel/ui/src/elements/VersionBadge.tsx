// main/kernel/ui/src/elements/VersionBadge.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type VersionBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  version: string;
  prefix?: string;
};

export function VersionBadge({
  version,
  prefix = 'v',
  className,
  ref,
  ...rest
}: VersionBadgeProps): ReactElement {
  return (
    <span ref={ref} className={cn('version-badge', className)} {...rest}>
      {prefix}
      {version}
    </span>
  );
}
