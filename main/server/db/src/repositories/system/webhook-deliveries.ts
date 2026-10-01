// main/server/db/src/repositories/system/webhook-deliveries.ts
/**
 * Webhook Deliveries Repository (Functional)
 *
 * Data access layer for the webhook_deliveries table.
 * Tracks delivery attempts and results for webhook events.
 *
 * @module
 */

import { and, eq, inArray, isNotNull, lte, select, insert, update } from '../../builder/index';
import {
  type NewWebhookDelivery,
  type UpdateWebhookDelivery,
  type WebhookDelivery,
  WEBHOOK_DELIVERY_COLUMNS,
  WEBHOOK_DELIVERIES_TABLE,
} from '../../schema/index';
import { toCamelCase, toSnakeCase } from '../../utils';

import type { RawDb } from '../../client';

// ============================================================================
// Webhook Delivery Repository Interface
// ============================================================================

/**
 * Functional repository for webhook delivery tracking
 */
export interface WebhookDeliveryRepository {
  /**
   * Create a new delivery record
   * @param data - The delivery data to insert
   * @returns The created delivery
   * @throws Error if insert fails
   */
  create(data: NewWebhookDelivery): Promise<WebhookDelivery>;

  /**
   * Find a delivery by its ID
   * @param id - The delivery ID
   * @returns The delivery or null if not found
   */
  findById(id: string): Promise<WebhookDelivery | null>;

  /**
   * Find all deliveries for a webhook
   * @param webhookId - The webhook ID
   * @param limit - Maximum results (default: 100)
   * @returns Array of deliveries, most recent first
   */
  /**
   * Find deliveries for a webhook, newest first.
   *
   * `status` is applied IN SQL, alongside the limit — filtering after the limit
   * in JS searches only the newest `limit` rows, which on a busy webhook
   * reports "no failures" while failures sit just past the bound.
   *
   * @param webhookId - Webhook whose deliveries to list
   * @param limit - Maximum results (default: 100)
   * @param status - Optional delivery status to filter by
   */
  findByWebhookId(webhookId: string, limit?: number, status?: string): Promise<WebhookDelivery[]>;

  /**
   * Find deliveries by status
   * @param status - The delivery status to filter by
   * @param limit - Maximum results (default: 100)
   * @returns Array of deliveries, most recent first
   */
  findByStatus(status: string, limit?: number): Promise<WebhookDelivery[]>;

  /**
   * Find deliveries whose next retry is due (`next_retry_at <= now`) and that
   * are still retryable (status pending/failed). Ordered oldest-due first.
   * @param now - Cutoff time; rows with next_retry_at at or before this are due
   * @param limit - Maximum results (default: 100)
   * @returns Array of due deliveries
   */
  findDueForRetry(now: Date, limit?: number): Promise<WebhookDelivery[]>;

  /**
   * Update a delivery record (e.g., record result or schedule retry)
   * @param id - The delivery ID to update
   * @param data - The fields to update
   * @returns The updated delivery or null if not found
   */
  update(id: string, data: UpdateWebhookDelivery): Promise<WebhookDelivery | null>;
}

// ============================================================================
// Webhook Delivery Repository Implementation
// ============================================================================

/**
 * Transform raw database row to WebhookDelivery type
 * @param row - Raw database row with snake_case keys
 * @returns Typed WebhookDelivery object
 * @complexity O(n) where n is number of columns
 */
function transformDelivery(row: Record<string, unknown>): WebhookDelivery {
  return toCamelCase<WebhookDelivery>(row, WEBHOOK_DELIVERY_COLUMNS);
}

/**
 * Create a webhook delivery repository bound to a database connection
 * @param db - The raw database client
 * @returns WebhookDeliveryRepository implementation
 */
export function createWebhookDeliveryRepository(db: RawDb): WebhookDeliveryRepository {
  return {
    async create(data: NewWebhookDelivery): Promise<WebhookDelivery> {
      const snakeData = toSnakeCase(data, WEBHOOK_DELIVERY_COLUMNS);
      const result = await db.queryOne(
        insert(WEBHOOK_DELIVERIES_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create webhook delivery');
      }
      return transformDelivery(result);
    },

    async findById(id: string): Promise<WebhookDelivery | null> {
      const result = await db.queryOne(
        select(WEBHOOK_DELIVERIES_TABLE).where(eq('id', id)).toSql(),
      );
      return result !== null ? transformDelivery(result) : null;
    },

    async findByWebhookId(
      webhookId: string,
      limit = 100,
      status?: string,
    ): Promise<WebhookDelivery[]> {
      const where =
        status === undefined
          ? eq('webhook_id', webhookId)
          : and(eq('webhook_id', webhookId), eq('status', status));

      const results = await db.query(
        select(WEBHOOK_DELIVERIES_TABLE)
          .where(where)
          .orderBy('created_at', 'desc')
          .limit(limit)
          .toSql(),
      );
      return results.map(transformDelivery);
    },

    async findByStatus(status: string, limit = 100): Promise<WebhookDelivery[]> {
      const results = await db.query(
        select(WEBHOOK_DELIVERIES_TABLE)
          .where(eq('status', status))
          .orderBy('created_at', 'desc')
          .limit(limit)
          .toSql(),
      );
      return results.map(transformDelivery);
    },

    async findDueForRetry(now: Date, limit = 100): Promise<WebhookDelivery[]> {
      const results = await db.query(
        select(WEBHOOK_DELIVERIES_TABLE)
          .where(
            and(
              inArray('status', ['pending', 'failed']),
              isNotNull('next_retry_at'),
              lte('next_retry_at', now),
            ),
          )
          .orderBy('next_retry_at', 'asc')
          .limit(limit)
          .toSql(),
      );
      return results.map(transformDelivery);
    },

    async update(id: string, data: UpdateWebhookDelivery): Promise<WebhookDelivery | null> {
      const snakeData = toSnakeCase(data, WEBHOOK_DELIVERY_COLUMNS);
      const result = await db.queryOne(
        update(WEBHOOK_DELIVERIES_TABLE).set(snakeData).where(eq('id', id)).returningAll().toSql(),
      );
      return result !== null ? transformDelivery(result) : null;
    },
  };
}
