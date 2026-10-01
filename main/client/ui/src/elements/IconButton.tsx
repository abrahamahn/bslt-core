// main/client/ui/src/elements/IconButton.tsx
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { Button } from './Button';

import '../styles/elements.css';

type IconButtonProps = ComponentPropsWithoutRef<'button'> & {
  /** Visual style variant, forwarded to Button */
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  /** Square edge length: small 2rem, medium 2.5rem, large 3rem */
  size?: 'small' | 'medium' | 'large';
  /** Required — an icon-only button carries no text for assistive tech */
  'aria-label': string;
};

/**
 * A square, icon-only button. One edge length (`--ui-icon-btn-size`) drives
 * both axes so every icon affordance in the app lines up on the same grid.
 *
 * @example
 * ```tsx
 * <IconButton variant="text" aria-label="Show chat" onClick={openChat}>
 *   <span aria-hidden="true">💬</span>
 * </IconButton>
 * ```
 */
const IconButton = forwardRef<HTMLElement, IconButtonProps>((props, ref) => {
  const { size = 'medium', className = '', ...rest } = props;
  return (
    <Button
      ref={ref}
      size="inline"
      className={`icon-btn icon-btn-${size} ${className}`.trim()}
      {...rest}
    />
  );
});

IconButton.displayName = 'IconButton';

export { IconButton };
export type { IconButtonProps };
