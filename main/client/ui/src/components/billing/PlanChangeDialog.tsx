// main/client/ui/src/components/billing/PlanChangeDialog.tsx
import {
  calculateProration,
  determinePlanChangeDirection,
  formatPrice,
  formatPriceWithInterval,
  type Plan,
} from '@bslt/shared/core/billing';
import { forwardRef, useMemo, type ComponentPropsWithoutRef, type ReactElement } from 'react';

import { Button } from '../../elements/Button';
import { cn } from '../../utils/cn';

import '../../styles/components.css';

// ============================================================================
// Types
// ============================================================================

export interface PlanChangeDialogProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** The user's current plan */
  currentPlan: Plan;
  /** The plan the user wants to switch to */
  newPlan: Plan;
  /** Number of days remaining in the current billing period */
  remainingDays: number;
  /** Total number of days in the current billing period */
  totalDays: number;
  /** End date of the current billing period (ISO string) */
  periodEndDate: string;
  /** Whether the plan change is currently being processed */
  isProcessing?: boolean;
  /** Callback when the user confirms the plan change */
  onConfirm: () => void;
  /** Callback when the user cancels */
  onCancel: () => void;
  /** Custom date formatter */
  formatDate?: (dateString: string) => string;
}

// ============================================================================
// Helpers
// ============================================================================

function defaultFormatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ============================================================================
// Component
// ============================================================================

/**
 * PlanChangeDialog displays a confirmation dialog for plan upgrades
 * and downgrades with proration preview.
 *
 * - Upgrades take effect immediately with a prorated charge.
 * - Downgrades take effect at the end of the current billing period.
 *
 * This component renders the dialog body content. It is intended to be
 * placed inside a `<Dialog.Content>` wrapper from the parent page.
 *
 * @example
 * ```tsx
 * <Dialog.Root open={dialogOpen} onChange={setDialogOpen}>
 *   <Dialog.Content title="Change Plan">
 *     <PlanChangeDialog
 *       currentPlan={currentPlan}
 *       newPlan={selectedPlan}
 *       remainingDays={15}
 *       totalDays={30}
 *       periodEndDate="2026-03-15T00:00:00Z"
 *       isProcessing={isActing}
 *       onConfirm={handleConfirm}
 *       onCancel={() => setDialogOpen(false)}
 *     />
 *   </Dialog.Content>
 * </Dialog.Root>
 * ```
 */
export const PlanChangeDialog = forwardRef<HTMLDivElement, PlanChangeDialogProps>(
  (
    {
      currentPlan,
      newPlan,
      remainingDays,
      totalDays,
      periodEndDate,
      isProcessing = false,
      onConfirm,
      onCancel,
      formatDate = defaultFormatDate,
      className,
      ...rest
    },
    ref,
  ): ReactElement => {
    const isUpgrade =
      determinePlanChangeDirection(currentPlan.priceInCents, newPlan.priceInCents) === 'upgrade';

    const prorationAmount = useMemo(
      () =>
        calculateProration(
          currentPlan.priceInCents,
          newPlan.priceInCents,
          remainingDays,
          totalDays,
        ),
      [currentPlan.priceInCents, newPlan.priceInCents, remainingDays, totalDays],
    );

    const formattedPeriodEnd = useMemo(
      () => formatDate(periodEndDate),
      [formatDate, periodEndDate],
    );

    return (
      <div ref={ref} className={cn('plan-change-dialog', className)} {...rest}>
        {/* Plan Comparison */}
        <div className="plan-change-dialog__comparison">
          <div className="plan-change-dialog__plan plan-change-dialog__plan--current">
            <span className="plan-change-dialog__plan-label">Current Plan</span>
            <h4 className="plan-change-dialog__plan-name">{currentPlan.name}</h4>
            <p className="plan-change-dialog__plan-price">
              {formatPriceWithInterval(
                currentPlan.priceInCents,
                currentPlan.currency,
                currentPlan.interval,
              )}
            </p>
          </div>

          <div className="plan-change-dialog__arrow">{'\u2192'}</div>

          <div
            className={cn(
              'plan-change-dialog__plan',
              isUpgrade
                ? 'plan-change-dialog__plan--upgrade'
                : 'plan-change-dialog__plan--downgrade',
            )}
          >
            <span
              className={cn(
                'plan-change-dialog__plan-label',
                isUpgrade
                  ? 'plan-change-dialog__plan-label--upgrade'
                  : 'plan-change-dialog__plan-label--downgrade',
              )}
            >
              {isUpgrade ? 'Upgrade' : 'Downgrade'}
            </span>
            <h4 className="plan-change-dialog__plan-name">{newPlan.name}</h4>
            <p className="plan-change-dialog__plan-price">
              {formatPriceWithInterval(newPlan.priceInCents, newPlan.currency, newPlan.interval)}
            </p>
          </div>
        </div>

        {/* Proration Preview */}
        <div className="plan-change-dialog__proration">
          {isUpgrade ? (
            <>
              <p className="plan-change-dialog__proration-text">
                Change takes effect immediately. You&apos;ll be charged a prorated amount of{' '}
                <strong className="font-semibold">
                  {formatPrice(Math.abs(prorationAmount), newPlan.currency)}
                </strong>{' '}
                for the remainder of this billing period.
              </p>
              <p className="plan-change-dialog__proration-detail">
                {remainingDays} day{remainingDays !== 1 ? 's' : ''} remaining in current period
                (ends {formattedPeriodEnd})
              </p>
            </>
          ) : (
            <>
              <p className="plan-change-dialog__proration-text">
                Change takes effect at the end of your billing period on{' '}
                <strong className="font-semibold">{formattedPeriodEnd}</strong>. You&apos;ll
                continue to have access to your current plan features until then.
              </p>
              {prorationAmount < 0 && (
                <p className="plan-change-dialog__proration-detail">
                  A credit of{' '}
                  <strong>{formatPrice(Math.abs(prorationAmount), newPlan.currency)}</strong> will
                  be applied to your next invoice.
                </p>
              )}
            </>
          )}
        </div>

        {/* Price Change Summary */}
        <div className="plan-change-dialog__summary">
          <span className="plan-change-dialog__summary-label">New recurring price</span>
          <span className="plan-change-dialog__summary-value">
            {formatPriceWithInterval(newPlan.priceInCents, newPlan.currency, newPlan.interval)}
          </span>
        </div>

        {/* Actions */}
        <div className="dialog-actions">
          <Button variant="text" onClick={onCancel} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            className="plan-change-dialog__confirm"
            variant={isUpgrade ? 'primary' : 'secondary'}
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : isUpgrade ? 'Confirm Upgrade' : 'Confirm Downgrade'}
          </Button>
        </div>
      </div>
    );
  },
);

PlanChangeDialog.displayName = 'PlanChangeDialog';
