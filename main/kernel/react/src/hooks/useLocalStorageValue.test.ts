// main/kernel/react/src/hooks/useLocalStorageValue.test.ts
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLocalStorageValue } from './useLocalStorageValue';

function createStorageEvent(init: { key?: string | null; newValue?: string | null }): Event {
  const event = new Event('storage');
  Object.defineProperties(event, {
    key: { value: init.key ?? null },
    newValue: { value: init.newValue ?? null },
  });
  return event;
}

describe('useLocalStorageValue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when key is missing', () => {
    const { result } = renderHook(() => useLocalStorageValue('setting'));
    expect(result.current[0]).toBeNull();
  });

  it('returns existing raw string value', () => {
    localStorage.setItem('setting', 's_1');
    const { result } = renderHook(() => useLocalStorageValue('setting'));
    expect(result.current[0]).toBe('s_1');
  });

  it('updates same-tab subscribers on set', () => {
    const first = renderHook(() => useLocalStorageValue('setting'));
    const second = renderHook(() => useLocalStorageValue('setting'));

    act(() => {
      first.result.current[1]('s_2');
    });

    expect(first.result.current[0]).toBe('s_2');
    expect(second.result.current[0]).toBe('s_2');
    expect(localStorage.getItem('setting')).toBe('s_2');
  });

  it('removes key when set to null', () => {
    localStorage.setItem('setting', 's_3');
    const { result } = renderHook(() => useLocalStorageValue('setting'));

    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem('setting')).toBeNull();
  });

  it('reacts to cross-tab storage events', () => {
    const { result } = renderHook(() => useLocalStorageValue('setting'));

    act(() => {
      localStorage.setItem('setting', 's_4');
      window.dispatchEvent(createStorageEvent({ key: 'setting', newValue: 's_4' }));
    });

    expect(result.current[0]).toBe('s_4');
  });
});
