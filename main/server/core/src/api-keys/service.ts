// main/server/core/src/api-keys/service.ts
/**
 * API Keys service.
 *
 * Owns key generation (plaintext shown once, only the SHA-256 hash is stored),
 * owner-scoped listing/creation/revocation, and the authentication resolver the
 * auth middleware uses to turn a presented key into a user identity.
 */

import { randomBytes } from 'node:crypto';

import { UUID_REGEX } from '@bslt/shared/constants';

import { hashToken } from '../auth/utils/crypto';

import type { ApiKeyRepository, ApiKeyRecord, UserRepository } from '@bslt/db';
import type { ApiKey, CreateApiKeyRequest, CreatedApiKey } from '@bslt/shared/core/api-keys';
import type { AppRole } from '@bslt/shared/core/auth';

/**
 * Prefix for issued keys. A `bslt_` Bearer token is what the auth middleware
 * uses to distinguish an API key from a JWT before doing a DB lookup. Rename it
 * in your fork to match your product's key branding.
 */
export const API_KEY_TOKEN_PREFIX = 'bslt_';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Identity resolved from a valid API key — shaped to seed a JWT TokenPayload.
 * Carries the user's liveness fields so the auth middleware can seed its
 * TTL cache instead of fetching the user a second time.
 */
export interface ApiKeyIdentity {
  readonly userId: string;
  readonly email: string;
  readonly role: AppRole;
  readonly tokenVersion: number;
  readonly lockedUntil: Date | null;
  readonly lockReason: string | null;
}

interface GeneratedKey {
  readonly token: string;
  readonly tokenHash: string;
  readonly keyPrefix: string;
  readonly last4: string;
}

/** Generate a fresh `bslt_<random>` key plus its stored projection. */
export function generateApiKey(): GeneratedKey {
  const token = `${API_KEY_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  return {
    token,
    tokenHash: hashToken(token),
    keyPrefix: token.slice(0, API_KEY_TOKEN_PREFIX.length + 6),
    last4: token.slice(-4),
  };
}

function toApiKey(record: ApiKeyRecord): ApiKey {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    last4: record.last4,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listApiKeys(ownerId: string, repo: ApiKeyRepository): Promise<ApiKey[]> {
  const records = await repo.listByOwner(ownerId);
  return records.map(toApiKey);
}

export async function createApiKey(
  ownerId: string,
  input: CreateApiKeyRequest,
  repo: ApiKeyRepository,
): Promise<CreatedApiKey> {
  const generated = generateApiKey();
  const expiresAt =
    input.expiresInDays === undefined || input.expiresInDays === null
      ? null
      : new Date(Date.now() + input.expiresInDays * MS_PER_DAY);

  const record = await repo.create({
    userId: ownerId,
    name: input.name,
    tokenHash: generated.tokenHash,
    keyPrefix: generated.keyPrefix,
    last4: generated.last4,
    expiresAt,
  });

  return { ...toApiKey(record), token: generated.token };
}

export async function deleteApiKey(
  ownerId: string,
  id: string,
  repo: ApiKeyRepository,
): Promise<ApiKey | null> {
  // A non-UUID id can never match a row; short-circuit to "not found" instead
  // of letting Postgres throw on the uuid cast (22P02 → surfaced as a 500).
  if (!UUID_REGEX.test(id)) return null;
  const record = await repo.deleteForOwner(ownerId, id);
  return record !== null ? toApiKey(record) : null;
}

/**
 * Resolve a presented bearer token to a user identity, or null if it is not a
 * valid, unexpired API key. Best-effort updates `last_used_at`. The caller
 * (auth middleware) is responsible for the live suspended-account check.
 */
export async function authenticateApiKey(
  token: string,
  repos: { readonly apiKeys: ApiKeyRepository; readonly users: UserRepository },
): Promise<ApiKeyIdentity | null> {
  if (!token.startsWith(API_KEY_TOKEN_PREFIX)) return null;

  const record = await repos.apiKeys.findAuthRecordByTokenHash(hashToken(token));
  if (record === null) return null;
  if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) return null;

  const user = await repos.users.findById(record.userId);
  if (user === null) return null;

  // Fire-and-forget: a failed usage stamp must never block authentication.
  void repos.apiKeys.touchLastUsed(record.id).catch(() => undefined);

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion,
    lockedUntil: user.lockedUntil,
    lockReason: user.lockReason,
  };
}
