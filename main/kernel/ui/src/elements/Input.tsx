// main/kernel/ui/src/elements/Input.tsx
import {
  useId,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type Ref,
} from 'react';

import { cn } from '../utils/cn';

import { Text } from './Text';

import '../styles/elements.css';

type InputRootProps = ComponentPropsWithoutRef<'input'> & {
  as?: ElementType | undefined;
  ref?: Ref<HTMLInputElement> | Ref<HTMLElement> | undefined;
};

type InputFieldProps = ComponentPropsWithoutRef<'input'> & {
  as?: ElementType | undefined;
  label?: string | undefined;
  hideLabel?: boolean | undefined;
  description?: string | undefined;
  error?: string | undefined;
  ref?: Ref<HTMLInputElement> | Ref<HTMLElement> | undefined;
};

function InputRoot({ as = 'input', className, ref, ...rest }: InputRootProps): ReactElement {
  const Component: ElementType = as;
  return <Component ref={ref} className={cn('input', className)} {...rest} />;
}

function InputField({
  as,
  label,
  hideLabel,
  description,
  error,
  className,
  id,
  ref,
  ...rest
}: InputFieldProps): ReactElement {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const descId = description != null && description !== '' ? `${inputId}-desc` : undefined;
  const errorId = error != null && error !== '' ? `${inputId}-err` : undefined;

  return (
    <div className="input-field">
      {label != null && label !== '' ? (
        <label
          htmlFor={inputId}
          className={cn('input-label', hideLabel === true && 'visually-hidden')}
        >
          {label}
        </label>
      ) : null}
      <InputRoot
        as={as}
        id={inputId}
        ref={ref}
        className={className}
        aria-describedby={error != null && error !== '' ? errorId : descId}
        aria-invalid={error != null && error !== ''}
        {...rest}
      />
      {description != null && description !== '' ? (
        <Text id={descId} tone="muted" className="input-description">
          {description}
        </Text>
      ) : null}
      {error != null && error !== '' ? (
        <Text id={errorId} tone="danger" className="input-error">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

export const Input = Object.assign(InputRoot, {
  Field: InputField,
});
