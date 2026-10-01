// main/server/core/src/notifications/admin-alerts.ts
/**
 * Admin Activity Alerts
 *
 * Fans important user-account activity out to privileged users (admins and
 * moderators) as in-app notifications, surfaced through the existing
 * notification bell/feed. Invoked fire-and-forget from event sites in the
 * auth and users modules, mirroring the audit `record(...)` pattern.
 *
 * @module notifications/admin-alerts
 */

import { type Logger } from '@bslt/shared/system';

import type { Repositories } from '@bslt/db/factory';
import type { UserRole } from '@bslt/db/schema';
import type { NotificationLevel } from '@bslt/shared/comms/notifications';

// ============================================================================
// Types
// ============================================================================

/** Roles that receive admin activity alerts. */
const ALERT_RECIPIENT_ROLES: readonly UserRole[] = ['admin', 'moderator'];

/** Key identifying which user-activity event triggered an alert. */
export type AdminAlertEventType =
  | 'user_signup'
  | 'account_deactivated'
  | 'deletion_requested'
  | 'account_reactivated'
  | 'password_changed'
  | 'password_reset'
  | 'new_device_login'
  | 'account_locked';

/**
 * Identity of the user the activity concerns. The subject is never required to
 * be a registered account (e.g. account_locked can fire for an unknown email),
 * so all fields are optional except a human-readable label resolved at build time.
 */
export interface AdminAlertSubject {
  readonly userId?: string;
  readonly email?: string;
  readonly username?: string | null;
  readonly ipAddress?: string;
}

export interface AdminAlertEvent {
  readonly type: AdminAlertEventType;
  readonly subject: AdminAlertSubject;
}

/**
 * Minimal dependency surface so any event site can emit alerts.
 *
 * `log` is optional: handler-layer sites pass their request logger, while
 * deep service functions that have no logger in scope may omit it (failures
 * are then swallowed silently, preserving the best-effort contract).
 */
export interface AdminAlertDeps {
  readonly repos: Pick<Repositories, 'users' | 'notifications'>;
  readonly log?: Logger;
}

// ============================================================================
// Event → presentation mapping
// ============================================================================

const EVENT_LEVEL: Record<AdminAlertEventType, NotificationLevel> = {
  user_signup: 'info',
  account_reactivated: 'info',
  password_changed: 'warning',
  password_reset: 'warning',
  account_deactivated: 'warning',
  deletion_requested: 'warning',
  new_device_login: 'warning',
  account_locked: 'error',
};

const EVENT_TITLE: Record<AdminAlertEventType, string> = {
  user_signup: 'New user registered',
  account_reactivated: 'Account reactivated',
  password_changed: 'Password changed',
  password_reset: 'Password reset completed',
  account_deactivated: 'Account deactivated',
  deletion_requested: 'Account deletion requested',
  new_device_login: 'New device sign-in',
  account_locked: 'Account locked (unusual activity)',
};

/** Human-readable label for the subject user. */
function subjectLabel(subject: AdminAlertSubject): string {
  if (subject.email !== undefined && subject.email !== '') return subject.email;
  if (subject.username !== undefined && subject.username !== null && subject.username !== '') {
    return subject.username;
  }
  if (subject.userId !== undefined && subject.userId !== '') return subject.userId;
  return 'a user';
}

function buildMessage(event: AdminAlertEvent): string {
  const who = subjectLabel(event.subject);
  const from =
    event.subject.ipAddress !== undefined && event.subject.ipAddress !== ''
      ? ` from ${event.subject.ipAddress}`
      : '';

  switch (event.type) {
    case 'user_signup':
      return `${who} created an account.`;
    case 'account_reactivated':
      return `${who} reactivated their account.`;
    case 'password_changed':
      return `${who} changed their password.`;
    case 'password_reset':
      return `${who} reset their password.`;
    case 'account_deactivated':
      return `${who} deactivated their account.`;
    case 'deletion_requested':
      return `${who} requested account deletion.`;
    case 'new_device_login':
      return `${who} signed in from a new device${from}.`;
    case 'account_locked':
      return `${who} was locked out after repeated failed sign-ins${from}.`;
  }
}

// ============================================================================
// Emitter
// ============================================================================

/**
 * Create one in-app notification per active admin/moderator describing a
 * user-activity event. Best-effort: never throws into the caller — failures
 * are logged and swallowed so the primary operation is unaffected.
 *
 * @param deps - Repositories (users, notifications) and logger
 * @param event - The activity event and its subject
 * @complexity O(n) where n is the number of admin/moderator recipients
 */
export async function notifyAdmins(deps: AdminAlertDeps, event: AdminAlertEvent): Promise<void> {
  try {
    const recipients = await deps.repos.users.findActiveByRoles(ALERT_RECIPIENT_ROLES);
    if (recipients.length === 0) {
      return;
    }

    const level = EVENT_LEVEL[event.type];
    const title = EVENT_TITLE[event.type];
    const message = buildMessage(event);
    const data: Record<string, unknown> = {
      eventType: event.type,
      targetUserId: event.subject.userId ?? null,
      targetEmail: event.subject.email ?? null,
      ipAddress: event.subject.ipAddress ?? null,
    };

    await Promise.all(
      recipients.map((recipient) =>
        deps.repos.notifications.create({
          userId: recipient.id,
          type: level,
          title,
          message,
          data,
          isRead: false,
        }),
      ),
    );
  } catch (error) {
    deps.log?.error(
      { err: error as Error, eventType: event.type },
      'Failed to emit admin activity alert',
    );
  }
}
