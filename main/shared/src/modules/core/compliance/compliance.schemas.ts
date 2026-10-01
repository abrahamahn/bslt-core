// main/shared/src/modules/core/compliance/compliance.schemas.ts

/**
 * @file Compliance Schemas
 * @description Schemas for legal documents, user agreements, and consent logs.
 * @module Core/Compliance
 */

import {
  CONSENT_RECORD_TYPES,
  CONSENT_TYPES,
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_STATUSES,
  DATA_EXPORT_TYPES,
  DOCUMENT_TYPES,
  PUBLISHABLE_DOCUMENT_TYPES,
} from '../../../constants/core/compliance';
import {
  coerceDate,
  createEnumSchema,
  createSchema,
  parseBoolean,
  parseNullable,
  parseNullableOptional,
  parseNumber,
  parseOptional,
  parseRecord,
  parseString,
} from '../../../schema';
import { consentRecordIdSchema, legalDocumentIdSchema, userIdSchema } from '../../../schema/ids';

import type { Schema } from '../../../schema';
import type { ConsentRecordId, LegalDocumentId, UserId } from '../../../schema/ids';

// ============================================================================
// Constants
// ============================================================================

// Re-exported, not redeclared: this and `constants/core/compliance` held two
// independent copies of the same literals with no import between them, so the
// only question was when they would drift.
export {
  CONSENT_RECORD_TYPES,
  CONSENT_TYPES,
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_STATUSES,
  DATA_EXPORT_TYPES,
  DOCUMENT_TYPES,
  PUBLISHABLE_DOCUMENT_TYPES,
};

/** Document type union type */
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The DB-published subset — the only types the publish endpoint accepts. */
export type PublishableDocumentType = (typeof PUBLISHABLE_DOCUMENT_TYPES)[number];

/** Data export type union */
export type DataExportType = (typeof DATA_EXPORT_TYPES)[number];

/** Data export status union */
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

/** Data export format union */
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];

/** Consent type union type */
export type ConsentType = (typeof CONSENT_TYPES)[number];

// ============================================================================
// Types
// ============================================================================

/** Full legal document entity */
export interface LegalDocument {
  id: LegalDocumentId;
  type: string;
  title: string;
  content: string;
  version: number;
  effectiveAt: Date;
  createdAt: Date;
}

/** Input for creating a new legal document */
export interface CreateLegalDocument {
  type: string;
  title: string;
  content: string;
  version?: number | undefined;
  effectiveAt: Date;
}

/** Input for updating a legal document */
export interface UpdateLegalDocument {
  title?: string | undefined;
  content?: string | undefined;
  effectiveAt?: Date | undefined;
}

/** Consent record type discriminator */
export type ConsentRecordType = (typeof CONSENT_RECORD_TYPES)[number];

/** Full consent record entity (unified replacement for UserAgreement + ConsentLog) */
export interface ConsentRecord {
  id: ConsentRecordId;
  userId: UserId;
  recordType: ConsentRecordType;
  documentId: LegalDocumentId | null;
  consentType: string | null;
  granted: boolean | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Input for creating a consent record */
export interface CreateConsentRecord {
  userId: UserId;
  recordType: ConsentRecordType;
  documentId?: LegalDocumentId | null | undefined;
  consentType?: string | null | undefined;
  granted?: boolean | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Input for updating current user consent preferences */
export interface UpdateConsentPreferencesRequest {
  analytics?: boolean | undefined;
  marketing_email?: boolean | undefined;
  third_party_sharing?: boolean | undefined;
  profiling?: boolean | undefined;
}

/** Full data export request entity */
export interface DataExportRequest {
  id: string;
  userId: UserId;
  type: DataExportType;
  status: DataExportStatus;
  format: string;
  downloadUrl: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Input for creating a new data export request */
export interface CreateDataExportRequest {
  userId: UserId;
  type: DataExportType;
  format?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Body accepted by the "request a data export" endpoint */
export interface RequestDataExportBody {
  format: DataExportFormat;
}

// ============================================================================
// Legal Document Schemas
// ============================================================================

/**
 * Full legal document schema (matches DB SELECT result).
 */
export const legalDocumentSchema: Schema<LegalDocument> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: legalDocumentIdSchema.parse(obj['id']),
    type: parseString(obj['type'], 'type', { min: 1 }),
    title: parseString(obj['title'], 'title', { min: 1 }),
    content: parseString(obj['content'], 'content', { min: 1 }),
    version: parseNumber(obj['version'], 'version', { int: true, min: 1 }),
    effectiveAt: coerceDate(obj['effectiveAt'], 'effectiveAt'),
    createdAt: coerceDate(obj['createdAt'], 'createdAt'),
  };
});

/**
 * Schema for creating a new legal document.
 */
export const createLegalDocumentSchema: Schema<CreateLegalDocument> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      type: parseString(obj['type'], 'type', { min: 1 }),
      title: parseString(obj['title'], 'title', { min: 1 }),
      content: parseString(obj['content'], 'content', { min: 1 }),
      version: parseOptional(obj['version'], (v) =>
        parseNumber(v, 'version', { int: true, min: 1 }),
      ),
      effectiveAt: coerceDate(obj['effectiveAt'], 'effectiveAt'),
    };
  },
);

