// main/server/core/src/notifications/service.ts
/**
 * Notification Service
 *
 * Business logic for push notification operations including
 * subscription management and preference handling.
 *
 * Uses database persistence for subscriptions and preferences.
 *
 * NOTE: Notification sending has been removed (web-push package removed).
 * Subscription management and preferences remain for future provider implementations.
 */

import {
  and,
  deleteFrom,
  eq,
  inArray,
  insert,
  select,
  selectCount,
  update,
} from '@bslt/db/builder';
import {
  NOTIFICATIONS_TABLE,
  NOTIFICATION_PREFERENCES_TABLE,
  NOTIFICATION_PREFERENCE_COLUMNS,
  PUSH_SUBSCRIPTIONS_TABLE,
  PUSH_SUBSCRIPTION_COLUMNS,
  type NewNotification,
  type NotificationPreference as DbNotificationPreference,
  type PushSubscription as DbPushSubscription,
  type QuietHoursConfig,
  type TypePreferences,
} from '@bslt/db/schema';
import { toCamelCase } from '@bslt/db/utils';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  SubscriptionExistsError,
} from '@bslt/shared/comms/notifications';
import {
  type NotificationChannel,
  type NotificationLevel,
  type NotificationPreferences,
  type NotificationType,
  type NotificationTypePreference,
  type PushSubscription,
  type StoredPushSubscription,
  type UpdatePreferencesRequest,
} from '@bslt/shared/comms/notifications';
import { DAYS_PER_WEEK, MS_PER_DAY } from '@bslt/shared/constants/time';

import { shouldSendEmail } from './unsubscribe';

import type { DbClient } from '@bslt/db/client';

// ============================================================================
// Subscription Management
// ============================================================================

/**
 * Subscribe a user to push notifications.
 *
 * If an endpoint already exists for the same user, the subscription is
 * reactivated and updated. If the endpoint belongs to a different user,
 * a SubscriptionExistsError is thrown.
 *
 * @param db - Database client
 * @param userId - User ID
 * @param subscription - Push subscription from browser
 * @param deviceId - Device identifier
 * @param userAgent - User agent string
 * @returns Subscription ID
 * @throws {SubscriptionExistsError} If the endpoint is registered to another user
 * @throws {Error} If the subscription insert fails
 * @complexity O(1) - single query + conditional update or insert
 */
export async function subscribe(
  db: DbClient,
  userId: string,
  subscription: PushSubscription,
  deviceId: string,
  userAgent: string,
): Promise<string> {
  // Check if endpoint already exists
  const existingRow = await db.queryOne(
    select(PUSH_SUBSCRIPTIONS_TABLE).where(eq('endpoint', subscription.endpoint)).limit(1).toSql(),
  );

  if (existingRow !== null) {
    const existing = toCamelCase<DbPushSubscription>(existingRow, PUSH_SUBSCRIPTION_COLUMNS);
    if (existing.userId === userId) {
      // Update existing subscription - reactivate and update lastUsedAt
      await db.execute(
        update(PUSH_SUBSCRIPTIONS_TABLE)
          .set({
            is_active: true,
            last_used_at: new Date(),
            keys_p256dh: subscription.keys.p256dh,
            keys_auth: subscription.keys.auth,
            expiration_time:
              subscription.expirationTime !== null && subscription.expirationTime !== 0
                ? new Date(subscription.expirationTime)
                : null,
          })
          .where(eq('id', existing.id))
          .toSql(),
      );
      return existing.id;
    }
    throw new SubscriptionExistsError('Endpoint already registered to another user');
  }

  // Create new subscription
  const newSubRows = await db.query(
    insert(PUSH_SUBSCRIPTIONS_TABLE)
      .values({
        user_id: userId,
        endpoint: subscription.endpoint,
        expiration_time:
          subscription.expirationTime !== null && subscription.expirationTime !== 0
            ? new Date(subscription.expirationTime)
            : null,
        keys_p256dh: subscription.keys.p256dh,
        keys_auth: subscription.keys.auth,
        device_id: deviceId,
        user_agent: userAgent !== '' ? userAgent : null,
        is_active: true,
      })
      .returning('id')
      .toSql(),
  );

  if (newSubRows[0] === undefined) {
    throw new Error('Failed to create subscription');
  }

  return (newSubRows[0] as { id: string }).id;
}

