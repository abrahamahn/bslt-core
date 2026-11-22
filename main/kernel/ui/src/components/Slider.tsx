// main/kernel/ui/src/components/Slider.tsx
import { useControllableState } from '@bslt/react/hooks';

import { cn } from '../utils/cn';

import '../styles/components.css';
import type { ComponentPropsWithRef, ReactElement } from 'react';

type SliderProps = Omit<ComponentPropsWithRef<'input'>, 'onChange' | 'value' | 'defaultValue'> & {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
};

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  onChange,
  className,
  disabled,
  ref,
  ...rest
}: SliderProps): ReactElement {
  const [currentValue, setValue] = useControllableState<number>({
    ...(value !== undefined && { value }),
    defaultValue: defaultValue ?? min,
    ...(onChange !== undefined && { onChange }),
  });

  const sliderValue = currentValue ?? min;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (disabled === true) return;

    const isUp = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const isDown = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    if (!isUp && !isDown) return;

    const nextValue = isUp ? Math.min(max, sliderValue + step) : Math.max(min, sliderValue - step);

    if (nextValue !== sliderValue) {
      event.preventDefault();
      setValue(nextValue);
    }
  };

  return (
    <input
      ref={ref}
      type="range"
      className={cn('slider', className)}
      min={min}
      max={max}
      step={step}
      value={sliderValue}
      disabled={disabled}
      onKeyDown={handleKeyDown}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        setValue(Number(event.target.value));
      }}
      {...rest}
    />
  );
}
