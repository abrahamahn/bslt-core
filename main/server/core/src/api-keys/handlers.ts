// main/server/core/src/api-keys/handlers.ts
/**
 * API Keys HTTP handlers.
 *
 * Thin layer: resolve the authenticated user, call the service, map the result
 * to a contract response. Owner isolation lives in the service/repository.
 */

import { getAuthenticatedUser } from '@bslt/server-system/http';
import { HTTP_STATUS } from '@bslt/shared/constants';

import { createApiKey, deleteApiKey, listApiKeys } from './service';

import type { ApiKeysAppContext } from './types';
import type {
  ApiKeysListResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DeleteApiKeyResponse,
} from '@bslt/shared/core/api-keys';
import type { HttpReply, HttpRequest } from '@bslt/shared/system';

type ErrorBody = { readonly message: string };

function getId(request: HttpRequest): string {
  const params = request.params as { id?: unknown };
  return typeof params.id === 'string' ? params.id : '';
}

function unauthorized(): { status: 401; body: ErrorBody } {
  return { status: HTTP_STATUS.UNAUTHORIZED, body: { message: 'Unauthorized' } };
}

function notFound(): { status: 404; body: ErrorBody } {
  return { status: HTTP_STATUS.NOT_FOUND, body: { message: 'API key not found' } };
}

export async function handleListApiKeys(
  ctx: ApiKeysAppContext,
  _body: unknown,
  request: HttpRequest,
  _reply: HttpReply,
): Promise<{ status: 200; body: ApiKeysListResponse } | { status: 401; body: ErrorBody }> {
  const user = getAuthenticatedUser(request);
  if (user === undefined) return unauthorized();

  return {
    status: HTTP_STATUS.OK,
    body: { keys: await listApiKeys(user.userId, ctx.repos.apiKeys) },
  };
}

export async function handleCreateApiKey(
  ctx: ApiKeysAppContext,
  body: unknown,
  request: HttpRequest,
  _reply: HttpReply,
): Promise<
  | { status: 200; body: CreateApiKeyResponse }
  | { status: 401; body: ErrorBody }
  | { status: 500; body: ErrorBody }
> {
  const user = getAuthenticatedUser(request);
  if (user === undefined) return unauthorized();

  try {
    const key = await createApiKey(user.userId, body as CreateApiKeyRequest, ctx.repos.apiKeys);
    return { status: HTTP_STATUS.OK, body: { key } };
  } catch (error) {
    ctx.log.error(error instanceof Error ? error : new Error(String(error)));
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to create API key' },
    };
  }
}

export async function handleDeleteApiKey(
  ctx: ApiKeysAppContext,
  _body: unknown,
  request: HttpRequest,
  _reply: HttpReply,
): Promise<
  | { status: 200; body: DeleteApiKeyResponse }
  | { status: 401; body: ErrorBody }
  | { status: 404; body: ErrorBody }
  | { status: 500; body: ErrorBody }
> {
  const user = getAuthenticatedUser(request);
  if (user === undefined) return unauthorized();

  try {
    const key = await deleteApiKey(user.userId, getId(request), ctx.repos.apiKeys);
    if (key === null) return notFound();
    return { status: HTTP_STATUS.OK, body: { id: key.id } };
  } catch (error) {
    ctx.log.error(error instanceof Error ? error : new Error(String(error)));
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { message: 'Failed to delete API key' },
    };
  }
}
