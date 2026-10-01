// main/shared/src/modules/core/compliance/index.ts

/**
 * @file Compliance Module Index
 * @description Barrel exports for compliance domain: legal documents, consent, deletion.
 * @module Core/Compliance
 */

// --- compliance.logic ---
export { getEffectiveConsent, isConsentGranted, needsReacceptance } from './compliance.logic';

// --- compliance.schemas ---
export {
  complianceActionResponseSchema,
  consentPreferencesResponseSchema,
  consentRecordSchema,
  CONSENT_RECORD_TYPES,
  CONSENT_TYPES,
  createConsentRecordSchema,
  createDataExportRequestSchema,
  createLegalDocumentSchema,
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_STATUSES,
  DATA_EXPORT_TYPES,
  dataExportRequestedResponseSchema,
  dataExportRequestSchema,
  DOCUMENT_TYPES,
  legalDocumentSchema,
  PUBLISHABLE_DOCUMENT_TYPES,
  requestDataExportBodySchema,
  updateConsentPreferencesRequestSchema,
  updateLegalDocumentSchema,
} from './compliance.schemas';

export type {
  ComplianceActionResponse,
  ConsentPreferencesResponse,
  ConsentRecord,
  ConsentRecordType,
  ConsentType,
  CreateConsentRecord,
  CreateDataExportRequest,
  CreateLegalDocument,
  DataExportFormat,
  DataExportRequest,
  DataExportRequestedResponse,
  DataExportStatus,
  DataExportType,
  DocumentType,
  LegalDocument,
  PublishableDocumentType,
  RequestDataExportBody,
  UpdateConsentPreferencesRequest,
  UpdateLegalDocument,
} from './compliance.schemas';

// --- legal.policy ---
export {
  isConsentConfirmed,
  SIGNUP_AGREEMENT_DOCUMENT_TYPES,
  SIGNUP_CONSENT_REQUIRED_CODE,
} from './legal.policy';

// --- deletion.logic ---
export {
  calculateHardDeleteDate,
  DEFAULT_GRACE_PERIOD_DAYS,
  isSoftDeleted,
  isWithinGracePeriod,
} from './deletion.logic';

// --- deletion.schemas ---
export {
  DEFAULT_DELETION_CONFIG,
  DELETION_STATES,
  deletionRequestSchema,
} from './deletion.schemas';

export type {
  DeletionConfig,
  DeletionJob,
  DeletionRequest,
  DeletionServiceContract,
  DeletionState,
  SoftDeletable,
} from './deletion.schemas';
