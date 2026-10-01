// main/shared/src/modules/core/auth/auth.session.logic.ts
/**
 * How long a signed-in session lives, and how long it may sit untouched.
 *
 * Two dials, not one. The SPAN is the outer bound — the refresh cookie's
 * `maxAge` and the token family's expiry, chosen once at login by whether the
 * user asked to be kept signed in. The IDLE WINDOW is how long a session may go
 * without refreshing before the server retires it early; it is derived FROM the
 * span, so the cookie and the server cannot tell different stories about the
 * same session.
 *
 * That derivation is the point. A fixed idle timeout paired with a longer
 * cookie is the bug this replaces: the browser holds a credential the server
 * has already decided to reject, and the user is signed out while holding what
 * looks like a valid session. Deriving the window from the span means a session
 * whose cookie survives seven days is actually usable for seven days, and one
 * issued for half a day still dies in half a day.
 *
 * The idle window is deliberately generous relative to any client refresh
 * cadence. Browsers throttle and freeze timers in background tabs, so a tab left
 * open refreshes far less often than its interval promises — a window tight
 * enough to catch a truly abandoned session is also tight enough to kill a tab
 * its owner was coming back to.
 */

import { MS_PER_DAY } from '../../../constants/time';

/** "Keep me signed in": a month, the ceiling for a shared-device risk. */
export const REMEMBERED_SESSION_DAYS = 30;

/** Unchecked: the rest of the day, so a borrowed device expires the same day. */
export const DEFAULT_SESSION_DAYS = 0.5;

/**
 * The longest any session may sit untouched, whatever its span.
 *
 * A shorter session is still bounded by its own span — see
 * {@link sessionIdleWindowMs} — so a 12-hour login cannot linger for a week;
 * this cap only ever bites the remembered session.
 */
export const MAX_IDLE_MS = 7 * MS_PER_DAY;

/**
 * The span a login should get, from the request's remember-me flag.
 *
 * @param rememberMe - Whether the user asked to stay signed in
 * @returns Session span in days
 */
export function sessionSpanDays(rememberMe: boolean | undefined): number {
  return rememberMe === true ? REMEMBERED_SESSION_DAYS : DEFAULT_SESSION_DAYS;
}

/**
 * Recover the span a session was issued with from the token row itself, so a
 * rotation preserves what the user chose at login.
 *
 * Storing the choice in the dates it already produced beats adding a column
 * that could disagree with them — there is no second source to drift.
 *
 * @param createdAt - When the token was issued
 * @param expiresAt - When the token expires
 * @returns The original span in days
 */
export function sessionSpanDaysOf(createdAt: Date, expiresAt: Date): number {
  return (expiresAt.getTime() - createdAt.getTime()) / MS_PER_DAY;
}

/**
 * How long this session may sit unrefreshed: its own span, capped at
 * {@link MAX_IDLE_MS}.
 *
 * @param spanDays - The session's span in days
 * @returns Idle window in milliseconds
 */
export function sessionIdleWindowMs(spanDays: number): number {
  return Math.min(MAX_IDLE_MS, spanDays * MS_PER_DAY);
}
