// main/kernel/ui/src/elements/Alert.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'danger' | 'warning' | 'live' | 'premium' | 'locked';

type AlertProps = Omit<ComponentPropsWithRef<'div'>, 'title'> & {
  tone?: AlertTone;
  icon?: ReactNode;
  title?: ReactNode;
};

export function Alert({
  tone = 'info',
  icon,
  title,
  children,
  className,
  ref,
  ...rest
}: AlertProps): ReactElement {
  return (
    <div ref={ref} className={cn('alert', className)} data-tone={tone} role="status" {...rest}>
      {icon != null ? <span>{icon}</span> : null}
      <div>
        {title != null ? <div className="alert-title">{title}</div> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
