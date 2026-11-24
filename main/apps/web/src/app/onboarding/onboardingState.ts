// main/apps/web/src/app/onboarding/onboardingState.ts
const ONBOARDING_PREFIX = 'bslt:onboarding:completed:';
const CHECKLIST_PREFIX = 'bslt:dashboard:checklist-dismissed:';

function readBooleanFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBooleanFlag(key: string, value: boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (value) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeUserKey(userId: string | undefined): string | null {
  if (userId === undefined) return null;
  const trimmed = userId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isOnboardingCompleted(userId: string | undefined): boolean {
  const key = normalizeUserKey(userId);
  if (key === null) return false;
  return readBooleanFlag(`${ONBOARDING_PREFIX}${key}`);
}

export function setOnboardingCompleted(userId: string | undefined, completed: boolean): void {
  const key = normalizeUserKey(userId);
  if (key === null) return;
  writeBooleanFlag(`${ONBOARDING_PREFIX}${key}`, completed);
}

export function isChecklistDismissed(userId: string | undefined): boolean {
  const key = normalizeUserKey(userId);
  if (key === null) return false;
  return readBooleanFlag(`${CHECKLIST_PREFIX}${key}`);
}

export function setChecklistDismissed(userId: string | undefined, dismissed: boolean): void {
  const key = normalizeUserKey(userId);
  if (key === null) return;
  writeBooleanFlag(`${CHECKLIST_PREFIX}${key}`, dismissed);
}
