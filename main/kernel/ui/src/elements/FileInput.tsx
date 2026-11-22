// main/kernel/ui/src/elements/FileInput.tsx
import { useId, type ComponentPropsWithRef, type ReactElement } from 'react';

import { cn } from '../utils/cn';

import { Text } from './Text';

import '../styles/elements.css';

type FileInputProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & {
  type?: 'file';
};

type FileInputFieldProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & {
  type?: 'file';
  label?: string;
  hideLabel?: boolean;
  description?: string;
  error?: string;
};

function FileInputRoot({ className, type = 'file', ref, ...rest }: FileInputProps): ReactElement {
  return <input ref={ref} type={type} className={cn('input', 'file-input', className)} {...rest} />;
}

function FileInputField({
  label,
  hideLabel,
  description,
  error,
  className,
  id,
  type = 'file',
  ref,
  ...rest
}: FileInputFieldProps): ReactElement {
  const generatedId = useId();
  const inputId = id ?? `file-input-${generatedId}`;
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
      <FileInputRoot
        ref={ref}
        id={inputId}
        type={type}
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

export const FileInput = Object.assign(FileInputRoot, {
  Field: FileInputField,
});
