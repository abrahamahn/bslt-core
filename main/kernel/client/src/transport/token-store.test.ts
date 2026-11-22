// main/kernel/client/src/transport/token-store.test.ts
import { ACCESS_TOKEN_COOKIE_NAME } from '@bslt/contract';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { addAuthHeader, createTokenStore, tokenStore } from './token-store';

describe('token-store', () => {
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  test('addAuthHeader attaches Bearer header only for non-empty tokens and throws on header injection newlines', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    expect(addAuthHeader(headers, null).get('Authorization')).toBeNull();
    expect(addAuthHeader(headers, undefined).get('Authorization')).toBeNull();
    expect(addAuthHeader(headers, '').get('Authorization')).toBeNull();
    expect(addAuthHeader(headers, 'my-token').get('Authorization')).toBe('Bearer my-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(() => addAuthHeader(headers, 'tok\nen')).toThrow();
  });

  test('memory tokenStore stays isolated from localStorage (XSS exfiltration immunity)', () => {
    const localStorageMock = {
      store: { [ACCESS_TOKEN_COOKIE_NAME]: 'stale-persisted' } as Record<string, string>,
      getItem: vi.fn((key: string): string | null => localStorageMock.store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock.store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        Reflect.deleteProperty(localStorageMock.store, key);
      }),
    };
    vi.stubGlobal('localStorage', localStorageMock);

    expect(tokenStore.get()).toBeNull();
    tokenStore.set('secret-jwt');
    expect(tokenStore.get()).toBe('secret-jwt');
    expect(localStorageMock.setItem).not.toHaveBeenCalled();

    const s1 = createTokenStore.memory();
    const s2 = createTokenStore.memory();
    s1.set('alpha');
    s2.set('beta');
    expect(s1.get()).toBe('alpha');
    expect(s2.get()).toBe('beta');
  });

  test('localStorage tokenStore reads, writes, clears, and rejects empty-string tokens', () => {
    const localStorageMock = {
      store: {} as Record<string, string>,
      getItem: vi.fn((key: string): string | null => localStorageMock.store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock.store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        Reflect.deleteProperty(localStorageMock.store, key);
      }),
    };
    vi.stubGlobal('localStorage', localStorageMock);

    const store = createTokenStore.localStorage();
    expect(store.get()).toBeNull();
    localStorageMock.store[ACCESS_TOKEN_COOKIE_NAME] = '';
    expect(store.get()).toBeNull();
    store.set('persisted-token');
    expect(store.get()).toBe('persisted-token');
    store.clear();
    expect(store.get()).toBeNull();
  });
});