/**
 * Unsubscribe from push notifications.
 *
 * Removes a subscription by ID or endpoint URL, scoped to the owning user so
 * one user cannot remove another user's subscription by guessing identifiers.
 * At least one identifier must be provided.
 *
 * @param db - Database client
 * @param userId - Owning user ID (subscriptions of other users are untouched)
 * @param subscriptionId - Subscription ID to remove
 * @param endpoint - Alternative: endpoint URL to remove
 * @returns true if subscription was found and removed
 * @complexity O(1) - single delete query
 */
export async function unsubscribe(
  db: DbClient,
  userId: string,
  subscriptionId?: string,
  endpoint?: string,
): Promise<boolean> {
  let result: Record<string, unknown>[];

  if (subscriptionId !== undefined && subscriptionId !== '') {
    result = await db.query(
      deleteFrom(PUSH_SUBSCRIPTIONS_TABLE)
        .where(and(eq('id', subscriptionId), eq('user_id', userId)))
        .returning('id')
        .toSql(),
    );
  } else if (endpoint !== undefined && endpoint !== '') {
    result = await db.query(
      deleteFrom(PUSH_SUBSCRIPTIONS_TABLE)
        .where(and(eq('endpoint', endpoint), eq('user_id', userId)))
        .returning('id')
        .toSql(),
    );
  } else {
    return false;
  }

  return result.length > 0;
}

/**
 * Get all subscriptions for a user.
 *
 * @param db - Database client
 * @param userId - User ID
 * @returns Array of active subscriptions for the user
 * @complexity O(n) where n is the number of active subscriptions
 */
export async function getUserSubscriptions(
  db: DbClient,
  userId: string,
): Promise<StoredPushSubscription[]> {
  const rows = await db.query(
    select(PUSH_SUBSCRIPTIONS_TABLE)
      .where(and(eq('user_id', userId), eq('is_active', true)))
      .toSql(),
  );

  return rows.map((row) => {
    const sub = toCamelCase<DbPushSubscription>(row, PUSH_SUBSCRIPTION_COLUMNS);
    return dbSubToStoredSub(sub);
  });
}

/**
 * Get subscription by ID.
 *
 * @param db - Database client
 * @param subscriptionId - Subscription ID
 * @returns Subscription or undefined if not found
 * @complexity O(1) - single query by primary key
 */
export async function getSubscriptionById(
  db: DbClient,
  subscriptionId: string,
): Promise<StoredPushSubscription | undefined> {
  const row = await db.queryOne(
    select(PUSH_SUBSCRIPTIONS_TABLE).where(eq('id', subscriptionId)).limit(1).toSql(),
  );

  if (row === null) return undefined;
  const sub = toCamelCase<DbPushSubscription>(row, PUSH_SUBSCRIPTION_COLUMNS);
  return dbSubToStoredSub(sub);
}

/**
 * Mark subscriptions as inactive (expired).
 *
 * @param db - Database client
 * @param subscriptionIds - IDs to mark as inactive
 * @complexity O(n) where n is the number of subscription IDs
 */
export async function markSubscriptionsExpired(
  db: DbClient,
  subscriptionIds: string[],
): Promise<void> {
  if (subscriptionIds.length === 0) return;

  await db.execute(
    update(PUSH_SUBSCRIPTIONS_TABLE)
      .set({ is_active: false })
      .where(inArray('id', subscriptionIds))
      .toSql(),
  );
}

/**
 * Get all active subscriptions (for broadcast).
 *
 * @param db - Database client
 * @returns Array of all active subscriptions
 * @complexity O(n) where n is the total number of active subscriptions
 */
