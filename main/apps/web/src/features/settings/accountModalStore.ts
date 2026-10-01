// main/apps/web/src/features/settings/accountModalStore.ts
/**
 * Account-modal store.
 *
 * A tiny external store (same pattern as the active-org store) tracking the
 * unified Profile/Settings modal: whether it is open and which section is
 * active. The header avatar menu opens it, route stubs (/settings, /profile)
 * open it for deep links, and AppLayout hosts the modal itself.
 */

import { useSyncExternalStore } from 'react';

export const ACCOUNT_MODAL_SECTIONS = [
  'profile',
  'security',
  'sessions',
  'notifications',
  'preferences',
  'account',
  'data-controls',
  'api-keys',
  'legal',
] as const;

export type AccountModalSection = (typeof ACCOUNT_MODAL_SECTIONS)[number];

export interface AccountModalState {
  readonly open: boolean;
  readonly section: AccountModalSection;
}

let state: AccountModalState = { open: false, section: 'profile' };
const listeners = new Set<() => void>();

function setState(next: AccountModalState): void {
  state = next;
  listeners.forEach((listener) => {
    listener();
  });
}

export function isAccountModalSection(value: string): value is AccountModalSection {
  return (ACCOUNT_MODAL_SECTIONS as readonly string[]).includes(value);
}

/** Open the modal at a section (defaults to the current/first section). */
export function openAccountModal(section: AccountModalSection = 'profile'): void {
  setState({ open: true, section });
}

export function closeAccountModal(): void {
  if (state.open) setState({ ...state, open: false });
}

/** Switch section while open (modal sidebar navigation). */
export function setAccountModalSection(section: AccountModalSection): void {
  setState({ ...state, section });
}

export function getAccountModalState(): AccountModalState {
  return state;
}

export function subscribeAccountModal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive accessor for React components (modal host, header menu). */
export function useAccountModal(): AccountModalState {
  return useSyncExternalStore(subscribeAccountModal, getAccountModalState, getAccountModalState);
}
