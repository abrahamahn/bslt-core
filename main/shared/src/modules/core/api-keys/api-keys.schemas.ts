// main/shared/src/modules/core/api-keys/api-keys.schemas.ts
/**
 * API Keys — shared contract schemas.
 *
 * User-owned API keys for programmatic access. The plaintext `token` is present
 * only on the create response (shown to the user exactly once); every other
 * shape carries the non-secret `keyPrefix`/`last4` used to render a masked label.
 */

import {
  createArraySchema,
  createSchema,
  isoDateTimeSchema,
  parseNullable,
  parseNumber,
  parseObject,
  parseOptional,
  parseString,
  uuidSchema,
} from '../../../schema';

import type { Schema } from '../../../schema';

/** Maximum lifetime a caller may request for a new key (10 years). */
export const API_KEY_MAX_EXPIRY_DAYS = 3650;

export interface ApiKey {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly last4: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Returned once at creation time — includes the plaintext `token`. */
export interface CreatedApiKey extends ApiKey {
  readonly token: string;
}

export interface CreateApiKeyRequest {
  readonly name: string;
  /** Days until the key expires; omit or null for a non-expiring key. */
  readonly expiresInDays?: number | null;
}

export interface ApiKeysListResponse {
  readonly keys: readonly ApiKey[];
}

export interface CreateApiKeyResponse {
  readonly key: CreatedApiKey;
}

export interface DeleteApiKeyResponse {
  readonly id: string;
}

function parseName(data: unknown): string {
  const name = parseString(data, 'name').trim();
  if (name.length === 0) throw new Error('name is required');
  if (name.length > 100) throw new Error('name must be at most 100 characters');
  return name;
}

function parseApiKeyFields(obj: Record<string, unknown>): ApiKey {
  return {
    id: uuidSchema.parse(obj['id']),
    name: parseName(obj['name']),
    keyPrefix: parseString(obj['keyPrefix'], 'keyPrefix'),
    last4: parseString(obj['last4'], 'last4'),
    lastUsedAt: parseNullable(obj['lastUsedAt'], (v) => isoDateTimeSchema.parse(v)),
    expiresAt: parseNullable(obj['expiresAt'], (v) => isoDateTimeSchema.parse(v)),
    createdAt: isoDateTimeSchema.parse(obj['createdAt']),
    updatedAt: isoDateTimeSchema.parse(obj['updatedAt']),
  };
}

export const createApiKeyRequestSchema: Schema<CreateApiKeyRequest> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'CreateApiKeyRequest');
    const expiresInDays = parseOptional(obj['expiresInDays'], (value) =>
      value === null
        ? null
        : parseNumber(value, 'expiresInDays', { int: true, min: 1, max: API_KEY_MAX_EXPIRY_DAYS }),
    );
    return {
      name: parseName(obj['name']),
      ...(expiresInDays !== undefined ? { expiresInDays } : {}),
    };
  },
);

export const apiKeySchema: Schema<ApiKey> = createSchema((data: unknown) =>
  parseApiKeyFields(parseObject(data, 'ApiKey')),
);

export const createdApiKeySchema: Schema<CreatedApiKey> = createSchema((data: unknown) => {
  const obj = parseObject(data, 'CreatedApiKey');
  return {
    ...parseApiKeyFields(obj),
    token: parseString(obj['token'], 'token'),
  };
});

export const apiKeysListResponseSchema: Schema<ApiKeysListResponse> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'ApiKeysListResponse');
    return {
      keys: createArraySchema((item: unknown) => apiKeySchema.parse(item)).parse(obj['keys']),
    };
  },
);

export const createApiKeyResponseSchema: Schema<CreateApiKeyResponse> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'CreateApiKeyResponse');
    return {
      key: createdApiKeySchema.parse(obj['key']),
    };
  },
);

export const deleteApiKeyResponseSchema: Schema<DeleteApiKeyResponse> = createSchema(
  (data: unknown) => {
    const obj = parseObject(data, 'DeleteApiKeyResponse');
    return {
      id: uuidSchema.parse(obj['id']),
    };
  },
);
