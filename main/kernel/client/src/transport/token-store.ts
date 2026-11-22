// main/kernel/client/src/transport/token-store.ts
import { ACCESS_TOKEN_COOKIE_NAME } from '@bslt/contract';

export type TokenStore = {
  get: () => string | null;
  set: (token: string) => void;
  clear: () => void;
};

export function addAuthHeader(headers: Headers, token: string | null | undefined): Headers {
  if (token !== null && token !== undefined && token !== '') {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

const hasLocalStorage = (): boolean =>
  typeof globalThis !== 'undefined' && 'localStorage' in globalThis;

const readPersistedToken = (): string | null => {
  if (!hasLocalStorage()) return null;
  const primary = globalThis.localStorage.getItem(ACCESS_TOKEN_COOKIE_NAME);
  if (primary !== null && primary !== '') return primary;
  return null;
};

const persistToken = (value: string): void => {
  if (!hasLocalStorage()) return;
  globalThis.localStorage.setItem(ACCESS_TOKEN_COOKIE_NAME, value);
};

const clearPersistedToken = (): void => {
  if (!hasLocalStorage()) return;
  globalThis.localStorage.removeItem(ACCESS_TOKEN_COOKIE_NAME);
  globalThis.localStorage.removeItem('token');
};

const createMemoryTokenStore = (): TokenStore => {
  let token: string | null = null;
  return {
    get: (): string | null => token,
    set: (value: string): void => {
      token = value;
    },
    clear: (): void => {
      token = null;
    },
  };
};

const createLocalStorageTokenStore = (): TokenStore => ({
  get: (): string | null => readPersistedToken(),
  set: (value: string): void => {
    persistToken(value);
  },
  clear: (): void => {
    clearPersistedToken();
  },
});

export const tokenStore: TokenStore = createMemoryTokenStore();

export const createTokenStore = {
  memory: createMemoryTokenStore,
  localStorage: createLocalStorageTokenStore,
};