export async function getAllActiveSubscriptions(db: DbClient): Promise<StoredPushSubscription[]> {
  const rows = await db.query(
    select(PUSH_SUBSCRIPTIONS_TABLE).where(eq('is_active', true)).toSql(),
  );

  return rows.map((row) => {
    const sub = toCamelCase<DbPushSubscription>(row, PUSH_SUBSCRIPTION_COLUMNS);
    return dbSubToStoredSub(sub);
  });
}

/**
 * Convert database subscription to StoredPushSubscription.
 *
 * @param dbSub - Database subscription record
 * @returns Normalized StoredPushSubscription
 * @complexity O(1)
 */
function dbSubToStoredSub(dbSub: DbPushSubscription): StoredPushSubscription {
  return {
    id: dbSub.id,
    userId: dbSub.userId,
    endpoint: dbSub.endpoint,
    expirationTime: dbSub.expirationTime !== null ? dbSub.expirationTime.getTime() : null,
    keys: {
      p256dh: dbSub.keysP256dh,
      auth: dbSub.keysAuth,
    },
    deviceId: dbSub.deviceId,
    userAgent: dbSub.userAgent ?? '',
    createdAt: dbSub.createdAt,
    lastUsedAt: dbSub.lastUsedAt,
    isActive: dbSub.isActive,
  };
}

// ============================================================================
// Preference Management
// ============================================================================

/**
 * Read a user's stored preferences, or `null` if they have never had a row.
 *
 * @param db - Database client
 * @param userId - User ID
 * @returns The stored preferences, or null when no row exists
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
        quiet_hours: DEFAULT_NOTIFICATION_PREFERENCES.quietHours as QuietHoursConfig,
        types: DEFAULT_NOTIFICATION_PREFERENCES.types as TypePreferences,
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
      ...(current.quietHours as QuietHoursConfig),
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
      const existingType = newTypes[type as keyof typeof newTypes];
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
    (prefsTypes[type as keyof TypePreferences] as NotificationTypePreference | undefined) ??
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
  const prefsQuietHours = prefs.quietHours as QuietHoursConfig;
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

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Clean up expired and inactive push subscriptions.
 *
 * Deletes subscriptions that are:
 * 1. Marked as inactive, OR
 * 2. Not used for `inactiveDays` days, OR
 * 3. Past their expiration time
 *
 * @param db - Database client
 * @param inactiveDays - Delete subscriptions not used for this many days (default: 90)
 * @returns Number of subscriptions deleted
 * @complexity O(n) where n is the number of matching subscriptions
 */
export async function cleanupExpiredSubscriptions(
  db: DbClient,
  inactiveDays: number = 90,
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

  const result = await db.raw<{ id: string }>(
    `DELETE FROM ${PUSH_SUBSCRIPTIONS_TABLE}
     WHERE is_active = false
        OR last_used_at < $1
        OR (expiration_time IS NOT NULL AND expiration_time < NOW())
     RETURNING id`,
    [cutoffDate],
  );

  return result.length;
}

/**
 * Get subscription statistics.
 *
 * @param db - Database client
 * @returns Stats about subscriptions (total, active, inactive, expiring soon)
 * @complexity O(1) - aggregate queries
 */
export async function getSubscriptionStats(db: DbClient): Promise<{
  total: number;
  active: number;
  inactive: number;
  expiringSoon: number;
}> {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + DAYS_PER_WEEK * MS_PER_DAY);

  const totalResult = await db.queryOne<{ count: number }>(
    selectCount(PUSH_SUBSCRIPTIONS_TABLE).toSql(),
  );

  const activeResult = await db.queryOne<{ count: number }>(
    selectCount(PUSH_SUBSCRIPTIONS_TABLE).where(eq('is_active', true)).toSql(),
  );

  type ExpiringSoonRow = Record<string, unknown> & { count: string | number };
  const expiringSoonResult = await db.queryOne<ExpiringSoonRow>({
    text: `SELECT COUNT(*)::int as count FROM ${PUSH_SUBSCRIPTIONS_TABLE}
             WHERE expiration_time IS NOT NULL
               AND expiration_time <= $1
               AND expiration_time > $2`,
    values: [weekFromNow, now],
  });

  const total = totalResult?.count ?? 0;
  const active = activeResult?.count ?? 0;
  const expiringSoon =
    typeof expiringSoonResult?.count === 'number'
      ? expiringSoonResult.count
      : parseInt(String(expiringSoonResult?.count ?? 0), 10);

  return {
    total,
    active,
    inactive: total - active,
    expiringSoon,
  };
}

