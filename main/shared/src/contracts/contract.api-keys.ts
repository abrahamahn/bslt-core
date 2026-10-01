// main/shared/src/contracts/contract.api-keys.ts
/**
 * API Keys Contracts
 *
 * HTTP contract for user-owned API key management.
 */

import {
  apiKeysListResponseSchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  deleteApiKeyResponseSchema,
} from '../modules/core/api-keys';
import { emptyBodySchema, errorResponseSchema } from '../modules/system';
import { uuidSchema } from '../schema';

import type { Contract } from '../api/api';

export const apiKeysContract = {
  list: {
    method: 'GET' as const,
    path: '/api/api-keys',
    responses: {
      200: apiKeysListResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'List API keys for the authenticated user',
  },

  create: {
    method: 'POST' as const,
    path: '/api/api-keys/create',
    body: createApiKeyRequestSchema,
    responses: {
      200: createApiKeyResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'Create an API key (the plaintext token is returned once)',
  },

  delete: {
    method: 'POST' as const,
    path: '/api/api-keys/:id/delete',
    pathParams: { id: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: deleteApiKeyResponseSchema,
      401: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Revoke an API key',
  },
} satisfies Contract;
