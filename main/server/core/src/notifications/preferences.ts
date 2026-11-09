// main/server/core/src/notifications/preferences.ts
/**
 * Notification Preferences
 *
 * Business logic for notification preference handling: reading/merging stored
 * preferences and evaluating whether a notification should be delivered on a
 * given channel (including quiet hours and the email unsubscribe gate).
 */

import { eq, insert, select, update } from '@bslt/db/builder';
import {
  NOTIFICATION_PREFERENCES_TABLE,
  NOTIFICATION_PREFERENCE_COLUMNS,
  type NotificationPreference as DbNotificationPreference,
  type QuietHoursConfig,
  type TypePreferences,
} from '@bslt/db/schema';
import { toCamelCase } from '@bslt/db/utils';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationChannel,
  type NotificationPreferences,
  type NotificationType,
  type NotificationTypePreference,
  type UpdatePreferencesRequest,
} from '@bslt/shared/comms/notifications';

import { shouldSendEmail } from './unsubscribe';

import type { DbClient } from '@bslt/db/client';

/**
 * Look up stored notification preferences for a user without creating a row.
 *
 * @param db - Database client
 * @param userId - User ID
 * @returns Stored preferences if a row exists, otherwise `null`
 * @complexity O(1) - single indexed lookup
 */
async function findPreferences(
  db: DbClient,
  userId: string,
): Promise<NotificationPreferences | null> {
  const row = await db.queryOne(
    select(NOTIFICATION_PREFERENCES_TABLE).where(eq('user_id', userId)).limit(1).toSql(),
  );
  if (row === null) return null;

  return dbPrefsToNotificationPrefs(
    toCamelCase<DbNotificationPreference>(row, NOTIFICATION_PREFERENCE_COLUMNS),
  );
}

/**
 * Resolve the preferences to DECIDE against, without writing anything.
 *
 * A user who has never opened the settings screen has no row, and the answer
 * for them is the shipped default — not a row that must first be created. Use
 * this on every delivery-decision path.
 *
 * The distinction from {@link getPreferences} is the point: that one is a
 * read-or-CREATE, so calling it to make a decision writes a row as a side
 * effect. On an admin broadcast that is one INSERT per recipient who has never
 * touched their settings — a write per user, fanned out concurrently, to learn
 * a value that is a constant. It also made the send path fail closed for the
 * wrong reason: with nothing to return from the INSERT, it threw, and the
 * endpoint 500'd rather than delivering.
 *
 * @param db - Database client
 * @param userId - User ID
 * @returns Stored preferences, falling back to the system defaults
 * @complexity O(1) - single indexed lookup, no write
 */
export async function readPreferences(
  db: DbClient,
  userId: string,
): Promise<NotificationPreferences> {
  return (await findPreferences(db, userId)) ?? { userId, ...DEFAULT_NOTIFICATION_PREFERENCES };
}

/**
 * Get user notification preferences, materialising the row if it is absent.
 *
 * Only for the paths that genuinely need the row to exist afterwards — reading
 * your own preferences and updating them. To merely decide whether to deliver,
 * use {@link readPreferences}, which does not write.
 *
 * @param db - Database client
 * @param userId - User ID
 * @returns Notification preferences (creates defaults if not found)
 * @throws {Error} If the preference insert fails
 * @complexity O(1) - single query + conditional insert
 */
export async function getPreferences(
  db: DbClient,
  userId: string,
): Promise<NotificationPreferences> {
  const existing = await findPreferences(db, userId);
  if (existing !== null) return existing;

  // Create default preferences
  const newPrefsRows = await db.query(
    insert(NOTIFICATION_PREFERENCES_TABLE)
      .values({
        user_id: userId,
        global_enabled: DEFAULT_NOTIFICATION_PREFERENCES.globalEnabled,
        quiet_hours: DEFAULT_NOTIFICATION_PREFERENCES.quietHours,
        types: DEFAULT_NOTIFICATION_PREFERENCES.types,
      })
      .returningAll()
      .toSql(),
  );

  if (newPrefsRows[0] === undefined) {
    throw new Error('Failed to create notification preferences');
  }

  const newPrefs = toCamelCase<DbNotificationPreference>(
    newPrefsRows[0],
    NOTIFICATION_PREFERENCE_COLUMNS,
  );
  return dbPrefsToNotificationPrefs(newPrefs);
}

