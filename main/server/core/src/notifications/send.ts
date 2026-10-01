// main/server/core/src/notifications/send.ts
/**
 * Notification send pipeline.
 *
 * Business logic for resolving send targets and delivering notifications
 * to the in-app feed. Browser push delivery has been removed (web-push
 * package removed), so all sends land in the in-app notification feed.
 */

import { randomUUID } from 'node:crypto';

import { HTTP_STATUS } from '@bslt/shared/constants';

import { publishNotificationCreated } from './publish';

import type { NotificationModuleDeps } from './types';
import type {
  BatchSendResult,
  NotificationLevel,
  SendNotificationRequest,
  SendNotificationResponse,
  SendResult,
} from '@bslt/shared/comms/notifications';

const BROADCAST_PAGE_SIZE = 500;

/** Map a send request's priority/type to an in-app notification level. */
export function mapNotificationLevel(request: SendNotificationRequest): NotificationLevel {
  if (request.priority === 'urgent') {
    return 'error';
  }
  if (request.priority === 'high' || request.type === 'security') {
    return 'warning';
  }
  return 'info';
}

/** Build the structured data payload stored with an in-app notification. */
export function buildNotificationData(request: SendNotificationRequest): Record<string, unknown> {
  return {
    notificationType: request.type,
    priority: request.priority ?? 'normal',
    topic: request.topic,
    ttl: request.ttl,
    url: request.payload.url,
    payload: request.payload.data ?? {},
  };
}

export function dedupeUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds)];
}

/**
 * Resolve the target user IDs for a send request.
 * Empty `userIds` are treated as a broadcast to all active users.
 */
export async function resolveTargetUserIds(
  ctx: NotificationModuleDeps,
  request: SendNotificationRequest,
): Promise<string[]> {
  if (request.userIds !== undefined && request.userIds.length > 0) {
    return dedupeUserIds(request.userIds);
  }

  const userIds: string[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const result = await ctx.repos.users.listWithFilters({
      page,
      limit: BROADCAST_PAGE_SIZE,
      status: 'active',
      sortBy: 'created_at',
      sortOrder: 'asc',
    });

    userIds.push(...result.data.map((user) => user.id));
    hasNext = result.hasNext;
    page += 1;
  }

  return dedupeUserIds(userIds);
}

/** Deliver a single notification to a user's in-app feed. */
export async function createInAppNotification(
  ctx: NotificationModuleDeps,
  userId: string,
  request: SendNotificationRequest,
): Promise<SendResult> {
  try {
    const notification = await ctx.repos.notifications.create({
      userId,
      type: mapNotificationLevel(request),
      title: request.payload.title,
      message: request.payload.body,
      data: buildNotificationData(request),
      isRead: false,
    });

    // Realtime: tell the recipient's own channel that their feed changed.
    // Derived from the RECIPIENT, never from a caller-supplied value — this is
    // the whole reason the channel is safe to subscribe to.
    publishNotificationCreated(ctx.pubsub, userId);

    return {
      success: true,
      subscriptionId: notification.id,
    };
  } catch (error) {
    ctx.log.error(
      { err: error as Error, handler: 'createInAppNotification', userId },
      'Failed to create in-app notification',
    );
    return {
      success: false,
      subscriptionId: `in-app:${userId}`,
      error: error instanceof Error ? error.message : 'Failed to create in-app notification',
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    };
  }
}

/** Aggregate per-user send results into the batch response shape. */
export function buildSendResponse(results: SendResult[]): SendNotificationResponse {
  const result: BatchSendResult = {
    total: results.length,
    successful: results.filter((item) => item.success).length,
    failed: results.filter((item) => !item.success).length,
    results,
    expiredSubscriptions: [],
  };

  return {
    messageId: randomUUID(),
    result,
  };
}
