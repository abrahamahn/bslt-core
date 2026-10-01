// main/apps/web/src/features/auth/authModalStore.ts
/**
 * Auth-modal store.
 *
 * External store for the global AuthModal (mounted in AppLayout): whether it
 * is open and which mode it starts in. The header Login/Register buttons and
 * the URL-preserving auth route stubs (/login, /register, /auth) all open it
 * through this store.
 */

import { useSyncExternalStore } from 'react';

import type { AuthMode } from '@bslt/react/hooks';

export interface AuthModalState {
  readonly open: boolean;
  readonly mode: AuthMode;
}

let state: AuthModalState = { open: false, mode: 'login' };
const listeners = new Set<() => void>();

function setState(next: AuthModalState): void {
  state = next;
  listeners.forEach((listener) => {
    listener();
  });
}

export function openAuthModal(mode: AuthMode = 'login'): void {
  setState({ open: true, mode });
}

export function closeAuthModal(): void {
  if (state.open) setState({ ...state, open: false });
}

export function getAuthModalState(): AuthModalState {
  return state;
}

export function subscribeAuthModal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuthModal(): AuthModalState {
  return useSyncExternalStore(subscribeAuthModal, getAuthModalState, getAuthModalState);
}
