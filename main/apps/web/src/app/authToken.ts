// main/apps/web/src/app/authToken.ts
import { ACCESS_TOKEN_COOKIE_NAME } from '@bslt/shared/constants/system/platform';
import { tokenStore } from '@bslt/shared/system/security';

const hasLocalStorage = (): boolean =>
  typeof globalThis !== 'undefined' && 'localStorage' in globalThis;

const readPersistedToken = (): string | null => {
  if (!hasLocalStorage()) return null;

  const primary = globalThis.localStorage.getItem(ACCESS_TOKEN_COOKIE_NAME);
  if (typeof primary === 'string' && primary.length > 0) return primary;

  return null;
};

export const getAccessToken = (): string | null => {
  const memoryToken = tokenStore.get();
  if (typeof memoryToken === 'string' && memoryToken.length > 0) return memoryToken;

  const persistedToken = readPersistedToken();
  if (persistedToken === null) return null;

  tokenStore.set(persistedToken);
  return persistedToken;
};