/**
 * Schema for updating an existing legal document.
 */
export const updateLegalDocumentSchema: Schema<UpdateLegalDocument> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      title: parseOptional(obj['title'], (v) => parseString(v, 'title', { min: 1 })),
      content: parseOptional(obj['content'], (v) => parseString(v, 'content', { min: 1 })),
      effectiveAt: parseOptional(obj['effectiveAt'], (v) => coerceDate(v, 'effectiveAt')),
    };
  },
);

// ============================================================================
// Consent Record Schemas
// ============================================================================

const consentRecordTypeSchema = createEnumSchema(CONSENT_RECORD_TYPES, 'recordType');

/**
 * Full consent record schema (matches DB SELECT result).
 */
export const consentRecordSchema: Schema<ConsentRecord> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: consentRecordIdSchema.parse(obj['id']),
    userId: userIdSchema.parse(obj['userId']),
    recordType: consentRecordTypeSchema.parse(obj['recordType']),
    documentId: parseNullable(obj['documentId'], (v) => legalDocumentIdSchema.parse(v)),
    consentType: parseNullable(obj['consentType'], (v) =>
      parseString(v, 'consentType', { min: 1 }),
    ),
    granted: parseNullable(obj['granted'], (v) => parseBoolean(v, 'granted')),
    ipAddress: parseNullable(obj['ipAddress'], (v) => parseString(v, 'ipAddress')),
    userAgent: parseNullable(obj['userAgent'], (v) => parseString(v, 'userAgent')),
    metadata: parseRecord(obj['metadata'], 'metadata'),
    createdAt: coerceDate(obj['createdAt'], 'createdAt'),
  };
});

/**
 * Schema for creating a new consent record.
 */
export const createConsentRecordSchema: Schema<CreateConsentRecord> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      userId: userIdSchema.parse(obj['userId']),
      recordType: consentRecordTypeSchema.parse(obj['recordType']),
      documentId: parseNullableOptional(obj['documentId'], (v) => legalDocumentIdSchema.parse(v)),
      consentType: parseNullableOptional(obj['consentType'], (v) =>
        parseString(v, 'consentType', { min: 1 }),
      ),
      granted: parseNullableOptional(obj['granted'], (v) => parseBoolean(v, 'granted')),
      ipAddress: parseNullableOptional(obj['ipAddress'], (v) => parseString(v, 'ipAddress')),
      userAgent: parseNullableOptional(obj['userAgent'], (v) => parseString(v, 'userAgent')),
      metadata: parseOptional(obj['metadata'], (v) => parseRecord(v, 'metadata')),
    };
  },
);

/**
 * Schema for updating consent preferences.
 */
