// main/apps/web/src/app/queryPersistencePolicy.ts
/**
 * Query persistence policy (WEB-06 default-deny allowlist).
 *
 * Only endpoints explicitly marked `persist: true` in an installed module's
 * contract may be persisted to / restored from IndexedDB. All other queries
 * default to `false` so live user, session, billing, and sensitive data never
 * sits on disk.
 */

import { webApp } from './webApp';

export function isPersistableQueryKey(queryKey: readonly unknown[]): boolean {
  return webApp.isPersistableQueryKey(queryKey);
}
