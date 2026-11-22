// main/kernel/ui/src/elements/IconButton.tsx
import { Button } from './Button';
import { Icon } from './Icon';

import '../styles/elements.css';

import type { IconName } from '../icons.generated';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type IconButtonProps = ComponentPropsWithRef<'button'> & {
  /** Visual style variant, forwarded to Button */
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  /** Square edge length: small 2rem, medium 2.5rem, large 3rem */
  size?: 'small' | 'medium' | 'large';
  /** Optional owned icon name rendered when children are omitted */
  icon?: IconName;
  /** Required — an icon-only button carries no text for assistive tech */
  'aria-label': string;
};

/**
 * A square, icon-only button. One edge length (`--ui-icon-btn-size`) drives
 * both axes so every icon affordance in the app lines up on the same grid.
 */
function IconButton({
  size = 'medium',
  icon,
  children,
  className = '',
  ref,
  ...rest
}: IconButtonProps): ReactElement {
  const iconSize = size === 'small' ? 'sm' : size === 'large' ? 'lg' : 'md';
  return (
    <Button
      ref={ref}
      size="inline"
      className={`icon-btn icon-btn-${size} ${className}`.trim()}
      {...rest}
    >
      {children ?? (icon !== undefined ? <Icon name={icon} size={iconSize} /> : null)}
    </Button>
  );
}

export { IconButton };
export type { IconButtonProps };
