// main/server/core/src/compliance/data-export/routes.ts
/**
 * Data Export Routes
 *
 * Route definitions for the data export module.
 * Uses the generic router pattern for DRY registration.
 *
 * User routes: request export and check status
 */

import {
  createRouteMap,
  protectedRoute,
  type RouteDefinition,
  type RouteHandler,
  type RouteMap,
  type RouteOpenApiMeta,
  type HttpReply,
  type HttpRequest,
} from '@bslt/server-system/http';
import { requestDataExportBodySchema } from '@bslt/shared/core/compliance';

import { handleDownloadExport, handleGetExportStatus, handleRequestExport } from './handlers';

import type { DataExportAppContext } from './types';

// ============================================================================
// Route Helper
// ============================================================================

/**
 * Helper that wraps protectedRoute for user routes.
 */
function userRoute(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  handler: (
    ctx: DataExportAppContext,
    body: unknown,
    request: HttpRequest,
    reply: HttpReply,
  ) => Promise<unknown>,
  openapi?: RouteOpenApiMeta,
): RouteDefinition {
  return protectedRoute(method, handler as RouteHandler, 'user', undefined, openapi);
}

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Data export module route map.
 *
 * User routes (role: 'user'):
 * - users/me/export (POST) -- request a data export
 * - users/me/export/:id/status (GET) -- check export status
 */
export const dataExportRoutes: RouteMap = createRouteMap([
  // Request a data export
  [
    'users/me/export',
    protectedRoute(
      'POST',
      handleRequestExport as RouteHandler,
      'user',
      requestDataExportBodySchema,
      {
        summary: 'Request data export',
        tags: ['Data Export'],
      },
    ),
  ],

  // Check export status
  [
    'users/me/export/:id/status',
    userRoute('GET', handleGetExportStatus, {
      summary: 'Get export status',
      tags: ['Data Export'],
    }),
  ],

  // Download a completed export
  [
    'users/me/export/:id/download',
    userRoute('GET', handleDownloadExport, {
      summary: 'Download a completed data export',
      tags: ['Data Export'],
    }),
  ],
]);