// ============================================================================
// Event-Driven Notifications
// ============================================================================

/**
 * Event types that can trigger in-app notifications.
 */
export type NotificationEventType =
  | 'invite_received'
  | 'payment_success'
  | 'payment_failed'
  | 'security_alert'
  | 'plan_changed';

/**
 * Map event types to notification categories for preference checks.
 */
const EVENT_TYPE_TO_NOTIFICATION_TYPE: Record<NotificationEventType, NotificationType> = {
  invite_received: 'social',
  payment_success: 'transactional',
  payment_failed: 'transactional',
  security_alert: 'security',
  plan_changed: 'transactional',
};

/**
 * Map event types to in-app notification severity levels.
 */
const EVENT_TYPE_TO_LEVEL: Record<NotificationEventType, NotificationLevel> = {
  invite_received: 'info',
  payment_success: 'success',
  payment_failed: 'error',
  security_alert: 'warning',
  plan_changed: 'info',
};

/**
 * Create an in-app notification for a system event.
 * Called by other modules when key events occur.
 *
 * Checks user preferences before creating the notification.
 * If the user has disabled the relevant notification type, no record is created.
 *
 * @param db - Database client
 * @param userId - Target user ID
 * @param event - Event details including type, title, message, and optional metadata
 * @complexity O(1) - preference check + conditional insert
 */
export async function createNotificationForEvent(
  db: DbClient,
  userId: string,
  event: {
    type: NotificationEventType;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  // Check if the user wants this category as an in-app notification. This
  // creates a persistent in-app record, so it is gated on the `in_app` channel
  // (not push) and is not suppressed by quiet hours.
  const notificationType = EVENT_TYPE_TO_NOTIFICATION_TYPE[event.type];
  const allowed = await shouldSendNotification(db, userId, notificationType, 'in_app');
  if (!allowed) {
    return;
  }

  const level = EVENT_TYPE_TO_LEVEL[event.type];
  const notification: NewNotification = {
    userId,
    type: level,
    title: event.title,
    message: event.message,
    data: event.metadata ?? null,
  };

  await db.execute(
    insert(NOTIFICATIONS_TABLE)
      .values({
        user_id: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
      })
      .toSql(),
  );
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all stored notification data (for testing).
 *
 * Deletes all push subscriptions and notification preferences.
 *
 * @param db - Database client
 */
export async function clearAllData(db: DbClient): Promise<void> {
  await db.execute(deleteFrom(PUSH_SUBSCRIPTIONS_TABLE).toSql());
  await db.execute(deleteFrom(NOTIFICATION_PREFERENCES_TABLE).toSql());
}

/**
 * Get subscription count (for testing/monitoring).
 *
 * @param db - Database client
 * @returns Total number of subscriptions
 * @complexity O(1) - aggregate count query
 */
export async function getSubscriptionCount(db: DbClient): Promise<number> {
  const result = await db.queryOne<{ count: number }>(
    selectCount(PUSH_SUBSCRIPTIONS_TABLE).toSql(),
  );
  return result?.count ?? 0;
}

/**
 * Get active subscription count (for testing/monitoring).
 *
 * @param db - Database client
 * @returns Number of active subscriptions
 * @complexity O(1) - aggregate count query with filter
 */
export async function getActiveSubscriptionCount(db: DbClient): Promise<number> {
  const result = await db.queryOne<{ count: number }>(
    selectCount(PUSH_SUBSCRIPTIONS_TABLE).where(eq('is_active', true)).toSql(),
  );
  return result?.count ?? 0;
}