export const updateConsentPreferencesRequestSchema: Schema<UpdateConsentPreferencesRequest> =
  createSchema((data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    const analytics = parseOptional(obj['analytics'], (v) => parseBoolean(v, 'analytics'));
    const marketingEmail = parseOptional(obj['marketing_email'], (v) =>
      parseBoolean(v, 'marketing_email'),
    );
    const thirdPartySharing = parseOptional(obj['third_party_sharing'], (v) =>
      parseBoolean(v, 'third_party_sharing'),
    );
    const profiling = parseOptional(obj['profiling'], (v) => parseBoolean(v, 'profiling'));

    if (
      analytics === undefined &&
      marketingEmail === undefined &&
      thirdPartySharing === undefined &&
      profiling === undefined
    ) {
      throw new Error('At least one consent preference must be specified');
    }

    return {
      analytics,
      marketing_email: marketingEmail,
      third_party_sharing: thirdPartySharing,
      profiling,
    };
  });

// ============================================================================
// Data Export Request Schemas
// ============================================================================

const dataExportTypeSchema = createEnumSchema(DATA_EXPORT_TYPES, 'type');
const dataExportStatusSchema = createEnumSchema(DATA_EXPORT_STATUSES, 'status');
const dataExportFormatSchema = createEnumSchema(DATA_EXPORT_FORMATS, 'format');

/**
 * Body schema for requesting a data export. `format` is optional and defaults
 * to `'json'`, keeping the request backward-compatible with an empty body.
 */
export const requestDataExportBodySchema: Schema<RequestDataExportBody> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const format = parseOptional(obj['format'], (v) => dataExportFormatSchema.parse(v));

    return { format: format ?? 'json' };
  },
);

/**
 * Full data export request schema (matches DB SELECT result).
 */
export const dataExportRequestSchema: Schema<DataExportRequest> = createSchema((data: unknown) => {
  const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  return {
    id: parseString(obj['id'], 'id', { uuid: true }),
    userId: userIdSchema.parse(obj['userId']),
    type: dataExportTypeSchema.parse(obj['type']),
    status: dataExportStatusSchema.parse(obj['status']),
    format: parseString(obj['format'], 'format', { min: 1 }),
    downloadUrl: parseNullable(obj['downloadUrl'], (v) => parseString(v, 'downloadUrl')),
    expiresAt: parseNullable(obj['expiresAt'], (v) => coerceDate(v, 'expiresAt')),
    completedAt: parseNullable(obj['completedAt'], (v) => coerceDate(v, 'completedAt')),
    errorMessage: parseNullable(obj['errorMessage'], (v) => parseString(v, 'errorMessage')),
    metadata: parseRecord(obj['metadata'], 'metadata'),
    createdAt: coerceDate(obj['createdAt'], 'createdAt'),
  };
});

/**
 * Schema for creating a new data export request.
 */
export const createDataExportRequestSchema: Schema<CreateDataExportRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      userId: userIdSchema.parse(obj['userId']),
      type: dataExportTypeSchema.parse(obj['type']),
      format: parseOptional(obj['format'], (v) => parseString(v, 'format', { min: 1 })),
      metadata: parseOptional(obj['metadata'], (v) => parseRecord(v, 'metadata')),
    };
  },
);

// ============================================================================
// Response Schemas (for API contracts)
// ============================================================================

/** Current consent preferences per category */
export interface ConsentPreferencesResponse {
  analytics: boolean;
  marketing_email: boolean;
  third_party_sharing: boolean;
  profiling: boolean;
}

/** Response after requesting a data export */
export interface DataExportRequestedResponse {
  message: string;
  requestId: string;
  estimatedCompletionAt: string;
}

/** Generic compliance action response */
export interface ComplianceActionResponse {
  message: string;
}

export const consentPreferencesResponseSchema: Schema<ConsentPreferencesResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      analytics: parseBoolean(obj['analytics'], 'analytics'),
      marketing_email: parseBoolean(obj['marketing_email'], 'marketing_email'),
      third_party_sharing: parseBoolean(obj['third_party_sharing'], 'third_party_sharing'),
      profiling: parseBoolean(obj['profiling'], 'profiling'),
    };
  },
);

export const dataExportRequestedResponseSchema: Schema<DataExportRequestedResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      message: parseString(obj['message'], 'message'),
      requestId: parseString(obj['requestId'], 'requestId'),
      estimatedCompletionAt: parseString(obj['estimatedCompletionAt'], 'estimatedCompletionAt'),
    };
  },
);

export const complianceActionResponseSchema: Schema<ComplianceActionResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    return {
      message: parseString(obj['message'], 'message'),
    };
  },
);
