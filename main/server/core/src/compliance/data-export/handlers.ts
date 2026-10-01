// main/server/core/src/compliance/data-export/handlers.ts
/**
 * Data Export Handlers
 *
 * Thin HTTP layer that calls services and formats responses.
 * Framework-agnostic: uses narrow interfaces from types.ts instead
 * of binding to Fastify or any specific HTTP framework.
 */

import { requireAuthenticatedUser } from '@bslt/server-system/http';
import { BadRequestError } from '@bslt/shared/system';

import { record } from '../../audit/service';

import { serializeUserDataExport } from './serialize';
import {
  buildUserDataExport,
  getExportStatus,
  processDataExport,
  requestDataExport,
  toDataExportFormat,
} from './service';

import type { DataExportAppContext, DataExportRequest, UserDataExport } from './types';
import type { AuditRecordParams } from '../../audit/types';
import type { DataExportRequest as DbDataExportRequest } from '@bslt/db/schema';
import type { HttpErrorResponse } from '@bslt/server-system/errors';
import type { HttpReply } from '@bslt/server-system/http';
import type { RequestDataExportBody } from '@bslt/shared/core/compliance';

// ============================================================================
// Response Types
// ============================================================================

interface DataExportRequestResponse {
  id: string;
  userId: string;
  type: string;
  status: string;
  format: string;
  downloadUrl: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a database data export request record for API response.
 * Converts Date objects to ISO strings.
 *
 * @param request - Database data export request record
 * @returns Formatted data export request for API response
 * @complexity O(1)
 */
function formatExportRequest(request: DbDataExportRequest): DataExportRequestResponse {
  return {
    id: request.id,
    userId: request.userId,
    type: request.type,
    status: request.status,
    format: request.format,
    downloadUrl: request.downloadUrl,
    expiresAt: request.expiresAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    errorMessage: request.errorMessage,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * Fire-and-forget an audit event. Silently swallows errors so audit
 * failures never affect data export operations.
 *
 * @param ctx - Application context (must have auditEvents on repos)
 * @param params - Audit event parameters
 * @complexity O(1)
 */
function tryAudit(ctx: DataExportAppContext, params: AuditRecordParams): void {
  const auditEvents = ctx.repos.auditEvents;
  if (auditEvents === undefined) return;
  record({ auditEvents }, params).catch((err: unknown) => {
    ctx.log.warn({ err }, 'Failed to record audit event');
  });
}

// ============================================================================
// User Handlers (Auth Required)
// ============================================================================

/**
 * Request a data export for the current user.
 *
 * Creates a new pending export request. This endpoint should require
 * sudo/elevated authentication in production (via middleware).
 *
 * @param ctx - Application context with data export repositories
 * @param request - HTTP request with authenticated user
 * @returns 201 response with the created export request, or error response
 * @complexity O(n) where n is the number of user's existing requests
 */
export async function handleRequestExport(
  ctx: DataExportAppContext,
  body: unknown,
  request: unknown,
): Promise<{ exportRequest: DataExportRequestResponse } | HttpErrorResponse> {
  const req = request as DataExportRequest;
  const user = requireAuthenticatedUser(req);

  const format = (body as RequestDataExportBody | undefined)?.format ?? 'json';
  const exportRequest = await requestDataExport(ctx.repos.dataExportRequests, user.userId, format);

  // Process the export inline so the user gets a ready download immediately —
  // the starter has no background worker. processDataExport marks the request
  // 'failed' on error, so a thrown error is logged but never blocks the response.
  try {
    await processDataExport(ctx.repos, exportRequest.id);
  } catch (error: unknown) {
    ctx.log.warn(
      { err: error instanceof Error ? error : new Error(String(error)) },
      'Data export processing failed',
    );
  }
  const processed =
    (await ctx.repos.dataExportRequests.findById(exportRequest.id)) ?? exportRequest;

  const headers = req.headers ?? {};
  const userAgentHeader = headers['user-agent'];

  tryAudit(ctx, {
    actorId: user.userId,
    action: 'data_export.requested',
    resource: 'data_export',
    resourceId: processed.id,
    ipAddress: req.requestInfo.ipAddress ?? req.requestInfo.ip,
    userAgent: Array.isArray(userAgentHeader)
      ? (userAgentHeader[0] ?? null)
      : (userAgentHeader ?? null),
  });

  return { exportRequest: formatExportRequest(processed) };
}

/**
 * Get the status of a data export request.
 *
 * Validates that the request belongs to the authenticated user.
 *
 * @param ctx - Application context with data export repositories
 * @param request - HTTP request with authenticated user and params.id
 * @returns 200 response with the export request status, or error response
 * @complexity O(1) database lookup by primary key
 */
export async function handleGetExportStatus(
  ctx: DataExportAppContext,
  _body: unknown,
  request: unknown,
): Promise<{ exportRequest: DataExportRequestResponse } | HttpErrorResponse> {
  const user = requireAuthenticatedUser(request as DataExportRequest);

  const requestId = (request as { params?: { id?: string } }).params?.id ?? '';
  if (requestId === '') {
    throw new BadRequestError('Export request ID is required', 'DATA_EXPORT_ID_REQUIRED');
  }

  const exportRequest = await getExportStatus(ctx.repos.dataExportRequests, requestId, user.userId);

  return { exportRequest: formatExportRequest(exportRequest) };
}

/**
 * Download a completed data export.
 *
 * Verifies the request belongs to the authenticated user and has finished
 * processing, then aggregates and serializes the user's data in the format
 * chosen when the export was requested. JSON is returned as the usual
 * `{ export }` envelope; CSV is streamed as a `text/csv` attachment. The
 * endpoint is auth-protected, so the client fetches it with its bearer token
 * and saves the response as a file (a plain link/window.open cannot send the
 * token).
 *
 * @param ctx - Application context with data export repositories
 * @param request - HTTP request with authenticated user and params.id
 * @param reply - HTTP reply, used to set CSV download headers
 * @returns 200 response with the aggregated user data, or error response
 * @complexity O(n) where n is total records across all data categories
 */
export async function handleDownloadExport(
  ctx: DataExportAppContext,
  _body: unknown,
  request: unknown,
  reply: HttpReply,
): Promise<{ export: UserDataExport } | { status: number; wire: string } | HttpErrorResponse> {
  const req = request as DataExportRequest;
  const user = requireAuthenticatedUser(req);

  const requestId = (request as { params?: { id?: string } }).params?.id ?? '';
  if (requestId === '') {
    throw new BadRequestError('Export request ID is required', 'DATA_EXPORT_ID_REQUIRED');
  }

  // Ownership check — throws DataExportNotFoundError when missing or not the user's.
  const exportRequest = await getExportStatus(ctx.repos.dataExportRequests, requestId, user.userId);
  if (exportRequest.status !== 'completed') {
    throw new BadRequestError('Data export is not ready for download', 'DATA_EXPORT_NOT_READY');
  }
  if (exportRequest.expiresAt !== null && new Date(exportRequest.expiresAt) <= new Date()) {
    throw new BadRequestError(
      'Data export has expired; request a new export',
      'DATA_EXPORT_EXPIRED',
    );
  }

  const format = toDataExportFormat(exportRequest.format);
  const data = await buildUserDataExport(ctx.repos, user.userId, format);

  const headers = req.headers ?? {};
  const userAgentHeader = headers['user-agent'];
  tryAudit(ctx, {
    actorId: user.userId,
    action: 'data_export.downloaded',
    resource: 'data_export',
    resourceId: exportRequest.id,
    ipAddress: req.requestInfo.ipAddress ?? req.requestInfo.ip,
    userAgent: Array.isArray(userAgentHeader)
      ? (userAgentHeader[0] ?? null)
      : (userAgentHeader ?? null),
  });

  if (format === 'csv') {
    const { body, contentType, extension } = serializeUserDataExport(data, 'csv');
    reply.header('Content-Type', contentType);
    reply.header(
      'Content-Disposition',
      `attachment; filename="data-export-${exportRequest.id}.${extension}"`,
    );
    return { status: 200, wire: body };
  }

  return { export: data };
}
