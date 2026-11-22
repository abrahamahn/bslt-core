// main/kernel/ui/src/elements/OAuthButton.tsx
import { cn } from '../utils/cn';

import { Button } from './Button';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ReactElement, Ref } from 'react';

type OAuthButtonProps = ComponentPropsWithoutRef<'button'> & {
  ref?: Ref<HTMLButtonElement> | Ref<HTMLElement> | undefined;
};

export function OAuthButton({
  className,
  type = 'button',
  ref,
  ...rest
}: OAuthButtonProps): ReactElement {
  return (
    <Button
      ref={ref}
      type={type}
      variant="secondary"
      className={cn('oauth-button', className)}
      {...rest}
    />
  );
}
