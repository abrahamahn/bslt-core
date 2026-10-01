// main/server/core/src/auth/tos-gating.ts
/**
 * Terms of Service (ToS) Version Gating
 *
 * Middleware and service functions for requiring users to accept
 * the latest Terms of Service before accessing protected resources.
 *
 * Uses the existing `legal_documents` and `user_agreements` tables
 * for an append-only, GDPR-compliant audit trail.
 *
 * @module tos-gating
 */

import { requireAuthenticatedUser } from '@bslt/server-system/http';
import { AppError } from '@bslt/shared/system';

import type { Repositories } from '@bslt/db/factory';
import type { HttpReply, HttpRequest } from '@bslt/server-system/http';

// ============================================================================
// Constants
// ============================================================================

/** Legal document type identifier for Terms of Service */
const TOS_DOCUMENT_TYPE = 'terms_of_service';

/** Error code sent to clients when ToS acceptance is needed */
const TOS_REQUIRED_CODE = 'TOS_ACCEPTANCE_REQUIRED';

// ============================================================================
// Errors
// ============================================================================

/**
 * 403 refusal that tells the client WHICH document to accept.
 *
 * The api client's ToS interceptor reads `details.documentId` and
 * `details.requiredVersion` off the wire to show the acceptance modal and retry
 * the original request — a bare code with no document would strand it.
 */
export class TosAcceptanceRequiredError extends AppError {
  constructor(documentId: string, requiredVersion: number | null) {
    const message = 'You must accept the latest Terms of Service to continue.';
    super({
      code: TOS_REQUIRED_CODE,
      kind: 'authorization',
      message,
      publicMessage: message,
      retryable: false,
      statusCode: 403,
      details: { documentId, requiredVersion },
    });
    this.name = 'TosAcceptanceRequiredError';
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the ToS acceptance gate.
 */
export interface TosGatingOptions {
  /**
   * Request paths (query string ignored) the gate never blocks.
   *
   * A gated user must always be able to SEE and ACCEPT the new terms, hydrate
   * their session, and sign out — otherwise publishing a new ToS version locks
   * every un-accepted user out of the very endpoints they need to clear the
   * gate. The composition root supplies the list because only it knows the
   * route prefix and which endpoints the client's acceptance-modal loop calls.
   */
  exemptPaths?: readonly string[];
}

/**
 * Result of checking a user's ToS acceptance status.
 *
 * @complexity O(1) per field access
 */
export interface TosAcceptanceStatus {
  /** Whether the user has accepted the required ToS version */
  readonly accepted: boolean;
  /** The required ToS version (null if no ToS document exists) */
  readonly requiredVersion: number | null;
  /** The ToS document ID (null if no ToS document exists) */
  readonly documentId: string | null;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Check whether a user has accepted the latest Terms of Service.
 *
 * Queries the `legal_documents` table for the latest ToS version,
 * then checks `user_agreements` for an acceptance record.
 *
 * @param repos - Repository layer with legalDocuments and userAgreements
 * @param userId - The authenticated user's ID
 * @returns ToS acceptance status
 * @complexity O(1) — two indexed lookups
 */
export async function checkTosAcceptance(
  repos: Repositories,
  userId: string,
): Promise<TosAcceptanceStatus> {
  // Find the latest ToS document
  const latestTos = await repos.legalDocuments.findLatestByType(TOS_DOCUMENT_TYPE);

  if (latestTos === null) {
    // No ToS document exists — nothing to enforce
    return { accepted: true, requiredVersion: null, documentId: null };
  }

  // Check if the user has agreed to this specific document
  const agreement = await repos.consentRecords.findAgreementByUserAndDocument(userId, latestTos.id);

  return {
    accepted: agreement !== null,
    requiredVersion: latestTos.version,
    documentId: latestTos.id,
  };
}

/**
 * Record a user's acceptance of a Terms of Service document.
 *
 * Creates an append-only record in `user_agreements` for audit compliance.
 *
 * @param repos - Repository layer with userAgreements
 * @param userId - The authenticated user's ID
 * @param documentId - The legal document ID being accepted
 * @param ipAddress - Client IP address for audit trail
 * @returns The created agreement record
 * @throws When the database insert fails
 * @complexity O(1)
 */
export async function acceptTos(
  repos: Repositories,
  userId: string,
  documentId: string,
  ipAddress?: string,
): Promise<{ agreedAt: Date }> {
  const agreement = await repos.consentRecords.recordAgreement({
    userId,
    documentId,
    ipAddress: ipAddress ?? null,
  });

  return { agreedAt: agreement.createdAt };
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create a preHandler hook that gates access behind ToS acceptance.
 *
 * This middleware runs AFTER authentication (it requires `request.user`).
 * If the user has not accepted the latest ToS, it returns a 403 response
 * with a structured error body indicating which version must be accepted.
 *
 * @param repos - Repository layer with legalDocuments and userAgreements
 * @param options - Optional gate configuration (exempt paths)
 * @returns Async preHandler hook
 * @complexity O(1) per request — two indexed DB lookups
 *
 * @example
 * ```typescript
 * const tosHook = createRequireTosAcceptance(repos, {
 *   exemptPaths: ['/api/auth/tos/status', '/api/auth/tos/accept'],
 * });
 * fastify.addHook('preHandler', tosHook);
 * ```
 */
export function createRequireTosAcceptance(repos: Repositories, options: TosGatingOptions = {}) {
  const exemptPaths = new Set(options.exemptPaths ?? []);

  return async (request: HttpRequest, _reply: HttpReply): Promise<void> => {
    // Exempt paths short-circuit before any DB work — these are the endpoints
    // a gated user needs in order to clear (or escape) the gate.
    if (exemptPaths.has(request.url.split('?')[0] ?? request.url)) {
      return;
    }

    // If no user is attached, auth middleware should have already rejected.
    // requireAuthenticatedUser is a safety guard — should never throw in practice.
    const user = requireAuthenticatedUser(request);

    const status = await checkTosAcceptance(repos, user.userId);

    if (!status.accepted) {
      // status.accepted is false only when a ToS document exists, so documentId
      // is present here — but stay defensive about the wire shape.
      throw new TosAcceptanceRequiredError(status.documentId ?? '', status.requiredVersion);
    }
  };
}
