// main/shared/src/contracts/edition-ports.ts
import type { StorageProvider } from '../modules/storage';

/** Storage required by account cleanup, independent of the file-management extension. */
export interface FileStorageProvider {
  provider?: StorageProvider | undefined;
  upload(key: string, data: Uint8Array | string, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

/** The host may provide a commercial billing notifier. Core does not implement it. */
export type PendingBillingNotification =
  | { readonly kind: 'payment_failed'; readonly userId: string; readonly amountCents: number }
  | { readonly kind: 'payment_recovered'; readonly userId: string }
  | { readonly kind: 'account_suspended'; readonly userId: string; readonly reason: string };
export interface BillingNotifier {
  dispatch(pending: readonly PendingBillingNotification[]): Promise<void>;
}
