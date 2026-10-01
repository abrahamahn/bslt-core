// main/server/core/src/compliance/legal/service.ts
/**
 * Legal Service
 *
 * Pure business logic for legal document and user agreement operations.
 * No HTTP awareness - returns domain objects or throws errors.
 * All functions accept repositories as explicit parameters
 * for testability and decoupled architecture.
 */

import { PUBLISHABLE_DOCUMENT_TYPES } from '@bslt/shared/core/compliance';

import type { ConsentRecordRepository, LegalDocumentRepository } from '@bslt/db/repositories';
import type {
  ConsentRecord as DbConsentRecord,
  LegalDocument as DbLegalDocument,
  NewLegalDocument,
} from '@bslt/db/schema';

// ============================================================================
// Legal Document Operations
// ============================================================================

/**
 * Get all current (latest version of each type) legal documents.
 *
 * @param legalDocs - Legal document repository
 * @returns Array of the latest version of each document type
 * @complexity O(n) where n is the number of document types
 */
export async function getCurrentLegalDocuments(
  legalDocs: LegalDocumentRepository,
): Promise<DbLegalDocument[]> {
  return legalDocs.findAllLatest();
}

/**
 * Get all agreements for a user.
 *
 * @param consentRecords - Consent record repository
 * @param userId - User identifier
 * @returns Array of agreements, most recent first
 * @complexity O(n) where n is the number of agreements
 */
export async function getUserAgreements(
  consentRecords: ConsentRecordRepository,
  userId: string,
): Promise<DbConsentRecord[]> {
  return consentRecords.findAgreementsByUserId(userId);
}

/**
 * Publish a new version of a legal document.
 *
 * Determines the next version number automatically by checking
 * existing versions of the same document type.
 *
 * @param legalDocs - Legal document repository
 * @param type - Document type (e.g., 'terms_of_service', 'privacy_policy')
 * @param title - Document title
 * @param content - Document content (markdown or HTML)
 * @param effectiveAt - When the document becomes effective
 * @returns The created legal document
 * @throws Error if the type is not DB-published, or if insert fails
 * @complexity O(1) - version lookup + insert
 */
export async function publishLegalDocument(
  legalDocs: LegalDocumentRepository,
  type: string,
  title: string,
  content: string,
  effectiveAt: Date,
): Promise<DbLegalDocument> {
  // Only the DB-published types can be authored here. The others are
  // file-owned (docs/legal/, rendered by the web app's @features/content), so
  // a version published for them would never reach a reader. The 'invalid'
  // wording is load-bearing: the handler maps it to a 400.
  if (!PUBLISHABLE_DOCUMENT_TYPES.some((publishable) => publishable === type)) {
    throw new Error(
      `type '${type}' is invalid: publishable types are ${PUBLISHABLE_DOCUMENT_TYPES.join(', ')}`,
    );
  }

  // Determine next version number
  const latest = await legalDocs.findLatestByType(type);
  const nextVersion = latest !== null ? latest.version + 1 : 1;

  const data: NewLegalDocument = {
    type,
    title,
    content,
    version: nextVersion,
    effectiveAt,
  };

  return legalDocs.create(data);
}
