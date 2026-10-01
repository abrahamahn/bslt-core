// main/server/core/src/compliance/legal/types.ts
import { type BaseContext, type RequestContext } from '@bslt/shared/contracts';
import { type Logger } from '@bslt/shared/system';

import type {
  AuditEventRepository,
  ConsentRecordRepository,
  LegalDocumentRepository,
} from '@bslt/db/repositories';

// ============================================================================
// Handler Context Types
// ============================================================================

/**
 * Application context for legal handlers.
 *
 * Extends `BaseContext` with legal-specific repositories.
 * The server's `AppContext` structurally satisfies this -- no casting needed.
 */
export interface LegalAppContext extends BaseContext {
  readonly repos: {
    readonly legalDocuments: LegalDocumentRepository;
    readonly consentRecords: ConsentRecordRepository;
    readonly auditEvents?: AuditEventRepository;
  };
  readonly log: Logger;
}

/**
 * Request type used by legal handlers.
 */
export type LegalRequest = RequestContext;
