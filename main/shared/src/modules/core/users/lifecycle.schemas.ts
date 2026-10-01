// main/shared/src/modules/core/users/lifecycle.schemas.ts

/**
 * @file Account Lifecycle Schemas
 * @description Types and validation for account deactivation, deletion, and reactivation.
 * @module Core/Users
 */

import { ACCOUNT_DELETION_GRACE_PERIOD_DAYS } from '../../../constants/core/compliance';
import { createSchema, parseOptional, parseString } from '../../../schema';

import type { Schema } from '../../../schema';

// ============================================================================
// Constants
// ============================================================================

// Re-exported, not redeclared: single source is `constants/core/compliance`.
export { ACCOUNT_DELETION_GRACE_PERIOD_DAYS };

// ============================================================================
// Types
// ============================================================================

/** Account status derived from lifecycle columns */
export type AccountStatus = 'active' | 'deactivated' | 'pending_deletion';

/** Fields needed to derive account status */
export interface AccountLifecycleFields {
  deactivatedAt: Date | null;
  deletedAt: Date | null;
  deletionGracePeriodEnds: Date | null;
}

/** Request to deactivate an account */
export interface DeactivateAccountRequest {
  reason?: string | undefined;
}

/** Request to delete an account (initiates grace period) */
export interface DeleteAccountRequest {
  reason?: string | undefined;
}

/** Response for account lifecycle operations */
export interface AccountLifecycleResponse {
  message: string;
  status: AccountStatus;
  deletionGracePeriodEnds?: string | undefined;
}

// ============================================================================
// Schemas
// ============================================================================

export const deactivateAccountRequestSchema: Schema<DeactivateAccountRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseOptional(obj['reason'], (v) => parseString(v, 'reason')),
    };
  },
);

export const deleteAccountRequestSchema: Schema<DeleteAccountRequest> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      reason: parseOptional(obj['reason'], (v) => parseString(v, 'reason')),
    };
  },
);

export const accountLifecycleResponseSchema: Schema<AccountLifecycleResponse> = createSchema(
  (data: unknown) => {
    const obj = (data !== null && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const status = parseString(obj['status'], 'status') as AccountStatus;

    return {
      message: parseString(obj['message'], 'message'),
      status,
      deletionGracePeriodEnds: parseOptional(obj['deletionGracePeriodEnds'], (v) =>
        parseString(v, 'deletionGracePeriodEnds'),
      ),
    };
  },
);
