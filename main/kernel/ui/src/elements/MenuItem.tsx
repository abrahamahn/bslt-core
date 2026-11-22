// main/kernel/ui/src/elements/MenuItem.tsx
import { cn } from '../utils/cn';

import { Button } from './Button';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ReactElement, Ref } from 'react';

type MenuItemProps = ComponentPropsWithoutRef<'button'> & {
  ref?: Ref<HTMLButtonElement> | Ref<HTMLElement> | undefined;
};

export function MenuItem({
  className,
  type = 'button',
  ref,
  ...rest
}: MenuItemProps): ReactElement {
  return <Button ref={ref} type={type} className={cn('menu-item', className)} {...rest} />;
}
