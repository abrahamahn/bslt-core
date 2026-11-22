// main/kernel/ui/src/elements/Switch.tsx
import { useControllableState } from '@bslt/react/hooks';

import { cn } from '../utils/cn';

import { Button } from './Button';

import '../styles/elements.css';
import type { ComponentPropsWithoutRef, ReactElement, Ref } from 'react';

type SwitchProps = Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'defaultChecked'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  ref?: Ref<HTMLButtonElement> | Ref<HTMLElement> | undefined;
};

export function Switch({
  checked,
  defaultChecked,
  onChange,
  className,
  type = 'button',
  ref,
  ...rest
}: SwitchProps): ReactElement {
  const [currentChecked, setChecked] = useControllableState<boolean>({
    ...(checked !== undefined && { value: checked }),
    defaultValue: defaultChecked ?? false,
    ...(onChange !== undefined && { onChange }),
  });

  const isChecked = currentChecked ?? false;

  return (
    <Button
      ref={ref}
      type={type}
      role="switch"
      aria-checked={isChecked}
      className={cn('switch', className)}
      data-checked={isChecked}
      onClick={() => {
        setChecked(!isChecked);
      }}
      {...rest}
    >
      <span className="switch-thumb" />
    </Button>
  );
}
