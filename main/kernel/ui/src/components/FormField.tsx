// main/kernel/ui/src/components/FormField.tsx
import { cn } from '../utils/cn';

import '../styles/components.css';
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

type FormFieldProps = ComponentPropsWithRef<'div'> & {
  label: string;
  htmlFor: string;
  error?: string;
  description?: string;
  required?: boolean;
  children: ReactNode;
};

export function FormField({
  label,
  htmlFor,
  error,
  description,
  required = false,
  children,
  className,
  ref,
  ...rest
}: FormFieldProps): ReactElement {
  return (
    <div ref={ref} className={cn('form-field', className)} {...rest}>
      <label htmlFor={htmlFor} className="form-field-label">
        {label}
        {required ? <span className="form-field-required">*</span> : null}
      </label>
      <div className="form-field-input">{children}</div>
      {error != null && error !== '' ? (
        <span className="form-field-error" role="alert">
          {error}
        </span>
      ) : null}
      {description != null && description !== '' && (error == null || error === '') ? (
        <span className="form-field-helper">{description}</span>
      ) : null}
    </div>
  );
}
