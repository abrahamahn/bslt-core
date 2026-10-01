// main/server/core/src/api-keys/routes.ts
/**
 * API Keys routes — user-scoped management of personal access keys.
 */

import {
  createRouteMap,
  createScopedRouteHelpers,
  type HandlerContext,
  type RouteMap,
} from '@bslt/server-system/http';
import { createApiKeyRequestSchema } from '@bslt/shared/core/api-keys';
import { emptyBodySchema } from '@bslt/shared/system';

import { handleCreateApiKey, handleDeleteApiKey, handleListApiKeys } from './handlers';

import type { ApiKeysAppContext } from './types';

const { protectedRoute: apiKeysProtectedRoute } = createScopedRouteHelpers<ApiKeysAppContext>(
  (ctx: HandlerContext) => ctx as ApiKeysAppContext,
);

export const apiKeysRoutes: RouteMap = createRouteMap([
  [
    'api-keys',
    apiKeysProtectedRoute('GET', handleListApiKeys, 'user', undefined, {
      summary: 'List API keys',
      tags: ['API Keys'],
    }),
  ],
  [
    'api-keys/create',
    apiKeysProtectedRoute('POST', handleCreateApiKey, 'user', createApiKeyRequestSchema, {
      summary: 'Create API key',
      tags: ['API Keys'],
    }),
  ],
  [
    'api-keys/:id/delete',
    apiKeysProtectedRoute('POST', handleDeleteApiKey, 'user', emptyBodySchema, {
      summary: 'Revoke API key',
      tags: ['API Keys'],
    }),
  ],
]);
