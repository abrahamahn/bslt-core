// main/apps/web/src/app/account/accountModalStore.ts
import { useSyncExternalStore } from 'react';

import { webApp } from '../webApp';

export type AccountModalSection = string;

export const ACCOUNT_MODAL_SECTIONS: readonly AccountModalSection[] =
  webApp.modalSettingsSectionIds;

interface AccountModalState {
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
  return ACCOUNT_MODAL_SECTIONS.includes(value);
}

export function openAccountModal(section: AccountModalSection = 'profile'): void {
  setState({ open: true, section });
}

export function closeAccountModal(): void {
  if (state.open) setState({ ...state, open: false });
}

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

export function useAccountModal(): AccountModalState {
  return useSyncExternalStore(subscribeAccountModal, getAccountModalState, getAccountModalState);
}
