// main/shared/src/modules/core/compliance/deletion.logic.ts

/**
 * @file Deletion Logic
 * @description Helpers for data retention and deletion workflows.
 * @module Core/Compliance
 */

import { DEFAULT_GRACE_PERIOD_DAYS } from '../../../constants/core/compliance';

import type { SoftDeletable } from './deletion.schemas';

// ============================================================================
// Constants
// ============================================================================

// Re-exported, not redeclared: single source is `constants/core/compliance`.
export { DEFAULT_GRACE_PERIOD_DAYS };

// ============================================================================
// Functions
// ============================================================================

/**
 * Calculate hard delete date from soft delete date.
 */
export function calculateHardDeleteDate(
  softDeleteDate: Date,
  gracePeriodDays: number = DEFAULT_GRACE_PERIOD_DAYS,
): Date {
  const hardDeleteDate = new Date(softDeleteDate);
  hardDeleteDate.setDate(hardDeleteDate.getDate() + gracePeriodDays);
  return hardDeleteDate;
}

/**
 * Check if a soft-deleted resource is within grace period.
 */
export function isWithinGracePeriod(scheduledHardDeleteAt: Date | null): boolean {
  if (scheduledHardDeleteAt === null) return false;
  return new Date() < scheduledHardDeleteAt;
}

/**
 * Check if a resource is soft deleted.
 */
export function isSoftDeleted(resource: Partial<SoftDeletable>): boolean {
  return (
    resource.deletionState === 'soft_deleted' || resource.deletionState === 'pending_hard_delete'
  );
}
