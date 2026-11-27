// main/kernel/react/src/utils/createFormHandler.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createFormHandler } from './createFormHandler';

describe('createFormHandler', () => {
  it('manages loading, error clearing, lifecycle callbacks, and return value on success', async () => {
    const events: string[] = [];
    const setIsLoading = vi.fn((loading: boolean) => {
      events.push(`loading:${String(loading)}`);
    });
    const setError = vi.fn((error: string | null) => {
      events.push(`error:${String(error)}`);
    });

    const wrapHandler = createFormHandler(setIsLoading, setError, {
      onStart: () => {
        events.push('start');
      },
      onSuccess: () => {
        events.push('success');
      },
      onFinally: () => {
        events.push('finally');
      },
    });

    const wrapped = wrapHandler(async (input: { email: string }) => {
      events.push(`run:${input.email}`);
      return await Promise.resolve({ ok: true });
    });

    const result = await wrapped({ email: 'abe@example.com' });

    expect(result).toEqual({ ok: true });
    expect(events).toEqual([
      'loading:true',
      'error:null',
      'start',
      'run:abe@example.com',
      'success',
      'loading:false',
      'finally',
    ]);
  });

  it('captures Error rejections, invokes onError, resets loading, and rethrows', async () => {
    const setIsLoading = vi.fn();
    const setError = vi.fn();
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const onFinally = vi.fn();

    const wrapHandler = createFormHandler(setIsLoading, setError);
    const boom = new Error('Invalid credentials');
    const wrapped = wrapHandler(
      async () => {
        await Promise.resolve();
        throw boom;
      },
      { onError, onSuccess, onFinally },
    );

    await expect(wrapped(undefined)).rejects.toThrow('Invalid credentials');

    expect(setIsLoading).toHaveBeenNthCalledWith(1, true);
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
    expect(setError).toHaveBeenNthCalledWith(1, null);
    expect(setError).toHaveBeenNthCalledWith(2, 'Invalid credentials');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(boom);
    expect(onFinally).toHaveBeenCalledTimes(1);
  });

  it('normalizes non-Error thrown values to a fallback Error message and still resets loading', async () => {
    const setIsLoading = vi.fn();
    const setError = vi.fn();
    const onError = vi.fn();

    const wrapHandler = createFormHandler(setIsLoading, setError);
    const wrapped = wrapHandler(
      async () => {
        await Promise.resolve();
        throw 'string failure';
      },
      { onError },
    );

    await expect(wrapped(undefined)).rejects.toBe('string failure');

    expect(setError).toHaveBeenLastCalledWith('An error occurred');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('An error occurred');
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('allows per-handler options to override default options without clobbering others', async () => {
    const defaultStart = vi.fn();
    const defaultSuccess = vi.fn();
    const overrideSuccess = vi.fn();
    const wrapHandler = createFormHandler(vi.fn(), vi.fn(), {
      onStart: defaultStart,
      onSuccess: defaultSuccess,
    });

    const wrapped = wrapHandler(async () => await Promise.resolve(123), {
      onSuccess: overrideSuccess,
    });

    expect(await wrapped(undefined)).toBe(123);
    expect(defaultStart).toHaveBeenCalledTimes(1);
    expect(defaultSuccess).not.toHaveBeenCalled();
    expect(overrideSuccess).toHaveBeenCalledTimes(1);
  });
});
