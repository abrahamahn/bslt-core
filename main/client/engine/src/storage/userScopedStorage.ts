// main/client/engine/src/storage/userScopedStorage.ts
/**
 * Per-user client storage isolation.
 *
 * When the signed-in user changes, two different things must happen to local
 * client state to avoid one user seeing another's data:
 *
 * 1. **Server-data caches must be cleared** so the app refetches fresh from the
 *    DB (a balance, a member list, a profile). Stale server data is a bug, not
 *    a preference — see `clearUserScopedLocalStorage` + the IndexedDB query
 *    cache reset wired into the app's auth-scoped reset.
 * 2. **Per-user preferences/product state should be preserved, not shared** —
 *    namespaced by user id so each user keeps their own saved changes and gets
 *    them back on their next login, while never leaking across a switch. Use
 *    {@link userScopedKey} / {@link createUserScopedStorage} for those.
 *
 * A fork registers its own user-specific keys in {@link USER_SCOPED_LOCAL_KEYS}
 * (for the clear-on-switch behavior) and/or stores product state through
 * {@link createUserScopedStorage} (for the preserve-per-user behavior).
 */

/**
 * localStorage keys holding user-specific state that must be dropped when the
 * signed-in user changes. These are single-slot (not namespaced), so the next
 * user would otherwise inherit them. A fork appends its own keys.
 */
export const USER_SCOPED_LOCAL_KEYS: readonly string[] = [
  'bslt.activeOrgId', // active tenant — must not carry into a different user
  'dataExportRequestId', // a user's in-flight GDPR export request id
];

/** Remove every registered user-scoped localStorage key. Safe when absent. */
export function clearUserScopedLocalStorage(
  keys: readonly string[] = USER_SCOPED_LOCAL_KEYS,
): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be unavailable (private mode / quota) — best effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Reset registry — the extension point for in-memory user-scoped stores.
// ---------------------------------------------------------------------------
//
// `clearUserScopedLocalStorage` only touches localStorage; a store that also
// caches a value in a module variable (e.g. the active-org store) must reset
// that too, or a same-tab user switch keeps serving the stale value. Such a
// store registers a reset callback here; the app's auth-scoped reset flushes
// them all on a user change. A fork's product store registers the same way.

const userScopedResets = new Set<() => void>();

/**
 * Register a callback that resets an in-memory user-scoped store. Returns an
 * unregister function. Call this once at module load from the store.
 */
export function registerUserScopedReset(reset: () => void): () => void {
  userScopedResets.add(reset);
  return () => userScopedResets.delete(reset);
}

/** Invoke every registered reset. Called by the app on a signed-in-user change. */
export function runUserScopedResets(): void {
  for (const reset of userScopedResets) {
    try {
      reset();
    } catch {
      // One store's failure must not block the others.
    }
  }
}

/** Namespace suffix for guest (signed-out) state. */
const GUEST_USER = 'guest';

/**
 * Namespace a storage key by user id so each user's value is isolated and
 * preserved across a user switch: `<key>::u:<userId>`. A `null` id (signed
 * out) maps to a shared guest namespace.
 *
 * @example
 * localStorage.setItem(userScopedKey('shop.cart', userId), json);
 */
export function userScopedKey(key: string, userId: string | null): string {
  return `${key}::u:${userId === null || userId === '' ? GUEST_USER : userId}`;
}

/** A get/set/remove surface bound to one user's namespace. */
export interface UserScopedStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Build a localStorage-backed store whose keys are namespaced to `userId`, so a
 * fork can persist per-user product state (preferences, drafts, UI layout) that
 * survives that user's re-login and never bleeds into another user's session.
 */
export function createUserScopedStorage(userId: string | null): UserScopedStorage {
  const available = typeof localStorage !== 'undefined';
  return {
    get(key: string): string | null {
      if (!available) return null;
      try {
        return localStorage.getItem(userScopedKey(key, userId));
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      if (!available) return;
      try {
        localStorage.setItem(userScopedKey(key, userId), value);
      } catch {
        // best effort
      }
    },
    remove(key: string): void {
      if (!available) return;
      try {
        localStorage.removeItem(userScopedKey(key, userId));
      } catch {
        // best effort
      }
    },
  };
}
