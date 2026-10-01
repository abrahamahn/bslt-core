// main/server/db/src/repositories/api-keys/api-keys.ts
/**
 * API Keys Repository
 *
 * Data access for the user-owned api_keys table. Owner isolation is enforced
 * both here (explicit `user_id` predicates) and by row-level security.
 *
 * The stored `token_hash` is write-only from this module's perspective: it is
 * matched on `findAuthRecordByTokenHash` but never projected into an
 * `ApiKeyRecord`.
 */

import { and, deleteFrom, eq, insert, select, update } from '../../builder/index';
import {
  API_KEYS_TABLE,
  API_KEY_COLUMNS,
  type ApiKeyAuthRecord,
  type ApiKeyRecord,
  type NewApiKeyRecord,
} from '../../schema/index';
import { toSnakeCase } from '../../utils';

import type { RawDb } from '../../client';

export interface ApiKeyRepository {
  listByOwner(ownerId: string): Promise<ApiKeyRecord[]>;
  create(data: NewApiKeyRecord): Promise<ApiKeyRecord>;
  deleteForOwner(ownerId: string, id: string): Promise<ApiKeyRecord | null>;
  /** Authentication lookup — unscoped by owner, matched on the secret hash only. */
  findAuthRecordByTokenHash(tokenHash: string): Promise<ApiKeyAuthRecord | null>;
  touchLastUsed(id: string): Promise<void>;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

/** Build an ApiKeyRecord explicitly so the secret `token_hash` can never leak. */
function transformApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    name: String(row['name']),
    keyPrefix: String(row['key_prefix']),
    last4: String(row['last4']),
    lastUsedAt: toNullableDate(row['last_used_at']),
    expiresAt: toNullableDate(row['expires_at']),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

export function createApiKeyRepository(db: RawDb): ApiKeyRepository {
  return {
    async listByOwner(ownerId: string): Promise<ApiKeyRecord[]> {
      const results = await db.query(
        select(API_KEYS_TABLE).where(eq('user_id', ownerId)).orderBy('created_at', 'desc').toSql(),
      );
      return results.map(transformApiKey);
    },

    async create(data: NewApiKeyRecord): Promise<ApiKeyRecord> {
      const snakeData = toSnakeCase(data, API_KEY_COLUMNS);
      const result = await db.queryOne(
        insert(API_KEYS_TABLE).values(snakeData).returningAll().toSql(),
      );
      if (result === null) {
        throw new Error('Failed to create API key');
      }
      return transformApiKey(result);
    },

    async deleteForOwner(ownerId: string, id: string): Promise<ApiKeyRecord | null> {
      const result = await db.queryOne(
        deleteFrom(API_KEYS_TABLE)
          .where(and(eq('id', id), eq('user_id', ownerId)))
          .returningAll()
          .toSql(),
      );
      return result !== null ? transformApiKey(result) : null;
    },

    async findAuthRecordByTokenHash(tokenHash: string): Promise<ApiKeyAuthRecord | null> {
      const result = await db.queryOne(
        select(API_KEYS_TABLE).where(eq('token_hash', tokenHash)).limit(1).toSql(),
      );
      if (result === null) return null;
      return {
        id: String(result['id']),
        userId: String(result['user_id']),
        expiresAt: toNullableDate(result['expires_at']),
      };
    },

    async touchLastUsed(id: string): Promise<void> {
      await db.queryOne(
        update(API_KEYS_TABLE)
          .set(toSnakeCase({ lastUsedAt: new Date(), updatedAt: new Date() }, API_KEY_COLUMNS))
          .where(eq('id', id))
          .returningAll()
          .toSql(),
      );
    },
  };
}
