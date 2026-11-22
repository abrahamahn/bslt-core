// main/kernel/ui/src/components/StatusBadge.tsx
import { Badge } from '../elements/Badge';

import type { ReactElement, ReactNode } from 'react';

export type StatusBadgeTone =
  'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'live' | 'premium' | 'locked';

export interface StatusBadgeProps {
  readonly tone: StatusBadgeTone;
  readonly label?: string | undefined;
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

export const StatusBadge = ({
  tone,
  label,
  children,
  className,
}: StatusBadgeProps): ReactElement => {
  return (
    <Badge tone={tone} {...(className !== undefined ? { className } : {})}>
      {label ?? children}
    </Badge>
  );
};
