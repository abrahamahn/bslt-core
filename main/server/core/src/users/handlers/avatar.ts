// main/server/core/src/users/handlers/avatar.ts
/**
 * Avatar Service
 *
 * Business logic and HTTP handlers for user avatar management:
 * upload, deletion, and URL resolution with fallback chain.
 *
 * @module handlers/avatar
 */

import { createHash } from 'node:crypto';

import { createHttpErrorResponse } from '@bslt/server-system/errors';
import { requireAuthenticatedUser } from '@bslt/server-system/http';
import {
  ALLOWED_IMAGE_TYPES as ALLOWED_AVATAR_TYPES,
  MAX_IMAGE_SIZE as MAX_AVATAR_SIZE,
  MIME_TO_EXT,
} from '@bslt/shared/constants/media';
import { generateFileId } from '@bslt/shared/media';
import { BadRequestError, NotFoundError } from '@bslt/shared/system';

import { record } from '../../audit/service';
import { CacheKeys } from '../cache';
import { ERROR_MESSAGES } from '../types';

import type { UsersModuleDeps, UsersRequest } from '../types';
import type { Repositories } from '@bslt/db/factory';
import type { HttpRequest, RouteResult } from '@bslt/server-system/http';

/**
 * Storage service interface for file operations.
 * Abstracts over different storage backends (S3, local, etc).
 */
export interface StorageProvider {
  /**
   * Upload a file to storage.
   * @param key - Storage key/path for the file
   * @param buffer - File contents as Buffer
   * @param mimeType - MIME type of the file
   * @returns The storage key where the file was stored
   */
  upload(key: string, buffer: Buffer, mimeType: string): Promise<string>;

  /**
   * Get a signed URL for accessing a stored file.
   * @param key - Storage key/path of the file
   * @returns Signed URL that grants temporary access to the file
   */
  getSignedUrl(key: string): Promise<string>;
}

type UsersHttpRequest = UsersRequest & HttpRequest;

// ============================================================================
// Avatar Fallback Chain
// ============================================================================

/**
 * Get the avatar URL for a user with fallback chain:
 * 1. Custom uploaded avatar (stored in storage)
 * 2. Gravatar (based on email hash)
 * 3. Initials-based avatar (generated from name)
 */
export function getAvatarFallbackUrl(email: string, _firstName: string, _lastName: string): string {
  // Use Gravatar with initials fallback as default
  const gravatarUrl = getGravatarUrl(email, 80, 'blank');
  // If Gravatar returns blank, the UI can fall back to initials
  return gravatarUrl;
}

/**
 * Generate a Gravatar URL from an email address.
 * Uses MD5 hash of the lowercased, trimmed email.
 */
export function getGravatarUrl(
  email: string,
  size = 80,
  defaultImg: 'blank' | 'identicon' | 'mp' | '404' = 'identicon',
): string {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${String(size)}&d=${defaultImg}`;
}

/**
 * Generate an initials-based avatar URL using UI Avatars service.
 */
export function getInitialsAvatarUrl(firstName: string, lastName: string, size = 80): string {
  const name = encodeURIComponent(`${firstName} ${lastName}`.trim());
  return `https://ui-avatars.com/api/?name=${name}&size=${String(size)}&background=random&bold=true`;
}

/**
 * Append a cache-busting query parameter to an avatar URL.
 */
