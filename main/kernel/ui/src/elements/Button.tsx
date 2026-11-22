// main/kernel/ui/src/elements/Button.tsx
import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ElementType, ReactElement, Ref } from 'react';

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  as?: ElementType;
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  size?: 'small' | 'medium' | 'large' | 'inline';
  ref?: Ref<HTMLButtonElement> | Ref<HTMLAnchorElement> | Ref<HTMLElement> | undefined;
};

export function Button({
  as = 'button',
  variant = 'primary',
  size = 'medium',
  className,
  type = 'button',
  ref,
  ...rest
}: ButtonProps): ReactElement {
  const Component: ElementType = as;
  const buttonClass = cn('btn', `btn-${variant}`, `btn-${size}`, className);

  return <Component ref={ref} type={type} className={buttonClass} {...rest} />;
}
