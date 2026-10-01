// main/client/react/src/forms/useSchemaForm.ts
/**
 * Schema-driven form hook.
 *
 * Unifies the pattern repeated across the app's forms: field values, touched
 * state, per-field validation against shared schemas, submission, and
 * reconciliation of server-side field errors.
 *
 * Validation uses the project's `Schema<T>` (`safeParse`) per field — each
 * field's schema error message becomes that field's error. On submit, server
 * `ValidationError` details (`details.fields`, a `Record<string, string[]>`)
 * are mapped back onto the matching fields; any non-field error becomes the
 * form-level `formError`.
 *
 * @module forms/useSchemaForm
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { Schema } from '@bslt/shared/schema';

/** A plain record of form field values. */
export type FormValues = Record<string, unknown>;

/** One schema per field; each validates that field's value independently. */
export type FieldSchemas<T extends FormValues> = {
  [K in keyof T]: Schema<T[K]>;
};

export interface UseSchemaFormOptions<T extends FormValues> {
  /** A validation schema for each field. */
  fieldSchemas: FieldSchemas<T>;
  /** Initial field values. */
  initialValues: T;
  /** Submit callback; throws to signal failure (server errors are reconciled). */
  onSubmit: (values: T) => Promise<void> | void;
  /** Validate a field when it loses focus (default: true). */
  validateOnBlur?: boolean;
  /** Validate a field on every change (default: false). */
  validateOnChange?: boolean;
}

export interface FieldProps<V> {
  name: string;
  value: V;
  onChange: (eventOrValue: { target: { value: V } } | V) => void;
  onBlur: () => void;
  'aria-invalid': boolean;
  error: string | undefined;
}

export interface SchemaForm<T extends FormValues> {
  /** Current field values. */
  values: T;
  /** First validation error per field (only for validated/reconciled fields). */
  errors: Partial<Record<keyof T, string>>;
  /** Which fields have been blurred or submitted. */
  touched: Partial<Record<keyof T, boolean>>;
  /** Form-level error not tied to a specific field (e.g. a 500 or auth failure). */
  formError: string | null;
  /** True while `onSubmit` is in flight. */
  isSubmitting: boolean;
  /** True when no field currently holds an error. */
  isValid: boolean;
  /** Set a single field value (clears any server error for that field). */
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Merge a partial set of field values. */
  setValues: (partial: Partial<T>) => void;
  /** Validate one field now; returns whether it is valid. */
  validateField: (field: keyof T) => boolean;
  /** Validate every field now; returns whether the whole form is valid. */
  validateAll: () => boolean;
  /** Mark a field touched and (optionally) validate it. */
  handleBlur: (field: keyof T) => void;
  /** Validate all fields, then call `onSubmit`, reconciling server errors. */
  handleSubmit: (event?: { preventDefault?: () => void }) => Promise<void>;
  /** Reset to initial values and clear all errors/touched state. */
  reset: () => void;
  /** Apply server field errors (`Record<field, string[]>`) onto the form. */
  setServerErrors: (fields: Record<string, string[]>) => void;
  /** Convenience props for a controlled input bound to `field`. */
  getFieldProps: <K extends keyof T>(field: K) => FieldProps<T[K]>;
}

/** Pull `Record<field, string[]>` out of a thrown server error, if present. */
function extractServerFields(error: unknown): Record<string, string[]> | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  // ValidationError instances expose `.fields`; wire/ApiError shape nests it
  // under `details.fields`.
  const direct = (error as { fields?: unknown }).fields;
  const nested = (error as { details?: { fields?: unknown } }).details?.fields;
  const candidate = isStringArrayRecord(direct) ? direct : nested;
  return isStringArrayRecord(candidate) ? candidate : null;
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value).every(
    (v) => Array.isArray(v) && v.every((item) => typeof item === 'string'),
  );
}

/** Copy an error map without one field (avoids `delete` on computed keys). */
function omitError<K extends PropertyKey>(
  errors: Partial<Record<K, string>>,
  field: K,
): Partial<Record<K, string>> {
  const next: Partial<Record<K, string>> = {};
  for (const key of Object.keys(errors) as K[]) {
    if (key !== field) {
      next[key] = errors[key];
    }
  }
  return next;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  // API/wire errors may arrive as plain objects with a public message.
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  }
  return 'Something went wrong. Please try again.';
}

