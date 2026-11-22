// main/kernel/ui/src/components/Radio.tsx
import { useControllableState } from '@bslt/react/hooks';

import { cn } from '../utils/cn';

import { useRadioGroupContext } from './RadioGroup';

import '../styles/components.css';
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

type RadioProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'onChange' | 'name'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
  name?: string;
  value?: string | number | readonly string[];
};

export function Radio({
  checked: checkedProp,
  defaultChecked,
  onChange,
  label,
  className,
  name: nameProp,
  value,
  ref,
  ...rest
}: RadioProps): ReactElement {
  const groupContext = useRadioGroupContext();

  const [internalChecked, setInternalChecked] = useControllableState<boolean>({
    ...(checkedProp !== undefined && { value: checkedProp }),
    defaultValue: defaultChecked ?? false,
    ...(onChange !== undefined && { onChange }),
  });

  const isGrouped = groupContext != null;
  let isChecked = internalChecked ?? false;
  let name = nameProp;

  if (isGrouped) {
    if (value !== undefined) {
      isChecked = groupContext.value === String(value);
    }
    name = nameProp != null && nameProp !== '' ? nameProp : groupContext.name;
  }

  const handleChange = (): void => {
    if (isGrouped) {
      if (value !== undefined) {
        groupContext.onValueChange(String(value));
      }
      onChange?.(true);
    } else {
      setInternalChecked(true);
    }
  };

  return (
    <label className={cn('radio', className)}>
      <span className="radio-circle" data-checked={isChecked} aria-hidden="true">
        {isChecked ? <span className="radio-dot" /> : null}
      </span>
      <input
        ref={ref}
        type="radio"
        name={name}
        value={value}
        checked={isChecked}
        onChange={handleChange}
        className="radio-input"
        {...rest}
      />
      {label != null ? <span>{label}</span> : null}
    </label>
  );
}
