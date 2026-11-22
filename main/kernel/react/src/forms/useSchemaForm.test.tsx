// main/kernel/react/src/forms/useSchemaForm.test.tsx
/** @vitest-environment jsdom */
/**
 * Adversarial tests for useSchemaForm.
 *
 * Covers per-field validation, submit gating, server field-error
 * reconciliation, form-level errors, and the edit-clears-server-error path.
 */

import { createSchema, type Schema } from '@bslt/schema';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSchemaForm } from './useSchemaForm';

/** A string schema that rejects empty/blank values with a field message. */
function requiredString(label: string): Schema<string> {
  return createSchema<string>((data) => {
    if (typeof data !== 'string' || data.trim() === '') {
      throw new Error(`${label} is required`);
    }
    return data;
  });
}

function emailSchema(): Schema<string> {
  return createSchema<string>((data) => {
    if (typeof data !== 'string' || !data.includes('@')) {
      throw new Error('Enter a valid email');
    }
    return data;
  });
}

type LoginValues = {
  email: string;
  password: string;
};

function setup(
  onSubmit: (v: LoginValues) => Promise<void> | void,
  opts?: { validateOnChange?: boolean },
) {
  return renderHook(() =>
    useSchemaForm<LoginValues>({
      fieldSchemas: { email: emailSchema(), password: requiredString('Password') },
      initialValues: { email: '', password: '' },
      onSubmit,
      ...opts,
    }),
  );
}

describe('useSchemaForm — initial state', () => {
  it('starts with the given values, no errors, not submitting', () => {
    const { result } = setup(vi.fn());
    expect(result.current.values).toEqual({ email: '', password: '' });
    expect(result.current.errors).toEqual({});
    expect(result.current.formError).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.isValid).toBe(true);
  });
});

describe('useSchemaForm — field validation', () => {
  it('validateField flags an invalid field and clears once fixed', () => {
    const { result } = setup(vi.fn());

    act(() => {
      result.current.validateField('email');
    });
    expect(result.current.errors.email).toBe('Enter a valid email');

    act(() => {
      result.current.setValue('email', 'user@example.com');
    });
    act(() => {
      result.current.validateField('email');
    });
    expect(result.current.errors.email).toBeUndefined();
  });

  it('handleBlur marks touched and validates by default', () => {
    const { result } = setup(vi.fn());
    act(() => {
      result.current.handleBlur('password');
    });
    expect(result.current.touched.password).toBe(true);
    expect(result.current.errors.password).toBe('Password is required');
  });

  it('validateOnChange surfaces errors as the user types', () => {
    const { result } = setup(vi.fn(), { validateOnChange: true });
    act(() => {
      result.current.setValue('email', 'not-an-email');
    });
    expect(result.current.errors.email).toBe('Enter a valid email');
  });
});

describe('useSchemaForm — submit gating', () => {
  it('does not call onSubmit when validation fails, and marks all touched', async () => {
    const onSubmit = vi.fn();
    const { result } = setup(onSubmit);

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.errors.email).toBe('Enter a valid email');
    expect(result.current.errors.password).toBe('Password is required');
    expect(result.current.touched.email).toBe(true);
    expect(result.current.touched.password).toBe(true);
  });

  it('calls preventDefault and onSubmit with values when valid', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const { result } = setup(onSubmit);
    const preventDefault = vi.fn();

    act(() => {
      result.current.setValue('email', 'user@example.com');
      result.current.setValue('password', 'secret');
    });
    await act(async () => {
      await result.current.handleSubmit({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      email: 'user@example.com',
      password: 'secret',
    });
    expect(result.current.isSubmitting).toBe(false);
  });
});

describe('useSchemaForm — server error reconciliation', () => {
  it('maps server field errors (details.fields) onto the matching fields', async () => {
    const onSubmit = vi.fn(async () => {
      throw { details: { fields: { email: ['Email already registered'] } } };
    });
    const { result } = setup(onSubmit);

    act(() => {
      result.current.setValue('email', 'taken@example.com');
      result.current.setValue('password', 'secret');
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.errors.email).toBe('Email already registered');
    expect(result.current.formError).toBeNull();
  });

  it('reads field errors off a ValidationError instance (.fields)', async () => {
    const onSubmit = vi.fn(async () => {
      const err = new Error('Validation failed') as Error & {
        fields: Record<string, string[]>;
      };
      err.fields = { password: ['Password is too weak'] };
      throw err;
    });
    const { result } = setup(onSubmit);

    act(() => {
      result.current.setValue('email', 'user@example.com');
      result.current.setValue('password', 'weak');
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.errors.password).toBe('Password is too weak');
  });

  it('falls back to a form-level error for non-field failures', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Internal server error');
    });
    const { result } = setup(onSubmit);

    act(() => {
      result.current.setValue('email', 'user@example.com');
      result.current.setValue('password', 'secret');
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.formError).toBe('Internal server error');
    expect(result.current.errors.email).toBeUndefined();
  });

  it('treats server errors for unknown fields as a form-level error', async () => {
    const onSubmit = vi.fn(async () => {
      throw { message: 'Bad request', details: { fields: { captcha: ['Captcha failed'] } } };
    });
    const { result } = setup(onSubmit);

    act(() => {
      result.current.setValue('email', 'user@example.com');
      result.current.setValue('password', 'secret');
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.formError).toBe('Bad request');
    expect(result.current.errors).toEqual({});
  });

  it('clears a server field error as soon as the user edits that field', async () => {
    const onSubmit = vi.fn(async () => {
      throw { details: { fields: { email: ['Email already registered'] } } };
    });
    const { result } = setup(onSubmit);

    act(() => {
      result.current.setValue('email', 'taken@example.com');
      result.current.setValue('password', 'secret');
    });
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(result.current.errors.email).toBe('Email already registered');

    act(() => {
      result.current.setValue('email', 'fresh@example.com');
    });
    expect(result.current.errors.email).toBeUndefined();
  });
});

describe('useSchemaForm — getFieldProps and reset', () => {
  it('getFieldProps exposes value, aria-invalid, and error only when touched', () => {
    const { result } = setup(vi.fn());

    act(() => {
      result.current.handleBlur('email');
    });
    const props = result.current.getFieldProps('email');
    expect(props.name).toBe('email');
    expect(props['aria-invalid']).toBe(true);
    expect(props.error).toBe('Enter a valid email');
  });

  it('getFieldProps.onChange accepts both raw values and input events', () => {
    const { result } = setup(vi.fn());

    act(() => {
      result.current.getFieldProps('email').onChange({ target: { value: 'evt@example.com' } });
    });
    expect(result.current.values.email).toBe('evt@example.com');

    act(() => {
      result.current.getFieldProps('email').onChange('raw@example.com');
    });
    expect(result.current.values.email).toBe('raw@example.com');
  });

  it('reset restores initial values and clears all state', async () => {
    const { result } = setup(vi.fn());

    act(() => {
      result.current.setValue('email', 'x');
      result.current.handleBlur('email');
    });
    expect(result.current.errors.email).toBeDefined();

    act(() => {
      result.current.reset();
    });
    expect(result.current.values).toEqual({ email: '', password: '' });
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.formError).toBeNull();
  });
});
