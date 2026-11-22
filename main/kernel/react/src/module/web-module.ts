// main/kernel/react/src/module/web-module.ts
/**
 * React transport context (`TransportProvider`, `useTransport`).
 */

import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react';

import type { Transport } from '@bslt/client-engine';

const TransportContext = createContext<Transport | undefined>(undefined);

export function TransportProvider({
  transport,
  children,
}: {
  readonly transport: Transport;
  readonly children?: ReactNode;
}): ReactElement {
  return createElement(TransportContext.Provider, { value: transport }, children);
}

export function useTransport(): Transport {
  const transport = useContext(TransportContext);
  if (transport === undefined) {
    throw new Error('useTransport must be used within TransportProvider');
  }
  return transport;
}
