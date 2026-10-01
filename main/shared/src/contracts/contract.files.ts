// main/shared/src/contracts/contract.files.ts
/**
 * Files Contracts
 *
 * API contract definitions for file upload and management.
 * Actual multipart parsing happens server-side before schema validation.
 * @module Contracts/Files
 */

import {
  fileDownloadResponseSchema,
  fileDeleteResponseSchema,
  filesListResponseSchema,
  fileUploadRequestSchema,
  fileUploadResponseSchema,
} from '../modules/storage';
import { emptyBodySchema, errorResponseSchema } from '../modules/system';
import { uuidSchema } from '../schema';

import type { Contract } from '../api/api';

// ============================================================================
// Contract Definition
// ============================================================================

export const filesContract = {
  upload: {
    method: 'POST' as const,
    path: '/api/files/upload',
    body: fileUploadRequestSchema,
    responses: {
      201: fileUploadResponseSchema,
      400: errorResponseSchema,
      401: errorResponseSchema,
      413: errorResponseSchema,
    },
    summary: 'Upload a file (multipart form data)',
  },

  list: {
    method: 'GET' as const,
    path: '/api/files',
    responses: {
      200: filesListResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'List uploaded files',
  },

  get: {
    method: 'GET' as const,
    path: '/api/files/:id',
    pathParams: { id: uuidSchema },
    responses: {
      200: fileUploadResponseSchema,
      401: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get file metadata by ID',
  },

  delete: {
    method: 'POST' as const,
    path: '/api/files/:id/delete',
    pathParams: { id: uuidSchema },
    body: emptyBodySchema,
    responses: {
      200: fileDeleteResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Delete a file',
  },

  download: {
    method: 'GET' as const,
    path: '/api/files/:id/download',
    pathParams: { id: uuidSchema },
    responses: {
      200: fileDownloadResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Get a signed file download URL',
  },
} satisfies Contract;
