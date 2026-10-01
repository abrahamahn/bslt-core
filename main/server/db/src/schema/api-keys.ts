// main/server/db/src/schema/api-keys.ts
/**
 * API Keys Schema Types
 *
 * TypeScript interfaces for the user-owned api_keys table.
 * Maps to migration 0909_api_keys.sql.
 *
 * The plaintext key is never stored: only `tokenHash` (for lookup) plus the
 * non-secret `keyPrefix`/`last4` used to render a masked label in the UI.
 */

export const API_KEYS_TABLE = 'api_keys';

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  last4: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewApiKeyRecord {
  id?: string;
  userId: string;
  name: string;
  tokenHash: string;
  keyPrefix: string;
  last4: string;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Minimal projection used to authenticate an incoming key (never leaves the server). */
export interface ApiKeyAuthRecord {
  id: string;
  userId: string;
  expiresAt: Date | null;
}

/**
 * Column map for `toCamelCase`/`toSnakeCase`. `token_hash` is deliberately
 * excluded so the secret hash never round-trips into an `ApiKeyRecord`.
 */
export const API_KEY_COLUMNS = {
  id: 'id',
  userId: 'user_id',
  name: 'name',
  keyPrefix: 'key_prefix',
  last4: 'last4',
  lastUsedAt: 'last_used_at',
  expiresAt: 'expires_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
} as const;
