// main/apps/web/src/app/queryPersistencePolicy.ts
/**
 * Query persistence policy
 *
 * Decides which queries may be persisted to / restored from IndexedDB.
 *
 * Live "current user" data (profile, account, session) must never be replayed
 * from a stale persisted snapshot on cold load — doing so renders the previous
 * value for a beat before the network refetch swaps in the fresh one (the
 * old → new flash after editing a profile field or avatar). These queries are
 * cheap to refetch, so we exclude them from persistence and let them load fresh.
 */

const VOLATILE_KEY_SEGMENTS: ReadonlySet<string> = new Set(['user', 'users']);
const VOLATILE_KEY_PREFIX = '/api/users';

/**
 * Query heads whose data is user-specific AND sensitive: it must not sit on
 * disk in IndexedDB (readable between sessions) and must always load fresh.
 * This is a security floor, not just a freshness one — the user-switch reset
 * clears the cache, but nothing should persist these to begin with.
 */
const NON_PERSISTABLE_HEADS: ReadonlySet<string> = new Set([
  'apiKeys', // API key metadata (prefixes / last-used)
  'sessions', // active session list
  'devices', // trusted-device list
  'billing', // subscription / invoices / payment methods / usage — financial
  'notifications', // may contain message content + preferences
  'legal', // per-user acceptance/agreement state
]);

/**
 * Returns `false` for live current-user / account / session queries and for
 * sensitive user-scoped data (billing, sessions, api keys, …) — all must load
 * fresh and never persist to disk — and `true` for everything else (safe to
 * keep in IndexedDB for offline use).
 */
export function isPersistableQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  if (typeof head !== 'string') return true;
  if (VOLATILE_KEY_SEGMENTS.has(head)) return false;
  if (NON_PERSISTABLE_HEADS.has(head)) return false;
  if (head.startsWith(VOLATILE_KEY_PREFIX)) return false;
  return true;
}