export function useSchemaForm<T extends FormValues>(
  options: UseSchemaFormOptions<T>,
): SchemaForm<T> {
  const { fieldSchemas, initialValues, onSubmit } = options;
  const validateOnBlur = options.validateOnBlur ?? true;
  const validateOnChange = options.validateOnChange ?? false;

  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mirror values so submit-time validation never reads a stale closure.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const validateValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]): string | undefined => {
      const result = fieldSchemas[field].safeParse(value);
      return result.success ? undefined : result.error.message;
    },
    [fieldSchemas],
  );

  const validateField = useCallback(
    (field: keyof T): boolean => {
      const message = validateValue(field, valuesRef.current[field]);
      setErrors((prev) =>
        message === undefined ? omitError(prev, field) : { ...prev, [field]: message },
      );
      return message === undefined;
    },
    [validateValue],
  );

  const validateAll = useCallback((): boolean => {
    const nextErrors: Partial<Record<keyof T, string>> = {};
    let valid = true;
    for (const field of Object.keys(fieldSchemas) as Array<keyof T>) {
      const message = validateValue(field, valuesRef.current[field]);
      if (message !== undefined) {
        nextErrors[field] = message;
        valid = false;
      }
    }
    setErrors(nextErrors);
    return valid;
  }, [fieldSchemas, validateValue]);

  const setValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]): void => {
      setValuesState((prev) => ({ ...prev, [field]: value }));
      if (validateOnChange) {
        // Validate against the new value directly (state update is async).
        const message = validateValue(field, value);
        setErrors((prev) =>
          message === undefined ? omitError<keyof T>(prev, field) : { ...prev, [field]: message },
        );
      } else {
        // A fresh edit invalidates a stale server error on that field.
        setErrors((prev) => (field in prev ? omitError<keyof T>(prev, field) : prev));
      }
    },
    [validateOnChange, validateValue],
  );

  const setValues = useCallback((partial: Partial<T>): void => {
    setValuesState((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleBlur = useCallback(
    (field: keyof T): void => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      if (validateOnBlur) {
        validateField(field);
      }
    },
    [validateOnBlur, validateField],
  );

  const setServerErrors = useCallback((fields: Record<string, string[]>): void => {
    const mapped: Partial<Record<keyof T, string>> = {};
    for (const [field, messages] of Object.entries(fields)) {
      const first = messages[0];
      if (first !== undefined) {
        mapped[field as keyof T] = first;
      }
    }
    setErrors((prev) => ({ ...prev, ...mapped }));
    setTouched((prev) => {
      const next = { ...prev };
      for (const field of Object.keys(fields)) {
        next[field as keyof T] = true;
      }
      return next;
    });
  }, []);

  const reset = useCallback((): void => {
    setValuesState(initialValues);
    setErrors({});
    setTouched({});
    setFormError(null);
    setIsSubmitting(false);
  }, [initialValues]);

  const handleSubmit = useCallback(
    async (event?: { preventDefault?: () => void }): Promise<void> => {
      event?.preventDefault?.();
      setFormError(null);
      // Mark every field touched so errors surface on a submit attempt.
      setTouched((prev) => {
        const next = { ...prev };
        for (const field of Object.keys(fieldSchemas)) {
          next[field as keyof T] = true;
        }
        return next;
      });

      if (!validateAll()) {
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit(valuesRef.current);
      } catch (error) {
        const serverFields = extractServerFields(error);
        if (serverFields !== null && Object.keys(serverFields).length > 0) {
          // Only fields the form actually owns become field errors; leave the
          // rest as a form-level message if there were none we recognized.
          const owned: Record<string, string[]> = {};
          let recognized = false;
          for (const [field, messages] of Object.entries(serverFields)) {
            if (field in fieldSchemas) {
              owned[field] = messages;
              recognized = true;
            }
          }
          if (recognized) {
            setServerErrors(owned);
          } else {
            setFormError(errorMessage(error));
          }
        } else {
          setFormError(errorMessage(error));
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [fieldSchemas, onSubmit, setServerErrors, validateAll],
  );

  const getFieldProps = useCallback(
    <K extends keyof T>(field: K): FieldProps<T[K]> => ({
      name: String(field),
      value: values[field],
      onChange: (eventOrValue) => {
        const value =
          typeof eventOrValue === 'object' && eventOrValue !== null && 'target' in eventOrValue
            ? eventOrValue.target.value
            : eventOrValue;
        setValue(field, value);
      },
      onBlur: () => {
        handleBlur(field);
      },
      'aria-invalid': errors[field] !== undefined && touched[field] === true,
      error: touched[field] === true ? errors[field] : undefined,
    }),
    [values, errors, touched, setValue, handleBlur],
  );

  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors]);

  return {
    values,
    errors,
    touched,
    formError,
    isSubmitting,
    isValid,
    setValue,
    setValues,
    validateField,
    validateAll,
    handleBlur,
    handleSubmit,
    reset,
    setServerErrors,
    getFieldProps,
  };
}
