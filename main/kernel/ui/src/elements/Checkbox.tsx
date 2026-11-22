// main/kernel/ui/src/elements/Checkbox.tsx
import { useControllableState } from '@bslt/react/hooks';

import { cn } from '../utils/cn';

import '../styles/elements.css';
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'onChange'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
};

export function Checkbox({
  checked,
  defaultChecked,
  onChange,
  label,
  className,
  ref,
  ...rest
}: CheckboxProps): ReactElement {
  const [currentChecked, setChecked] = useControllableState<boolean>({
    ...(checked !== undefined && { value: checked }),
    defaultValue: defaultChecked ?? false,
    ...(onChange !== undefined && { onChange }),
  });

  const isChecked = currentChecked ?? false;

  return (
    <label className={cn('checkbox', className)}>
      <span className="checkbox-box" data-checked={isChecked}>
        {isChecked ? '✓' : ''}
      </span>
      <input
        ref={ref}
        type="checkbox"
        checked={isChecked}
        onChange={(event) => {
          setChecked(event.target.checked);
        }}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            setChecked(!isChecked);
          }
        }}
        className="checkbox-input"
        {...rest}
      />
      {label != null ? <span className="checkbox-label">{label}</span> : null}
    </label>
  );
}