/**
 * Update user notification preferences.
 *
 * Merges updates with current preferences, supporting partial updates
 * for globalEnabled, quietHours, and individual notification types.
 *
 * @param db - Database client
 * @param userId - User ID
 * @param updates - Partial preference updates
 * @returns Updated preferences
 * @throws {Error} If the preference update fails
 * @complexity O(1) - get current + update
 */
export async function updatePreferences(
  db: DbClient,
  userId: string,
  updates: UpdatePreferencesRequest,
): Promise<NotificationPreferences> {
  // Get current preferences (creates if not exists)
  const current = await getPreferences(db, userId);

  // Build update object
  const updateData: Record<string, unknown> = {
    updated_at: new Date(),
  };

  if (updates.globalEnabled !== undefined) {
    updateData['global_enabled'] = updates.globalEnabled;
  }

  const quietHoursUpdate = updates.quietHours;
  if (quietHoursUpdate !== undefined) {
    // Type assertion needed for JSONB field from database
    const newQuietHours: QuietHoursConfig = {
      ...current.quietHours,
    };
    if (quietHoursUpdate.enabled !== undefined) {
      newQuietHours.enabled = quietHoursUpdate.enabled;
    }
    if (quietHoursUpdate.startHour !== undefined) {
      newQuietHours.startHour = quietHoursUpdate.startHour;
    }
    if (quietHoursUpdate.endHour !== undefined) {
      newQuietHours.endHour = quietHoursUpdate.endHour;
    }
    if (quietHoursUpdate.timezone !== undefined) {
      newQuietHours.timezone = quietHoursUpdate.timezone;
    }
    updateData['quiet_hours'] = newQuietHours;
  }

  const typesUpdate = updates.types;
  if (typesUpdate !== undefined) {
    // Type assertion needed for JSONB field from database
    const newTypes: TypePreferences = {
      ...(current.types as TypePreferences),
    };
    for (const type of Object.keys(typesUpdate) as NotificationType[]) {
      const typeUpdate = typesUpdate[type];
      if (typeUpdate === undefined) {
        continue;
      }
      const existingType = newTypes[type];
      // No longer checking for undefined - TypePreferences ensures all types exist
      if (typeUpdate.enabled !== undefined) {
        existingType.enabled = typeUpdate.enabled;
      }
      if (typeUpdate.channels !== undefined) {
        existingType.channels = typeUpdate.channels;
      }
    }
    updateData['types'] = newTypes;
  }

  const updatedRows = await db.query(
    update(NOTIFICATION_PREFERENCES_TABLE)
      .set(updateData)
      .where(eq('user_id', userId))
      .returningAll()
      .toSql(),
  );

  if (updatedRows[0] === undefined) {
    throw new Error('Failed to update notification preferences');
  }

  const updated = toCamelCase<DbNotificationPreference>(
    updatedRows[0],
    NOTIFICATION_PREFERENCE_COLUMNS,
  );
  return dbPrefsToNotificationPrefs(updated);
}

/**
 * Check if a user should receive a notification of the given type on a
 * specific delivery channel.
 *
 * Evaluates preferences in order:
 * 1. Global enabled flag
 * 2. Type-specific enabled flag (falling back to the system default for a type
 *    missing from a user's stored preferences, e.g. a category added later)
 * 3. The requested `channel` is enabled for the type
 * 4. Quiet hours — only for interrupting channels (`push`/`sms`); persistent
 *    `in_app` records and `email` are never silently dropped by quiet hours
 *
 * @param db - Database client
 * @param userId - User ID
 * @param type - Notification type (category)
 * @param channel - Delivery channel being evaluated (defaults to `push`)
 * @returns true if the notification should be delivered on that channel
 * @complexity O(1) - single preference lookup + evaluation
 */