export function cacheBustAvatarUrl(url: string, version: number | Date): string {
  const v = version instanceof Date ? String(version.getTime()) : String(version);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${v}`;
}

/** Storage key prefix for avatar files */
const AVATAR_PATH_PREFIX = 'avatars';

function isAvatarStorageKey(value: string): boolean {
  return value.startsWith(`${AVATAR_PATH_PREFIX}/`);
}

/**
 * Upload user avatar.
 * Validates file type and size, uploads to storage, updates user.
 *
 * @param repos - Repository container
 * @param storage - Storage provider for file upload
 * @param userId - ID of the user uploading an avatar
 * @param file - File data with buffer, mimetype, and size
 * @returns Signed URL to the uploaded avatar
 * @throws NotFoundError if user not found
 * @throws BadRequestError if file type is invalid or file is too large
 * @complexity O(1) - single upload + database update
 */
export async function uploadAvatar(
  repos: Repositories,
  storage: StorageProvider,
  userId: string,
  file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
  },
): Promise<string> {
  const user = await repos.users.findById(userId);

  if (user === null) {
    throw new NotFoundError('User not found');
  }

  // Validate file type
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new BadRequestError(
      `Invalid file type. Allowed types: ${ALLOWED_AVATAR_TYPES.join(', ')}`,
    );
  }

  // Validate file size
  if (file.size > MAX_AVATAR_SIZE) {
    throw new BadRequestError(
      `File too large. Maximum size: ${String(MAX_AVATAR_SIZE / 1024 / 1024)}MB`,
    );
  }

  // Generate storage key
  const extension = MIME_TO_EXT[file.mimetype] ?? 'jpg';
  const fileId = generateFileId();
  const key = `${AVATAR_PATH_PREFIX}/${userId}/${fileId}.${extension}`;

  // Upload to storage
  const storedKey = await storage.upload(key, file.buffer, file.mimetype);

  // Get signed URL for the avatar
  const avatarUrl = await storage.getSignedUrl(storedKey);

  // Update user with new avatar URL (store the key, not the signed URL)
  await repos.users.update(userId, { avatarUrl: storedKey });

  // Fire-and-forget audit logging
  record(
    { auditEvents: repos.auditEvents },
    {
      actorId: userId,
      action: 'user.avatar_uploaded',
      resource: 'user',
      resourceId: userId,
      metadata: { mimeType: file.mimetype },
    },
  ).catch(() => {});


  return avatarUrl;
}

/**
 * Delete user avatar.
 * Clears the avatar URL from the user record.
 * Does not immediately delete from storage (deferred cleanup).
 *
 * @param repos - Repository container
 * @param _storage - Storage provider (reserved for future file deletion)
 * @param userId - ID of the user whose avatar to delete
 * @throws NotFoundError if user not found
 * @complexity O(1) - single database lookup and update
 */
export async function deleteAvatar(
  repos: Repositories,
  _storage: StorageProvider,
  userId: string,
): Promise<void> {
  const user = await repos.users.findById(userId);

  if (user === null) {
    throw new NotFoundError('User not found');
  }

  if (user.avatarUrl === null || user.avatarUrl === '') {
    return; // No avatar to delete
  }

  // Note: We don't delete the file from storage immediately to allow for
  // potential recovery. A cleanup job can remove orphaned files later.

  // Clear avatar URL from user
  await repos.users.update(userId, { avatarUrl: null });

  // Fire-and-forget audit logging
  record(
    { auditEvents: repos.auditEvents },
    {
      actorId: userId,
      action: 'user.avatar_deleted',
      resource: 'user',
      resourceId: userId,
    },
  ).catch(() => {});

}

/**
 * Get avatar URL for a user.
 * Returns signed URL if user has a storage-based avatar, null otherwise.
 *
 * @param repos - Repository container
 * @param storage - Storage provider for signed URL generation
 * @param userId - ID of the user whose avatar URL to get
 * @returns Signed URL string or null if no avatar
 * @complexity O(1) - single database lookup + optional signed URL generation
 */
export async function getAvatarUrl(
  repos: Repositories,
  storage: StorageProvider,
  userId: string,
): Promise<string | null> {
  const user = await repos.users.findById(userId);
  const avatarUrl = user?.avatarUrl;
  if (avatarUrl === null || avatarUrl === undefined || avatarUrl === '') {
    return null;
  }

  // If avatar URL is a storage key (starts with avatars/), generate signed URL
  if (isAvatarStorageKey(avatarUrl)) {
    return storage.getSignedUrl(avatarUrl);
  }

  // Otherwise return as-is (might be an external URL)
  return avatarUrl;
}

// ============================================================================
// HTTP Handlers
// ============================================================================

function createStorageProvider(storage: UsersModuleDeps['storage']): StorageProvider | null {
  if (storage === undefined) {
    return null;
  }

  return {
    upload: (key, buffer, mimeType) => storage.upload(key, buffer, mimeType),
    getSignedUrl: (key) => storage.getSignedUrl(key, 3600),
  };
}

async function invalidateUserCache(
  ctx: UsersModuleDeps,
  userId: string,
  logMessage: string,
): Promise<void> {
  if (ctx.cache === undefined || typeof ctx.cache.delete !== 'function') return;

  await ctx.cache.delete(CacheKeys.user(userId)).catch((cacheError: unknown) => {
    const err = cacheError instanceof Error ? cacheError : new Error(String(cacheError));
    ctx.log.warn({ err }, logMessage);
  });
}

export async function resolveAvatarUrl(
  storageService: UsersModuleDeps['storage'],
  avatarUrl: string | null | undefined,
): Promise<string | null> {
  if (avatarUrl === null || avatarUrl === undefined || avatarUrl === '') {
    return null;
  }

  if (!isAvatarStorageKey(avatarUrl)) {
    return avatarUrl;
  }

  const storage = createStorageProvider(storageService);
  if (storage === null) {
    return null;
  }

  return storage.getSignedUrl(avatarUrl);
}

/**
 * Handle avatar upload.
 * Expects pre-parsed multipart body with buffer/mimetype/size.
 *
 * PUT /api/users/me/avatar
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param body - Parsed multipart file data
 * @param req - Fastify request with authenticated user
 * @returns 200 with avatarUrl, or error response
 * @complexity O(1) - single upload + database update
 */
export async function handleUploadAvatar(
  ctx: UsersModuleDeps,
  body: unknown,
  req: UsersHttpRequest,
): Promise<RouteResult> {
  const user = requireAuthenticatedUser(req);

  try {
    const fileData = body as
      | {
          buffer?: Buffer | Uint8Array;
          mimetype?: string;
          size?: number;
        }
      | null
      | undefined;

    if (fileData?.buffer === undefined || fileData.mimetype === undefined) {
      return createHttpErrorResponse(400, 'No file uploaded');
    }

    const buffer = Buffer.isBuffer(fileData.buffer)
      ? fileData.buffer
      : Buffer.from(fileData.buffer);

    const storage = createStorageProvider(ctx.storage);
    if (storage === null) {
      return createHttpErrorResponse(503, ERROR_MESSAGES.STORAGE_UNAVAILABLE);
    }

    const avatarUrl = await uploadAvatar(ctx.repos, storage, user.userId, {
      buffer,
      mimetype: fileData.mimetype,
      size: fileData.size ?? buffer.length,
    });
    await invalidateUserCache(
      ctx,
      user.userId,
      'Failed to invalidate user profile cache after avatar upload',
    );

    return { avatarUrl };
  } catch (error) {
    if (error instanceof BadRequestError) {
      return createHttpErrorResponse(400, error.message);
    }
    if (error instanceof NotFoundError) {
      return createHttpErrorResponse(404, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to upload avatar',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}

/**
 * Handle avatar deletion.
 *
 * DELETE /api/users/me/avatar
 *
 * @param ctx - Handler context (narrowed to UsersModuleDeps)
 * @param _body - Unused request body
 * @param req - Fastify request with authenticated user
 * @returns 200 on success, or error response
 * @complexity O(1) - single database lookup and update
 */
export async function handleDeleteAvatar(
  ctx: UsersModuleDeps,
  _body: undefined,
  req: UsersHttpRequest,
): Promise<RouteResult> {
  const user = requireAuthenticatedUser(req);

  try {
    const storage = createStorageProvider(ctx.storage);
    if (storage === null) {
      return createHttpErrorResponse(503, ERROR_MESSAGES.STORAGE_UNAVAILABLE);
    }

    await deleteAvatar(ctx.repos, storage, user.userId);
    await invalidateUserCache(
      ctx,
      user.userId,
      'Failed to invalidate user profile cache after avatar delete',
    );
    return { message: 'Avatar deleted' };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return createHttpErrorResponse(404, error.message);
    }
    ctx.log.error(
      error instanceof Error ? error : new Error(String(error)),
      'Failed to delete avatar',
    );
    return createHttpErrorResponse(500, ERROR_MESSAGES.INTERNAL_ERROR);
  }
}
