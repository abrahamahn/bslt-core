// main/shared/src/contracts/contract.compliance.ts
/**
 * Compliance Contracts
 *
 * API contract definitions for legal documents, consent management, and
 * user data export requests.
 * @module Contracts/Compliance
 */

import {
  createLegalDocumentSchema,
  legalDocumentSchema,
  requestDataExportBodySchema,
  updateConsentPreferencesRequestSchema,
} from '../modules/core';
import { errorResponseSchema, successResponseSchema } from '../modules/system';
import { createSchema, parseBoolean, parseNullable, parseNumber, parseString } from '../schema';

import type { Contract } from '../api/api';

// ============================================================================
// Response Schemas
// ============================================================================

const legalDocumentsResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const documents = obj['documents'];
  if (!Array.isArray(documents)) throw new Error('documents must be an array');

  return {
    documents: documents.map((item) => legalDocumentSchema.parse(item)),
  };
});

const legalDocumentResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    document: legalDocumentSchema.parse(obj['document']),
  };
});

const userAgreementSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    id: parseString(obj['id'], 'id'),
    userId: parseString(obj['userId'], 'userId'),
    documentId: parseString(obj['documentId'], 'documentId'),
    agreedAt: parseString(obj['agreedAt'], 'agreedAt'),
    ipAddress: parseNullable(obj['ipAddress'], (value) => parseString(value, 'ipAddress')),
  };
});

const userAgreementsResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const agreements = obj['agreements'];
  if (!Array.isArray(agreements)) throw new Error('agreements must be an array');

  return {
    agreements: agreements.map((item) => userAgreementSchema.parse(item)),
  };
});

const consentPreferencesPayloadSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const rawPreferences = obj['preferences'];
  if (
    rawPreferences === null ||
    typeof rawPreferences !== 'object' ||
    Array.isArray(rawPreferences)
  ) {
    throw new Error('preferences must be an object');
  }

  const preferences: Record<string, boolean | null> = {};
  for (const [key, value] of Object.entries(rawPreferences)) {
    preferences[key] = value === null ? null : parseBoolean(value, `preferences.${key}`);
  }

  return { preferences };
});

const consentPreferencesUpdateResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    ...consentPreferencesPayloadSchema.parse(data),
    updated: parseNumber(obj['updated'], 'updated', { int: true, min: 0 }),
  };
});

const dataExportRequestWireSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    id: parseString(obj['id'], 'id'),
    userId: parseString(obj['userId'], 'userId'),
    type: parseString(obj['type'], 'type'),
    status: parseString(obj['status'], 'status'),
    format: parseString(obj['format'], 'format'),
    downloadUrl: parseNullable(obj['downloadUrl'], (value) => parseString(value, 'downloadUrl')),
    expiresAt: parseNullable(obj['expiresAt'], (value) => parseString(value, 'expiresAt')),
    completedAt: parseNullable(obj['completedAt'], (value) => parseString(value, 'completedAt')),
    errorMessage: parseNullable(obj['errorMessage'], (value) => parseString(value, 'errorMessage')),
    createdAt: parseString(obj['createdAt'], 'createdAt'),
  };
});

const dataExportRequestResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    exportRequest: dataExportRequestWireSchema.parse(obj['exportRequest']),
  };
});

const dataExportDownloadResponseSchema = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const exportData = obj['export'];
  if (exportData === null || typeof exportData !== 'object' || Array.isArray(exportData)) {
    throw new Error('export must be an object');
  }
  // The export payload aggregates every user-data category; the server owns its
  // exact shape, so the contract keeps it as an opaque record.
  return { export: exportData as Record<string, unknown> };
});

// ============================================================================
// Contract Definition
// ============================================================================

export const complianceContract = {
  getCurrentLegal: {
    method: 'GET' as const,
    path: '/api/legal/current',
    responses: {
      200: successResponseSchema(legalDocumentsResponseSchema),
      500: errorResponseSchema,
    },
    summary: 'Get current legal documents',
  },

  getUserAgreements: {
    method: 'GET' as const,
    path: '/api/users/me/agreements',
    responses: {
      200: successResponseSchema(userAgreementsResponseSchema),
      401: errorResponseSchema,
    },
    summary: 'Get legal agreements for the authenticated user',
  },

  publishLegal: {
    method: 'POST' as const,
    path: '/api/admin/legal/publish',
    body: createLegalDocumentSchema,
    responses: {
      200: successResponseSchema(legalDocumentResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      403: errorResponseSchema,
      409: errorResponseSchema,
    },
    summary: 'Publish a legal document',
  },

  getConsentPreferences: {
    method: 'GET' as const,
    path: '/api/users/me/consent',
    responses: {
      200: successResponseSchema(consentPreferencesPayloadSchema),
      401: errorResponseSchema,
    },
    summary: 'Get current user consent preferences',
  },

  updateConsentPreferences: {
    method: 'PATCH' as const,
    path: '/api/users/me/consent/update',
    body: updateConsentPreferencesRequestSchema,
    responses: {
      200: successResponseSchema(consentPreferencesUpdateResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
    },
    summary: 'Update user consent preferences',
  },

  requestDataExport: {
    method: 'POST' as const,
    path: '/api/users/me/export',
    body: requestDataExportBodySchema,
    responses: {
      200: successResponseSchema(dataExportRequestResponseSchema),
      401: errorResponseSchema,
      409: errorResponseSchema,
    },
    summary: 'Request a GDPR data export',
  },

  getDataExportStatus: {
    method: 'GET' as const,
    path: '/api/users/me/export/:id/status',
    responses: {
      200: successResponseSchema(dataExportRequestResponseSchema),
      401: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Check data export request status',
  },

  downloadDataExport: {
    method: 'GET' as const,
    path: '/api/users/me/export/:id/download',
    responses: {
      200: successResponseSchema(dataExportDownloadResponseSchema),
      400: errorResponseSchema,
      401: errorResponseSchema,
      404: errorResponseSchema,
    },
    summary: 'Download a completed data export',
  },
} satisfies Contract;