export async function shouldSendNotification(
  db: DbClient,
  userId: string,
  type: NotificationType,
  channel: NotificationChannel = 'push',
): Promise<boolean> {
  const prefs = await readPreferences(db, userId);
  if (!isNotificationAllowed(prefs, type, channel)) {
    return false;
  }

  // Email carries a SECOND, independent opt-out: the one-click unsubscribe link
  // in the message itself. It is legally mandated, and a user can act on it
  // without ever opening the preferences screen — so a row in
  // `email_unsubscribes` and a row in `notification_preferences` are two
  // different statements and both bind. Consulting only the preferences would
  // mean an unsubscribe click is recorded and then ignored, which is exactly the
  // failure the unsubscribe table was added to prevent.
  //
  // This is the only caller of `shouldSendEmail`, and deliberately so: one gate,
  // consulted per channel, rather than two that can disagree.
  if (channel === 'email') {
    return shouldSendEmail(db, userId, type);
  }

  return true;
}

/**
 * Pure preference evaluation used by {@link shouldSendNotification}. Separated
 * so the routing rules can be unit-tested without a database.
 *
 * @param prefs - Resolved user notification preferences
 * @param type - Notification type (category)
 * @param channel - Delivery channel being evaluated
 * @param nowHour - Resolves the current hour in a timezone (injected for tests)
 * @returns true if the notification should be delivered on that channel
 * @complexity O(1)
 */
export function isNotificationAllowed(
  prefs: NotificationPreferences,
  type: NotificationType,
  channel: NotificationChannel,
  nowHour: (timezone: string) => number = getCurrentHourInTimezone,
): boolean {
  // Check global enabled
  if (!prefs.globalEnabled) {
    return false;
  }

  // Check type-specific enabled. A user's stored JSONB may predate a newly
  // added category, so fall back to the system default for that type rather
  // than crashing on an undefined lookup.
  // Type assertion needed for JSONB field from database.
  const prefsTypes = prefs.types as TypePreferences;
  // The DB JSONB is typed as a complete record, but a stored row may predate a
  // category, so treat the lookup as possibly-undefined and fall back.
  const typePrefs =
    (prefsTypes[type] as NotificationTypePreference | undefined) ??
    DEFAULT_NOTIFICATION_PREFERENCES.types[type];
  if (!typePrefs.enabled) {
    return false;
  }

  // The requested delivery channel must be enabled for this type.
  const channels: string[] = typePrefs.channels;
  if (!channels.includes(channel)) {
    return false;
  }

  // Quiet hours only gate interrupting channels. A persistent in-app record or
  // an email must not be lost just because the user is in quiet hours — they
  // would never be re-delivered.
  const isInterrupting = channel === 'push' || channel === 'sms';
  // Type assertion needed for JSONB field from database
  const prefsQuietHours = prefs.quietHours;
  if (isInterrupting && prefsQuietHours.enabled) {
    const userHour = nowHour(prefsQuietHours.timezone);
    const startHour: number = prefsQuietHours.startHour;
    const endHour: number = prefsQuietHours.endHour;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startHour > endHour) {
      if (userHour >= startHour || userHour < endHour) {
        return false;
      }
    } else {
      if (userHour >= startHour && userHour < endHour) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Hour formatters cached per timezone: Intl.DateTimeFormat construction is
 * expensive and this runs for every notification delivery check. Bounded by
 * the set of valid IANA timezones (~400).
 */
const hourFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Get current hour in a specific timezone.
 * Falls back to UTC if timezone is invalid.
 *
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Current hour (0-23) in the specified timezone
 * @complexity O(1)
 */
function getCurrentHourInTimezone(timezone: string): number {
  try {
    let formatter = hourFormatterCache.get(timezone);
    if (formatter === undefined) {
      // Throws on invalid timezones, so only valid ones are cached
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      hourFormatterCache.set(timezone, formatter);
    }
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart !== undefined ? parseInt(hourPart.value, 10) : new Date().getUTCHours();
  } catch {
    // Invalid timezone, fall back to UTC
    return new Date().getUTCHours();
  }
}

/**
 * Convert database preferences to NotificationPreferences.
 *
 * @param dbPrefs - Database preference record
 * @returns Normalized NotificationPreferences
 * @complexity O(1)
 */
function dbPrefsToNotificationPrefs(dbPrefs: DbNotificationPreference): NotificationPreferences {
  // Database JSONB fields are properly typed in the schema
  const quietHours: QuietHoursConfig = dbPrefs.quietHours;
  const types: TypePreferences = dbPrefs.types;
  return {
    userId: dbPrefs.userId,
    globalEnabled: dbPrefs.globalEnabled,
    quietHours,
    types,
    updatedAt: dbPrefs.updatedAt,
  };
}
