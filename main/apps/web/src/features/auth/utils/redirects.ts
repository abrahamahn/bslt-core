// main/apps/web/src/features/auth/utils/redirects.ts

import { isAccountActive } from '@bslt/shared/core/users';

interface UserLocal {
  role?: string;
  deactivatedAt?: string | null | undefined;
  deletedAt?: string | null | undefined;
  deletionGracePeriodEnds?: string | null | undefined;
}

const toLifecycleDate = (value: string | null | undefined): Date | null =>
  value != null ? new Date(value) : null;

/**
 * Whether the signed-in user's account is inactive (deactivated or pending
 * deletion). The server now lets such users log in so they can self-service
 * reactivate; the client routes them to the reactivation prompt.
 */
function isInactiveAccount(user: UserLocal | null | undefined): boolean {
  if (user == null) return false;
  return !isAccountActive({
    deactivatedAt: toLifecycleDate(user.deactivatedAt),
    deletedAt: toLifecycleDate(user.deletedAt),
    deletionGracePeriodEnds: toLifecycleDate(user.deletionGracePeriodEnds),
  });
}

/**
 * Validate that a redirect path is safe (prevents open-redirect attacks).
 * Only allows relative paths starting with a single slash.
 */
function isSafeRedirectPath(path: string): boolean {
  // Decode first, then validate the decoded result
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }

  // Remove ASCII control chars that could bypass scheme checks
  let cleaned = '';
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) {
      const char = decoded[i];
      if (char !== undefined) {
        cleaned += char;
      }
    }
  }

  // Must be a relative path starting with exactly one slash
  if (!cleaned.startsWith('/')) return false;
  if (cleaned.startsWith('//')) return false;

  // Block dangerous URI schemes anywhere in the path
  const lower = cleaned.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('data:') || lower.includes('vbscript:')) {
    return false;
  }

  return true;
}

/**
 * Determine where to redirect after login.
 * Honors a safe `returnTo` path if provided, otherwise falls back to role-based defaults.
 */
export function getPostLoginRedirect(
  user: UserLocal | null | undefined,
  returnTo?: string | null,
): string {
  // Inactive accounts must reactivate before doing anything else — this wins
  // over a `returnTo` so a deep link can't skip the reactivation prompt.
  if (isInactiveAccount(user)) {
    return '/reactivate';
  }

  if (returnTo != null && returnTo !== '' && isSafeRedirectPath(returnTo)) {
    return returnTo;
  }

  return '/profile';
}
