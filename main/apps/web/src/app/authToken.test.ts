// main/apps/web/src/app/authToken.test.ts
import { tokenStore } from '@bslt/client-engine';
import { ACCESS_TOKEN_COOKIE_NAME } from '@bslt/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAccessToken } from './authToken';

describe('getAccessToken', () => {
  beforeEach(() => {
    tokenStore.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    tokenStore.clear();
    window.localStorage.clear();
  });

  it('returns null when neither memory store nor localStorage holds a non-empty token', () => {
    expect(getAccessToken()).toBeNull();

    window.localStorage.setItem(ACCESS_TOKEN_COOKIE_NAME, '');
    expect(getAccessToken()).toBeNull();
  });

  it('prefers the in-memory tokenStore value over localStorage', () => {
    tokenStore.set('mem-jwt');
    window.localStorage.setItem(ACCESS_TOKEN_COOKIE_NAME, 'stored-jwt');

    expect(getAccessToken()).toBe('mem-jwt');
  });

  it('hydrates tokenStore from localStorage when memory store is empty', () => {
    window.localStorage.setItem(ACCESS_TOKEN_COOKIE_NAME, 'persisted-jwt');

    expect(getAccessToken()).toBe('persisted-jwt');
    expect(tokenStore.get()).toBe('persisted-jwt');
  });
});
