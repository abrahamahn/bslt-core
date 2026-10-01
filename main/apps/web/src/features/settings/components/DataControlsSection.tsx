// main/apps/web/src/features/settings/components/DataControlsSection.tsx
/**
 * Data Controls Section
 *
 * Account status display plus data management options (consent + export).
 * Account lifecycle actions (deactivate / delete / reactivate) live on the
 * Account tab's DangerZone and are intentionally NOT duplicated here.
 */

import { MS_PER_DAY } from '@bslt/shared/constants/time';
import { Badge, Text } from '@bslt/ui';
import { useMemo, useState, type ReactElement } from 'react';

import { ConsentPreferences } from './ConsentPreferences';
import { DataExportSection } from './DataExportSection';
import { DoNotSellControl } from './DoNotSellControl';

// ============================================================================
// Types
// ============================================================================

export interface DataControlsSectionProps {
  /** Current account status */
  accountStatus?: 'active' | 'deactivated' | 'pending_deletion';
  /** ISO date when permanent deletion is scheduled (only relevant when pending_deletion) */
  deletionScheduledAt?: string;
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getStatusTone(status: string): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
      return 'success';
    case 'deactivated':
      return 'warning';
    case 'pending_deletion':
      return 'danger';
    default:
      return 'success';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'deactivated':
      return 'Deactivated';
    case 'pending_deletion':
      return 'Pending Deletion';
    default:
      return 'Unknown';
  }
}

// ============================================================================
// Component
// ============================================================================

export const DataControlsSection = ({
  accountStatus = 'active',
  deletionScheduledAt,
  className,
}: DataControlsSectionProps): ReactElement => {
  const [now] = useState(() => Date.now());
  const deletionDaysLeft = useMemo(() => {
    if (deletionScheduledAt === undefined) return null;
    return Math.max(0, Math.ceil((new Date(deletionScheduledAt).getTime() - now) / MS_PER_DAY));
  }, [deletionScheduledAt, now]);
  const rootClassName =
    className === undefined ? 'settings-data-controls' : `settings-data-controls ${className}`;

  return (
    <div className={rootClassName}>
      <section className="settings-action-panel settings-action-panel--status">
        <div className="settings-action-panel__header">
          <div className="settings-action-panel__copy">
            <Text className="font-medium">Account Status</Text>
            <Text size="sm" tone="muted">
              Your account is currently{' '}
              {accountStatus === 'active'
                ? 'active and in good standing.'
                : accountStatus === 'deactivated'
                  ? 'deactivated. You can reactivate it from the Account tab.'
                  : 'scheduled for deletion. Manage this from the Account tab.'}
            </Text>
          </div>
          <Badge tone={getStatusTone(accountStatus)} data-testid="account-status-badge">
            {getStatusLabel(accountStatus)}
          </Badge>
        </div>
        {accountStatus === 'pending_deletion' && deletionDaysLeft !== null && (
          <Text size="sm" tone="danger" data-testid="deletion-countdown">
            Permanent deletion in {deletionDaysLeft} {deletionDaysLeft === 1 ? 'day' : 'days'}
          </Text>
        )}
      </section>

      <div className="settings-data-controls__group">
        <ConsentPreferences />
      </div>

      <div className="settings-data-controls__group">
        {/* The CPRA opt-out. Also mounted in the AppFooter for anonymous
            visitors (§7026: no login may be required to opt out). */}
        <DoNotSellControl />
      </div>

      <div className="settings-data-controls__group">
        <DataExportSection />
      </div>
    </div>
  );
};
