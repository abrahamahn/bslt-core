// main/kernel/client/src/storage/userScopedStorage.test.ts
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  USER_SCOPED_LOCAL_KEYS,
  clearUserScopedLocalStorage,
  createUserScopedStorage,
  registerUserScopedReset,
  runUserScopedResets,
  userScopedKey,
} from './userScopedStorage';

// The engine test env is `node` (framework-agnostic); the module reads
// `localStorage` lazily, so a minimal in-memory shim installed before the
// tests run is enough.
beforeAll(() => {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  vi.stubGlobal('localStorage', mock);
});

describe('userScopedKey', () => {
  it('namespaces a key by user id', () => {
    expect(userScopedKey('shop.cart', 'u1')).toBe('shop.cart::u:u1');
    expect(userScopedKey('shop.cart', 'u2')).toBe('shop.cart::u:u2');
  });

  it('maps a null/empty id to a shared guest namespace', () => {
    expect(userScopedKey('shop.cart', null)).toBe('shop.cart::u:guest');
    expect(userScopedKey('shop.cart', '')).toBe('shop.cart::u:guest');
  });
});

describe('clearUserScopedLocalStorage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('removes every registered user-scoped key and leaves others', () => {
    localStorage.setItem('bslt.activeOrgId', 'org-1');
    localStorage.setItem('dataExportRequestId', 'export-1');
    localStorage.setItem('theme-mode', 'dark'); // device pref — must survive

    clearUserScopedLocalStorage();

    expect(localStorage.getItem('bslt.activeOrgId')).toBeNull();
    expect(localStorage.getItem('dataExportRequestId')).toBeNull();
    expect(localStorage.getItem('theme-mode')).toBe('dark');
  });

  it('accepts a custom key list (a fork extends the registry)', () => {
    localStorage.setItem('shop.balance', '500');
    clearUserScopedLocalStorage([...USER_SCOPED_LOCAL_KEYS, 'shop.balance']);
    expect(localStorage.getItem('shop.balance')).toBeNull();
  });
});

describe('createUserScopedStorage — per-user isolation + preservation', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('isolates values between users and preserves each on return', () => {
    const a = createUserScopedStorage('user-a');
    const b = createUserScopedStorage('user-b');

    a.set('cart', 'apples');
    b.set('cart', 'oranges');

    // No leak across the switch.
    expect(a.get('cart')).toBe('apples');
    expect(b.get('cart')).toBe('oranges');

    // Both persist under distinct physical keys.
    expect(localStorage.getItem('cart::u:user-a')).toBe('apples');
    expect(localStorage.getItem('cart::u:user-b')).toBe('oranges');

    // A user's clearing does not touch the other's.
    a.remove('cart');
    expect(a.get('cart')).toBeNull();
    expect(b.get('cart')).toBe('oranges');
  });
});

describe('reset registry', () => {
  it('runs every registered reset and survives one throwing', () => {
    const ran: string[] = [];
    const un1 = registerUserScopedReset(() => ran.push('one'));
    const un2 = registerUserScopedReset(() => {
      throw new Error('boom');
    });
    const un3 = registerUserScopedReset(() => ran.push('three'));

    expect(() => runUserScopedResets()).not.toThrow();
    expect(ran).toEqual(['one', 'three']);

    un1();
    un2();
    un3();
  });

  it('unregister stops the callback from firing', () => {
    const fn = vi.fn();
    const unregister = registerUserScopedReset(fn);
    unregister();
    runUserScopedResets();
    expect(fn).not.toHaveBeenCalled();
  });
});
