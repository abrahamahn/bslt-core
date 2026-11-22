// main/kernel/ui/src/elements/CloseButton.tsx
import { Button } from './Button';
import { Icon } from './Icon';

import '../styles/elements.css';

import type { ComponentPropsWithRef, ReactElement } from 'react';

type CloseButtonProps = ComponentPropsWithRef<'button'> & {
  /** Additional CSS class names */
  className?: string;
};

function CloseButton({
  children,
  className = '',
  'aria-label': ariaLabel = 'Close',
  ref,
  ...rest
}: CloseButtonProps): ReactElement {
  return (
    <Button ref={ref} aria-label={ariaLabel} className={`close-btn ${className}`.trim()} {...rest}>
      {children ?? <Icon name="close" size="sm" />}
    </Button>
  );
}

export { CloseButton };
