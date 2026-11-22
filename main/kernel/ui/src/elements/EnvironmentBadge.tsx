// main/kernel/ui/src/elements/EnvironmentBadge.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type Environment = 'development' | 'production' | 'staging' | 'test';

type EnvironmentBadgeProps = Omit<ComponentPropsWithRef<'span'>, 'children'> & {
  environment: Environment;
  short?: boolean;
};

const envLabels: Record<Environment, { short: string; full: string }> = {
  development: { short: 'DEV', full: 'Development' },
  production: { short: 'PROD', full: 'Production' },
  staging: { short: 'STG', full: 'Staging' },
  test: { short: 'TEST', full: 'Test' },
};

export function EnvironmentBadge({
  environment,
  short = true,
  className,
  ref,
  ...rest
}: EnvironmentBadgeProps): ReactElement {
  const label = short ? envLabels[environment].short : envLabels[environment].full;

  return (
    <span
      ref={ref}
      className={cn('environment-badge', className)}
      data-environment={environment}
      {...rest}
    >
      {label}
    </span>
  );
}
