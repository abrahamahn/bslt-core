// main/server/db/src/repositories/support/support.ts
/**
 * Support Requests Repository
 *
 * Data access for the support_requests table. Writes are public (anonymous
 * submissions allowed); reads/status changes are admin-only at the route layer.
 */

import { eq, insert, select, update } from '../../builder/index';
import {
  SUPPORT_REQUESTS_TABLE,
  SUPPORT_REQUEST_COLUMNS,
  type NewSupportRequestRecord,
  type SupportRequestRecord,
  type SupportRequestStatus,
} from '../../schema/index';
import { toCamelCase, toSnakeCase } from '../../utils';

import type { RawDb } from '../../client';

export interface ListSupportRequestsOptions {
  status?: SupportRequestStatus;
  limit?: number;
}

export interface SupportRequestRepository {
  create(data: NewSupportRequestRecord): Promise<SupportRequestRecord>;
  list(options?: ListSupportRequestsOptions): Promise<SupportRequestRecord[]>;
  setStatus(id: string, status: SupportRequestStatus): Promise<SupportRequestRecord | null>;
}

function transform(row: Record<string, unknown>): SupportRequestRecord {
  return toCamelCase<SupportRequestRecord>(row, SUPPORT_REQUEST_COLUMNS);
}

export function createSupportRequestRepository(db: RawDb): SupportRequestRepository {
  return {
    async create(data: NewSupportRequestRecord): Promise<SupportRequestRecord> {
      const snakeData = toSnakeCase(data, SUPPORT_REQUEST_COLUMNS);
      const result = await db.queryOne(
        insert(SUPPORT_REQUESTS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create support request');
      }
      return transform(result);
    },

    async list(options: ListSupportRequestsOptions = {}): Promise<SupportRequestRecord[]> {
      let query = select(SUPPORT_REQUESTS_TABLE);
      if (options.status !== undefined) {
        query = query.where(eq('status', options.status));
      }
      query = query.orderBy('created_at', 'desc').limit(options.limit ?? 100);
      const results = await db.query(query.toSql());
      return results.map(transform);
    },

    async setStatus(
      id: string,
      status: SupportRequestStatus,
    ): Promise<SupportRequestRecord | null> {
      const result = await db.queryOne(
        update(SUPPORT_REQUESTS_TABLE)
          .set(toSnakeCase({ status, updatedAt: new Date() }, SUPPORT_REQUEST_COLUMNS))
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transform(result) : null;
    },
  };
}
